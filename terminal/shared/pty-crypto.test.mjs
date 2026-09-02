// Unit tests for the E2EE PTY frame AEAD wrapper (Terminal P2).
// Run: cd terminal/shared && node --test   (or: npm test)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FrameEncryptor,
  FrameDecryptor,
  PtyCryptoError,
  generateSessionKey,
  generateAttachId,
  deriveAttachSubkey,
  DIRECTION_BRIDGE_TO_BROWSER,
  DIRECTION_BROWSER_TO_BRIDGE,
} from "./pty-crypto.mjs";

const SID = "sess-abc123";

function pair(direction = DIRECTION_BRIDGE_TO_BROWSER, key = generateSessionKey(), sessionId = SID) {
  const enc = new FrameEncryptor(key, direction, sessionId);
  const dec = new FrameDecryptor(key, direction, sessionId);
  return { enc, dec, key };
}

test("round-trips plaintext through encrypt/decrypt", () => {
  const { enc, dec } = pair();
  const msg = Buffer.from("hello from the PTY\r\n", "utf8");
  const frame = enc.encrypt(msg);
  assert.deepEqual(dec.decrypt(frame), msg);
});

test("round-trips many frames in order, including empty and binary payloads", () => {
  const { enc, dec } = pair();
  const payloads = [Buffer.alloc(0), Buffer.from([0, 1, 2, 255]), Buffer.from("x".repeat(5000))];
  for (const p of payloads) {
    assert.deepEqual(dec.decrypt(enc.encrypt(p)), p);
  }
});

test("nonces (attachId+counter) never repeat across many frames", () => {
  const { enc } = pair();
  const seen = new Set();
  const N = 2000;
  for (let i = 0; i < N; i++) {
    const frame = enc.encrypt(Buffer.from(`frame-${i}`));
    // header = version(1) + attachId(16) + counter(8) — this is exactly what
    // determines the nonce (attachId ties the subkey, counter builds the nonce).
    const key = frame.subarray(0, 25).toString("hex");
    assert.ok(!seen.has(key), `nonce/attachId combo repeated at frame ${i}`);
    seen.add(key);
  }
  assert.equal(seen.size, N);
});

test("a fresh attach (new encryptor/decryptor pair) never reuses the previous attach's nonce space", () => {
  const key = generateSessionKey();
  const attach1 = new FrameEncryptor(key, DIRECTION_BRIDGE_TO_BROWSER, SID);
  const attach2 = new FrameEncryptor(key, DIRECTION_BRIDGE_TO_BROWSER, SID);
  const f1 = attach1.encrypt(Buffer.from("a"));
  const f2 = attach2.encrypt(Buffer.from("a"));
  // Different attachId (first 17 bytes after version) almost certainly, and
  // even the full header must differ since attachId is 128 random bits.
  assert.notEqual(f1.subarray(1, 17).toString("hex"), f2.subarray(1, 17).toString("hex"));
});

test("tampered ciphertext fails closed", () => {
  const { enc, dec } = pair();
  const frame = enc.encrypt(Buffer.from("do not trust me"));
  frame[frame.length - 20] ^= 0xff; // flip a byte inside the ciphertext
  assert.throws(() => dec.decrypt(frame), PtyCryptoError);
});

test("tampered auth tag fails closed", () => {
  const { enc, dec } = pair();
  const frame = enc.encrypt(Buffer.from("payload"));
  frame[frame.length - 1] ^= 0xff; // flip the last byte of the GCM tag
  assert.throws(() => dec.decrypt(frame), PtyCryptoError);
});

test("wrong session key fails closed (decryptor built with a different key)", () => {
  const key = generateSessionKey();
  const otherKey = generateSessionKey();
  const enc = new FrameEncryptor(key, DIRECTION_BRIDGE_TO_BROWSER, SID);
  const dec = new FrameDecryptor(otherKey, DIRECTION_BRIDGE_TO_BROWSER, SID);
  const frame = enc.encrypt(Buffer.from("secret"));
  assert.throws(() => dec.decrypt(frame), PtyCryptoError);
});

test("replayed frame is rejected on second delivery", () => {
  const { enc, dec } = pair();
  const frame = enc.encrypt(Buffer.from("only once"));
  assert.deepEqual(dec.decrypt(frame), Buffer.from("only once"));
  assert.throws(() => dec.decrypt(frame), PtyCryptoError);
});

test("out-of-order (skipped counter) frame is rejected within a pinned attach", () => {
  const { enc, dec } = pair();
  const frame0 = enc.encrypt(Buffer.from("frame 0"));
  const frame1 = enc.encrypt(Buffer.from("frame 1"));
  const frame2 = enc.encrypt(Buffer.from("frame 2"));
  dec.decrypt(frame0);
  assert.throws(() => dec.decrypt(frame2), PtyCryptoError);
  // A rejected reorder does not advance state — the in-order frame still works.
  assert.deepEqual(dec.decrypt(frame1), Buffer.from("frame 1"));
});

test("a mid-stream frame reaching a decryptor that never saw the attach start is dropped (null), not fatal", () => {
  // Reconnect fix (1–2 Sep 2026): exactly a browser that re-attached while the
  // bridge kept counting — see pty-crypto.reconnect.test.mjs.
  const { enc, dec } = pair();
  enc.encrypt(Buffer.from("frame 0"));
  const frame1 = enc.encrypt(Buffer.from("frame 1"));
  assert.equal(dec.decrypt(frame1), null);
});

