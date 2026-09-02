import { describe, expect, test } from "vitest";
import {
  FrameEncryptor,
  FrameDecryptor,
  PtyCryptoError,
  generateSessionKey,
  RECENT_ATTACH_IDS_MAX,
  DIRECTION_BRIDGE_TO_BROWSER,
  DIRECTION_BROWSER_TO_BRIDGE,
} from "./pty-crypto";

// One-sided reconnects (1–2 Sep 2026 incident). The bridge (user's Mac) keeps
// running across a browser-only reconnect (tab wake, watchdog, Wi-Fi blip,
// hard refresh) and vice versa. Both sides now rekey to a fresh attachId on
// EVERY attach event — their own, and the relay's `peer-reattached` for the
// other side's — and FrameDecryptor follows the peer's attaches: a new
// attachId at counter 0 re-pins, in-flight frames from a superseded attach
// are dropped (`null`), replays and tampering still fail closed.
describe("pty-crypto — one-sided reconnect", () => {
  const SID = "sess-reconnect";
  const enc = (s: string) => new TextEncoder().encode(s);
  const dec = (b: Uint8Array | null) => (b === null ? null : new TextDecoder().decode(b));

  test("browser-only reconnect: bridge output resumes once the bridge rekeys; its in-flight frames are dropped, never fatal", async () => {
    const key = generateSessionKey();
    const bridgeEncA = new FrameEncryptor(key, DIRECTION_BRIDGE_TO_BROWSER, SID);
    const browserDecA = new FrameDecryptor(key, DIRECTION_BRIDGE_TO_BROWSER, SID);
    for (let i = 0; i < 3; i++) await browserDecA.decrypt(await bridgeEncA.encrypt(enc(`out ${i}`)));

    // Browser re-attaches alone → fresh decryptor, knows nothing of attach A.
    const browserDecB = new FrameDecryptor(key, DIRECTION_BRIDGE_TO_BROWSER, SID);
    // Frames the bridge sent under attach A before it learned we were back.
    expect(await browserDecB.decrypt(await bridgeEncA.encrypt(enc("in-flight 3")))).toBeNull();
    expect(await browserDecB.decrypt(await bridgeEncA.encrypt(enc("in-flight 4")))).toBeNull();

    // Relay tells the bridge `peer-reattached` → it rekeys.
    const bridgeEncB = new FrameEncryptor(key, DIRECTION_BRIDGE_TO_BROWSER, SID);
    expect(dec(await browserDecB.decrypt(await bridgeEncB.encrypt(enc("fresh 0"))))).toBe("fresh 0");
    expect(dec(await browserDecB.decrypt(await bridgeEncB.encrypt(enc("fresh 1"))))).toBe("fresh 1");
    // A straggler from attach A arriving late is still just dropped.
    expect(await browserDecB.decrypt(await bridgeEncA.encrypt(enc("late")))).toBeNull();
    expect(dec(await browserDecB.decrypt(await bridgeEncB.encrypt(enc("fresh 2"))))).toBe("fresh 2");
  });

  test("browser-only reconnect: the bridge's pinned decryptor follows the browser's fresh encryptor (first keystroke no longer kills the session)", async () => {
    const key = generateSessionKey();
    const bridgeDec = new FrameDecryptor(key, DIRECTION_BROWSER_TO_BRIDGE, SID);
    const browserEncA = new FrameEncryptor(key, DIRECTION_BROWSER_TO_BRIDGE, SID);
    expect(dec(await bridgeDec.decrypt(await browserEncA.encrypt(enc("ls\r"))))).toBe("ls\r");

    const browserEncB = new FrameEncryptor(key, DIRECTION_BROWSER_TO_BRIDGE, SID);
    expect(dec(await bridgeDec.decrypt(await browserEncB.encrypt(enc("y"))))).toBe("y");
    expect(dec(await bridgeDec.decrypt(await browserEncB.encrypt(enc("\r"))))).toBe("\r");
    // The previous attach is now superseded — its stragglers are dropped.
    expect(await bridgeDec.decrypt(await browserEncA.encrypt(enc("stale")))).toBeNull();
  });

  test("bridge-only reconnect: the browser's decryptor follows the bridge's new attach, then stays strict within it", async () => {
    const key = generateSessionKey();
    const browserDec = new FrameDecryptor(key, DIRECTION_BRIDGE_TO_BROWSER, SID);
    const bridgeEncA = new FrameEncryptor(key, DIRECTION_BRIDGE_TO_BROWSER, SID);
    await browserDec.decrypt(await bridgeEncA.encrypt(enc("a0")));
    await browserDec.decrypt(await bridgeEncA.encrypt(enc("a1")));

    const bridgeEncB = new FrameEncryptor(key, DIRECTION_BRIDGE_TO_BROWSER, SID);
    const b0 = await bridgeEncB.encrypt(enc("b0"));
    const b1 = await bridgeEncB.encrypt(enc("b1"));
    const b2 = await bridgeEncB.encrypt(enc("b2"));
    expect(dec(await browserDec.decrypt(b0))).toBe("b0");
    // Within the current attach the counter rule is unchanged: a skipped
    // frame is a reorder/replay and fails closed.
    await expect(browserDec.decrypt(b2)).rejects.toThrow(/out-of-order or replayed/);
    expect(dec(await browserDec.decrypt(b1))).toBe("b1");
    // …and the same frame twice is a replay.
    await expect(browserDec.decrypt(b1)).rejects.toThrow(/out-of-order or replayed/);
  });

  test("a replayed frame 0 of a superseded attach is rejected, not re-pinned", async () => {
    const key = generateSessionKey();
    const browserDec = new FrameDecryptor(key, DIRECTION_BRIDGE_TO_BROWSER, SID);
    const bridgeEncA = new FrameEncryptor(key, DIRECTION_BRIDGE_TO_BROWSER, SID);
    const a0 = await bridgeEncA.encrypt(enc("a0"));
    await browserDec.decrypt(a0);

    const bridgeEncB = new FrameEncryptor(key, DIRECTION_BRIDGE_TO_BROWSER, SID);
    await browserDec.decrypt(await bridgeEncB.encrypt(enc("b0")));

    await expect(browserDec.decrypt(a0)).rejects.toThrow(/replayed frame from a superseded attach/);
    // The current attach is untouched by the rejected replay.
    expect(dec(await browserDec.decrypt(await bridgeEncB.encrypt(enc("b1"))))).toBe("b1");
  });

  test("the superseded-attach memory is bounded (RECENT_ATTACH_IDS_MAX) but covers the recent past", async () => {
    const key = generateSessionKey();
    const browserDec = new FrameDecryptor(key, DIRECTION_BRIDGE_TO_BROWSER, SID);
    const firstFrames: Uint8Array[] = [];
    const attaches = RECENT_ATTACH_IDS_MAX + 2; // 0 … MAX+1; the current one is MAX+1
    for (let i = 0; i < attaches; i++) {
      const e = new FrameEncryptor(key, DIRECTION_BRIDGE_TO_BROWSER, SID);
      const f0 = await e.encrypt(enc(`attach ${i}`));
      firstFrames.push(f0);
      expect(dec(await browserDec.decrypt(f0))).toBe(`attach ${i}`);
    }
    // The current attach's frame 0 again is an in-attach replay.
    await expect(browserDec.decrypt(firstFrames[attaches - 1])).rejects.toThrow(/out-of-order or replayed/);
    // The MAX most recent superseded attaches are remembered and rejected…
    for (let i = attaches - 1 - RECENT_ATTACH_IDS_MAX; i < attaches - 1; i++) {
      await expect(browserDec.decrypt(firstFrames[i])).rejects.toThrow(/replayed frame from a superseded attach/);
    }
    // …and the residual window is exactly the one evicted attach: its frame 0
    // is indistinguishable from a brand-new attach (documented bound — a
    // malicious relay can replay one long-superseded first frame, after which
    // the genuine stream fails closed on its next frame).
    expect(dec(await browserDec.decrypt(firstFrames[0]))).toBe("attach 0");
  });

  test("a rekey attempt that fails AEAD (wrong key) neither re-pins nor disturbs the current attach", async () => {
    const key = generateSessionKey();
    const browserDec = new FrameDecryptor(key, DIRECTION_BRIDGE_TO_BROWSER, SID);
    const bridgeEncA = new FrameEncryptor(key, DIRECTION_BRIDGE_TO_BROWSER, SID);
    await browserDec.decrypt(await bridgeEncA.encrypt(enc("a0")));

    const foreignKey = generateSessionKey();
    const foreign1 = new FrameEncryptor(foreignKey, DIRECTION_BRIDGE_TO_BROWSER, SID);
    const foreign2 = new FrameEncryptor(foreignKey, DIRECTION_BRIDGE_TO_BROWSER, SID);
    await expect(browserDec.decrypt(await foreign1.encrypt(enc("x")))).rejects.toThrow(PtyCryptoError);
    await expect(browserDec.decrypt(await foreign2.encrypt(enc("x")))).rejects.toThrow(/AEAD verification failed/);
    // Still pinned to attach A, still strictly sequential.
    expect(dec(await browserDec.decrypt(await bridgeEncA.encrypt(enc("a1"))))).toBe("a1");
  });

  test("a fresh decryptor drops a mid-stream frame (attach start never seen) instead of failing", async () => {
    const key = generateSessionKey();
    const bridgeEnc = new FrameEncryptor(key, DIRECTION_BRIDGE_TO_BROWSER, SID);
    await bridgeEnc.encrypt(enc("0"));
    const mid = await bridgeEnc.encrypt(enc("1"));
    const fresh = new FrameDecryptor(key, DIRECTION_BRIDGE_TO_BROWSER, SID);
    expect(await fresh.decrypt(mid)).toBeNull();
  });
});

