// One-sided reconnects (1–2 Sep 2026 incident) — Node/bridge-side mirror of
// src/lib/terminal/pty-crypto.reconnect.test.ts. The bridge keeps running across
// a browser-only reconnect (tab wake, watchdog, Wi-Fi blip, hard refresh) and
// vice versa. Both sides now rekey to a fresh attachId on EVERY attach event —
// their own, and the relay's `peer-reattached` for the other side's — and
// FrameDecryptor follows the peer's attaches: a new attachId at counter 0
// re-pins, in-flight frames from a superseded attach are dropped (`null`),
// replays and tampering still fail closed.
// Run: cd terminal/shared && node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FrameEncryptor,
  FrameDecryptor,
  PtyCryptoError,
  generateSessionKey,
  RECENT_ATTACH_IDS_MAX,
  DIRECTION_BRIDGE_TO_BROWSER,
  DIRECTION_BROWSER_TO_BRIDGE,
} from "./pty-crypto.mjs";

const SID = "sess-reconnect";
const b = (s) => Buffer.from(s, "utf8");
const s = (buf) => (buf === null ? null : buf.toString("utf8"));

test("browser-only reconnect: bridge output resumes once the bridge rekeys; in-flight frames are dropped, never fatal", () => {
  const key = generateSessionKey();
  const bridgeEncA = new FrameEncryptor(key, DIRECTION_BRIDGE_TO_BROWSER, SID);
  const browserDecA = new FrameDecryptor(key, DIRECTION_BRIDGE_TO_BROWSER, SID);
  for (let i = 0; i < 3; i++) browserDecA.decrypt(bridgeEncA.encrypt(b(`out ${i}`)));

  const browserDecB = new FrameDecryptor(key, DIRECTION_BRIDGE_TO_BROWSER, SID);
  assert.equal(browserDecB.decrypt(bridgeEncA.encrypt(b("in-flight 3"))), null);
  assert.equal(browserDecB.decrypt(bridgeEncA.encrypt(b("in-flight 4"))), null);

  const bridgeEncB = new FrameEncryptor(key, DIRECTION_BRIDGE_TO_BROWSER, SID);
  assert.equal(s(browserDecB.decrypt(bridgeEncB.encrypt(b("fresh 0")))), "fresh 0");
  assert.equal(s(browserDecB.decrypt(bridgeEncB.encrypt(b("fresh 1")))), "fresh 1");
  assert.equal(browserDecB.decrypt(bridgeEncA.encrypt(b("late"))), null);
  assert.equal(s(browserDecB.decrypt(bridgeEncB.encrypt(b("fresh 2")))), "fresh 2");
});

test("browser-only reconnect: the bridge's pinned decryptor follows the browser's fresh encryptor (first keystroke no longer kills the session)", () => {
  const key = generateSessionKey();
  const bridgeDec = new FrameDecryptor(key, DIRECTION_BROWSER_TO_BRIDGE, SID);
  const browserEncA = new FrameEncryptor(key, DIRECTION_BROWSER_TO_BRIDGE, SID);
  assert.equal(s(bridgeDec.decrypt(browserEncA.encrypt(b("ls\r")))), "ls\r");

  const browserEncB = new FrameEncryptor(key, DIRECTION_BROWSER_TO_BRIDGE, SID);
  assert.equal(s(bridgeDec.decrypt(browserEncB.encrypt(b("y")))), "y");
  assert.equal(s(bridgeDec.decrypt(browserEncB.encrypt(b("\r")))), "\r");
  assert.equal(bridgeDec.decrypt(browserEncA.encrypt(b("stale"))), null);
});

test("bridge-only reconnect: the browser's decryptor follows the bridge's new attach, then stays strict within it", () => {
  const key = generateSessionKey();
  const browserDec = new FrameDecryptor(key, DIRECTION_BRIDGE_TO_BROWSER, SID);
  const bridgeEncA = new FrameEncryptor(key, DIRECTION_BRIDGE_TO_BROWSER, SID);
  browserDec.decrypt(bridgeEncA.encrypt(b("a0")));
  browserDec.decrypt(bridgeEncA.encrypt(b("a1")));

  const bridgeEncB = new FrameEncryptor(key, DIRECTION_BRIDGE_TO_BROWSER, SID);
  const b0 = bridgeEncB.encrypt(b("b0"));
  const b1 = bridgeEncB.encrypt(b("b1"));
  const b2 = bridgeEncB.encrypt(b("b2"));
  assert.equal(s(browserDec.decrypt(b0)), "b0");
  assert.throws(() => browserDec.decrypt(b2), /out-of-order or replayed/);
  assert.equal(s(browserDec.decrypt(b1)), "b1");
  assert.throws(() => browserDec.decrypt(b1), /out-of-order or replayed/);
});

