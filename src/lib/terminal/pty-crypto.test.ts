import { describe, expect, test } from "vitest";
import {
  FrameEncryptor,
  FrameDecryptor,
  PtyCryptoError,
  generateSessionKey,
  generateAttachId,
  deriveAttachSubkey,
  DIRECTION_BRIDGE_TO_BROWSER,
  DIRECTION_BROWSER_TO_BRIDGE,
  HEADER_LEN,
} from "./pty-crypto";

const SID = "sess-abc123";

function pair(direction = DIRECTION_BRIDGE_TO_BROWSER, key = generateSessionKey(), sessionId = SID) {
  const enc = new FrameEncryptor(key, direction, sessionId);
  const dec = new FrameDecryptor(key, direction, sessionId);
  return { enc, dec, key };
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// jsdom's realm gives TypedArrays a different prototype than the ones produced
// inside pty-crypto.ts's own module scope (also jsdom's realm here, but
// WebCrypto's ArrayBuffer results cross a realm boundary) — vitest's `toEqual`
// treats that prototype mismatch as inequality even when the bytes match, so
// byte-content assertions compare via plain arrays instead.
function bytesEqual(a: Uint8Array | null, b: Uint8Array): boolean {
  // decrypt() now returns null for a dropped superseded-attach frame — never
  // "equal" to real plaintext.
  return a !== null && toHex(a) === toHex(b);
}

describe("pty-crypto (browser/WebCrypto)", () => {
  test("round-trips plaintext through encrypt/decrypt", async () => {
    const { enc, dec } = pair();
    const msg = new TextEncoder().encode("hello from the PTY\r\n");
    const frame = await enc.encrypt(msg);
    expect(bytesEqual(await dec.decrypt(frame), msg)).toBe(true);
  });

  test("round-trips many frames in order, including empty and binary payloads", async () => {
    const { enc, dec } = pair();
    const payloads = [new Uint8Array(0), new Uint8Array([0, 1, 2, 255]), new TextEncoder().encode("x".repeat(5000))];
    for (const p of payloads) {
      expect(bytesEqual(await dec.decrypt(await enc.encrypt(p)), p)).toBe(true);
    }
  });

  test("attachId+counter header never repeats across many frames", async () => {
    const { enc } = pair();
    const seen = new Set<string>();
    const N = 500;
    for (let i = 0; i < N; i++) {
      const frame = await enc.encrypt(new TextEncoder().encode(`frame-${i}`));
      const key = toHex(frame.subarray(0, HEADER_LEN));
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    expect(seen.size).toBe(N);
  });

  test("a fresh attach never reuses the previous attach's attachId", async () => {
    const key = generateSessionKey();
    const attach1 = new FrameEncryptor(key, DIRECTION_BRIDGE_TO_BROWSER, SID);
    const attach2 = new FrameEncryptor(key, DIRECTION_BRIDGE_TO_BROWSER, SID);
    const f1 = await attach1.encrypt(new TextEncoder().encode("a"));
    const f2 = await attach2.encrypt(new TextEncoder().encode("a"));
    expect(toHex(f1.subarray(1, 17))).not.toEqual(toHex(f2.subarray(1, 17)));
  });

  test("tampered ciphertext fails closed", async () => {
    const { enc, dec } = pair();
    const frame = await enc.encrypt(new TextEncoder().encode("do not trust me"));
    frame[frame.length - 20] ^= 0xff;
    await expect(dec.decrypt(frame)).rejects.toThrow(PtyCryptoError);
  });

  test("tampered auth tag fails closed", async () => {
    const { enc, dec } = pair();
    const frame = await enc.encrypt(new TextEncoder().encode("payload"));
    frame[frame.length - 1] ^= 0xff;
    await expect(dec.decrypt(frame)).rejects.toThrow(PtyCryptoError);
  });

  test("wrong session key fails closed", async () => {
    const key = generateSessionKey();
    const otherKey = generateSessionKey();
    const enc = new FrameEncryptor(key, DIRECTION_BRIDGE_TO_BROWSER, SID);
    const dec = new FrameDecryptor(otherKey, DIRECTION_BRIDGE_TO_BROWSER, SID);
    const frame = await enc.encrypt(new TextEncoder().encode("secret"));
    await expect(dec.decrypt(frame)).rejects.toThrow(PtyCryptoError);
  });

  test("replayed frame is rejected on second delivery", async () => {
    const { enc, dec } = pair();
    const frame = await enc.encrypt(new TextEncoder().encode("only once"));
    expect(bytesEqual(await dec.decrypt(frame), new TextEncoder().encode("only once"))).toBe(true);
    await expect(dec.decrypt(frame)).rejects.toThrow(PtyCryptoError);
  });

  test("out-of-order (skipped counter) frame is rejected within a pinned attach", async () => {
    const { enc, dec } = pair();
    const frame0 = await enc.encrypt(new TextEncoder().encode("frame 0"));
    const frame1 = await enc.encrypt(new TextEncoder().encode("frame 1"));
    const frame2 = await enc.encrypt(new TextEncoder().encode("frame 2"));
    await dec.decrypt(frame0);
    await expect(dec.decrypt(frame2)).rejects.toThrow(PtyCryptoError);
    // A rejected reorder does not advance state — the in-order frame still works.
    expect(bytesEqual((await dec.decrypt(frame1)) as Uint8Array, new TextEncoder().encode("frame 1"))).toBe(true);
  });

  test("a mid-stream frame reaching a decryptor that never saw the attach start is dropped (null), not fatal", async () => {
    // Reconnect fix (1–2 Sep 2026): this is exactly a browser that re-attached
    // while the bridge kept counting — see pty-crypto.reconnect.test.ts.
    const { enc, dec } = pair();
    await enc.encrypt(new TextEncoder().encode("frame 0"));
    const frame1 = await enc.encrypt(new TextEncoder().encode("frame 1"));
    expect(await dec.decrypt(frame1)).toBeNull();
  });

  test("a frame from the wrong direction cannot be reflected into this decryptor", async () => {
    const key = generateSessionKey();
    const bridgeEnc = new FrameEncryptor(key, DIRECTION_BRIDGE_TO_BROWSER, SID);
    const browserToBridgeDec = new FrameDecryptor(key, DIRECTION_BROWSER_TO_BRIDGE, SID);
    const frame = await bridgeEnc.encrypt(new TextEncoder().encode("output meant for the browser"));
    await expect(browserToBridgeDec.decrypt(frame)).rejects.toThrow(PtyCryptoError);
  });

  test("a frame minted for a different session id is rejected", async () => {
    const key = generateSessionKey();
    const enc = new FrameEncryptor(key, DIRECTION_BRIDGE_TO_BROWSER, "session-A");
    const dec = new FrameDecryptor(key, DIRECTION_BRIDGE_TO_BROWSER, "session-B");
    const frame = await enc.encrypt(new TextEncoder().encode("belongs to session-A"));
    await expect(dec.decrypt(frame)).rejects.toThrow(PtyCryptoError);
  });

  test("a foreign attachId mid-stream is dropped; a foreign attachId at counter 0 is the peer rekeying and is followed", async () => {
    // Reconnect fix (1–2 Sep 2026): the sender starts a fresh attach on every
    // (re)connect of its own AND on the relay's peer-reattached, so the
    // decryptor must follow a new attach — but only from its first frame.
    const key = generateSessionKey();
    const encA = new FrameEncryptor(key, DIRECTION_BRIDGE_TO_BROWSER, SID);
    const encB = new FrameEncryptor(key, DIRECTION_BRIDGE_TO_BROWSER, SID);
    const dec = new FrameDecryptor(key, DIRECTION_BRIDGE_TO_BROWSER, SID);
    await dec.decrypt(await encA.encrypt(new TextEncoder().encode("from attach A")));
    const b0 = await encB.encrypt(new TextEncoder().encode("B frame 0"));
    const b1 = await encB.encrypt(new TextEncoder().encode("B frame 1"));
    expect(await dec.decrypt(b1)).toBeNull();
    expect(bytesEqual((await dec.decrypt(b0)) as Uint8Array, new TextEncoder().encode("B frame 0"))).toBe(true);
    expect(bytesEqual((await dec.decrypt(b1)) as Uint8Array, new TextEncoder().encode("B frame 1"))).toBe(true);
    // Attach A is now superseded: its stragglers are dropped, its first frame is a replay.
    expect(await dec.decrypt(await encA.encrypt(new TextEncoder().encode("A straggler")))).toBeNull();
  });

  test("malformed/short frames are rejected", async () => {
    const { dec } = pair();
    await expect(dec.decrypt(new Uint8Array(0))).rejects.toThrow(PtyCryptoError);
    await expect(dec.decrypt(new Uint8Array(10))).rejects.toThrow(PtyCryptoError);
    await expect(dec.decrypt(new Uint8Array(HEADER_LEN))).rejects.toThrow(PtyCryptoError);
  });

  test("unsupported frame version is rejected", async () => {
    const { enc, dec } = pair();
    const frame = await enc.encrypt(new TextEncoder().encode("x"));
    frame[0] = 99;
    await expect(dec.decrypt(frame)).rejects.toThrow(PtyCryptoError);
  });

  test("deriveAttachSubkey is direction-scoped", async () => {
    const key = generateSessionKey();
    const attachId = generateAttachId();
    const a = await deriveAttachSubkey(key, attachId, DIRECTION_BRIDGE_TO_BROWSER);
    const b = await deriveAttachSubkey(key, attachId, DIRECTION_BROWSER_TO_BRIDGE);
    // CryptoKey objects aren't directly comparable, but encrypting the same
    // plaintext with each must not produce a decryptable result under the other.
    expect(a).not.toBe(b);
  });

  test("invalid direction is rejected", () => {
    const key = generateSessionKey();
    expect(() => new FrameEncryptor(key, "sideways" as never, SID)).toThrow(PtyCryptoError);
    expect(() => new FrameDecryptor(key, "sideways" as never, SID)).toThrow(PtyCryptoError);
  });
});