// WebCrypto decrypt is async; back-to-back WebSocket messages used to race the
// counter check (the 2nd frame saw a not-yet-advanced expectedCounter and was
// rejected as out-of-order → 4010 integrity panel on a healthy stream).
describe("pty-crypto — concurrent decrypts are serialised", () => {
  test("frames of one attach decrypted concurrently all succeed, in order", async () => {
    const key = generateSessionKey();
    const enc = new FrameEncryptor(key, DIRECTION_BRIDGE_TO_BROWSER, "sess-race");
    const dec = new FrameDecryptor(key, DIRECTION_BRIDGE_TO_BROWSER, "sess-race");
    const frames: Uint8Array[] = [];
    for (let i = 0; i < 8; i++) frames.push(await enc.encrypt(new TextEncoder().encode(`f${i}`)));
    const out = await Promise.all(frames.map((f) => dec.decrypt(f)));
    expect(out.map((b) => (b === null ? null : new TextDecoder().decode(b)))).toEqual(frames.map((_, i) => `f${i}`));
  });

  test("a rejected frame does not wedge the frames queued behind it", async () => {
    const key = generateSessionKey();
    const enc = new FrameEncryptor(key, DIRECTION_BRIDGE_TO_BROWSER, "sess-race");
    const dec = new FrameDecryptor(key, DIRECTION_BRIDGE_TO_BROWSER, "sess-race");
    const f0 = await enc.encrypt(new TextEncoder().encode("f0"));
    const f1 = await enc.encrypt(new TextEncoder().encode("f1"));
    const results = await Promise.allSettled([dec.decrypt(f0), dec.decrypt(f0), dec.decrypt(f1)]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
  });
});