test("a reordered-then-replayed frame cannot be smuggled back in after rejection", () => {
  const { enc, dec } = pair();
  const frame0 = enc.encrypt(Buffer.from("frame 0"));
  const frame1 = enc.encrypt(Buffer.from("frame 1"));
  assert.deepEqual(dec.decrypt(frame0), Buffer.from("frame 0"));
  assert.deepEqual(dec.decrypt(frame1), Buffer.from("frame 1"));
  // frame0 replayed after the stream has moved on.
  assert.throws(() => dec.decrypt(frame0), PtyCryptoError);
});

test("a frame from the wrong direction cannot be reflected into this decryptor", () => {
  const key = generateSessionKey();
  const bridgeEnc = new FrameEncryptor(key, DIRECTION_BRIDGE_TO_BROWSER, SID);
  const browserToBridgeDec = new FrameDecryptor(key, DIRECTION_BROWSER_TO_BRIDGE, SID);
  const frame = bridgeEnc.encrypt(Buffer.from("output meant for the browser"));
  // Even with the identical key, the AAD's direction byte differs, so
  // reflecting a b2w frame into a w2b decryptor must fail AEAD verification.
  assert.throws(() => browserToBridgeDec.decrypt(frame), PtyCryptoError);
});

test("a frame minted for a different session id is rejected (AAD binds sessionId)", () => {
  const key = generateSessionKey();
  const enc = new FrameEncryptor(key, DIRECTION_BRIDGE_TO_BROWSER, "session-A");
  const dec = new FrameDecryptor(key, DIRECTION_BRIDGE_TO_BROWSER, "session-B");
  const frame = enc.encrypt(Buffer.from("belongs to session-A"));
  assert.throws(() => dec.decrypt(frame), PtyCryptoError);
});

test("a foreign attachId mid-stream is dropped; a foreign attachId at counter 0 is the peer rekeying and is followed", () => {
  // Reconnect fix (1–2 Sep 2026): the sender starts a fresh attach on every
  // (re)connect of its own AND on the relay's peer-reattached, so the
  // decryptor must follow a new attach — but only from its first frame.
  const key = generateSessionKey();
  const encA = new FrameEncryptor(key, DIRECTION_BRIDGE_TO_BROWSER, SID);
  const encB = new FrameEncryptor(key, DIRECTION_BRIDGE_TO_BROWSER, SID); // a different attach
  const dec = new FrameDecryptor(key, DIRECTION_BRIDGE_TO_BROWSER, SID);
  dec.decrypt(encA.encrypt(Buffer.from("from attach A, frame 0")));
  const b0 = encB.encrypt(Buffer.from("B frame 0"));
  const b1 = encB.encrypt(Buffer.from("B frame 1"));
  assert.equal(dec.decrypt(b1), null);
  assert.deepEqual(dec.decrypt(b0), Buffer.from("B frame 0"));
  assert.deepEqual(dec.decrypt(b1), Buffer.from("B frame 1"));
  // Attach A is now superseded: its stragglers are dropped.
  assert.equal(dec.decrypt(encA.encrypt(Buffer.from("A straggler"))), null);
});

test("malformed/short frames are rejected without throwing an unrelated error", () => {
  const { dec } = pair();
  assert.throws(() => dec.decrypt(Buffer.alloc(0)), PtyCryptoError);
  assert.throws(() => dec.decrypt(Buffer.alloc(10)), PtyCryptoError);
  assert.throws(() => dec.decrypt(Buffer.alloc(HEADER_LEN_FOR_TEST())), PtyCryptoError);
});

function HEADER_LEN_FOR_TEST() {
  // 1 (version) + 16 (attachId) + 8 (counter) — no ciphertext/tag at all.
  return 25;
}

test("unsupported frame version is rejected", () => {
  const { enc, dec } = pair();
  const frame = enc.encrypt(Buffer.from("x"));
  frame[0] = 99;
  assert.throws(() => dec.decrypt(frame), PtyCryptoError);
});

test("deriveAttachSubkey is deterministic and direction-scoped", () => {
  const key = generateSessionKey();
  const attachId = generateAttachId();
  const a = deriveAttachSubkey(key, attachId, DIRECTION_BRIDGE_TO_BROWSER);
  const b = deriveAttachSubkey(key, attachId, DIRECTION_BRIDGE_TO_BROWSER);
  const c = deriveAttachSubkey(key, attachId, DIRECTION_BROWSER_TO_BRIDGE);
  assert.deepEqual(a, b); // deterministic for identical inputs
  assert.notDeepEqual(a, c); // direction is part of the KDF context
});

test("invalid key/attachId lengths are rejected up front", () => {
  assert.throws(() => deriveAttachSubkey(Buffer.alloc(16), generateAttachId(), DIRECTION_BRIDGE_TO_BROWSER), PtyCryptoError);
  assert.throws(() => deriveAttachSubkey(generateSessionKey(), Buffer.alloc(4), DIRECTION_BRIDGE_TO_BROWSER), PtyCryptoError);
});

test("invalid direction is rejected", () => {
  const key = generateSessionKey();
  assert.throws(() => new FrameEncryptor(key, "sideways", SID), PtyCryptoError);
  assert.throws(() => new FrameDecryptor(key, "sideways", SID), PtyCryptoError);
});