test("a replayed frame 0 of a superseded attach is rejected, not re-pinned", () => {
  const key = generateSessionKey();
  const browserDec = new FrameDecryptor(key, DIRECTION_BRIDGE_TO_BROWSER, SID);
  const bridgeEncA = new FrameEncryptor(key, DIRECTION_BRIDGE_TO_BROWSER, SID);
  const a0 = bridgeEncA.encrypt(b("a0"));
  browserDec.decrypt(a0);
  const bridgeEncB = new FrameEncryptor(key, DIRECTION_BRIDGE_TO_BROWSER, SID);
  browserDec.decrypt(bridgeEncB.encrypt(b("b0")));
  assert.throws(() => browserDec.decrypt(a0), /replayed frame from a superseded attach/);
  assert.equal(s(browserDec.decrypt(bridgeEncB.encrypt(b("b1")))), "b1");
});

test("the superseded-attach memory is bounded (RECENT_ATTACH_IDS_MAX) but covers the recent past", () => {
  const key = generateSessionKey();
  const browserDec = new FrameDecryptor(key, DIRECTION_BRIDGE_TO_BROWSER, SID);
  const firstFrames = [];
  const attaches = RECENT_ATTACH_IDS_MAX + 2;
  for (let i = 0; i < attaches; i++) {
    const e = new FrameEncryptor(key, DIRECTION_BRIDGE_TO_BROWSER, SID);
    const f0 = e.encrypt(b(`attach ${i}`));
    firstFrames.push(f0);
    assert.equal(s(browserDec.decrypt(f0)), `attach ${i}`);
  }
  assert.throws(() => browserDec.decrypt(firstFrames[attaches - 1]), /out-of-order or replayed/);
  for (let i = attaches - 1 - RECENT_ATTACH_IDS_MAX; i < attaches - 1; i++) {
    assert.throws(() => browserDec.decrypt(firstFrames[i]), /replayed frame from a superseded attach/);
  }
  // Documented bound: the one evicted attach's frame 0 reads as a new attach.
  assert.equal(s(browserDec.decrypt(firstFrames[0])), "attach 0");
});

test("a rekey attempt that fails AEAD (wrong key) neither re-pins nor disturbs the current attach", () => {
  const key = generateSessionKey();
  const browserDec = new FrameDecryptor(key, DIRECTION_BRIDGE_TO_BROWSER, SID);
  const bridgeEncA = new FrameEncryptor(key, DIRECTION_BRIDGE_TO_BROWSER, SID);
  browserDec.decrypt(bridgeEncA.encrypt(b("a0")));
  const foreignKey = generateSessionKey();
  assert.throws(() => browserDec.decrypt(new FrameEncryptor(foreignKey, DIRECTION_BRIDGE_TO_BROWSER, SID).encrypt(b("x"))), PtyCryptoError);
  assert.throws(() => browserDec.decrypt(new FrameEncryptor(foreignKey, DIRECTION_BRIDGE_TO_BROWSER, SID).encrypt(b("x"))), /AEAD verification failed/);
  assert.equal(s(browserDec.decrypt(bridgeEncA.encrypt(b("a1")))), "a1");
});

test("a fresh decryptor drops a mid-stream frame (attach start never seen) instead of failing", () => {
  const key = generateSessionKey();
  const bridgeEnc = new FrameEncryptor(key, DIRECTION_BRIDGE_TO_BROWSER, SID);
  bridgeEnc.encrypt(b("0"));
  const mid = bridgeEnc.encrypt(b("1"));
  const fresh = new FrameDecryptor(key, DIRECTION_BRIDGE_TO_BROWSER, SID);
  assert.equal(fresh.decrypt(mid), null);
});
