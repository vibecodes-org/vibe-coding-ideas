import { describe, it, expect } from "vitest";
import {
  RELAY_CLOSE,
  E2EE_CLOSE,
  RECONNECT_GRACE_MS,
  BAD_TOKEN_CALM_THRESHOLD_MS,
  HEARTBEAT_INTERVAL_MS,
  LINK_SILENT_AFTER_MS,
  initialConnectionState,
  terminalReducer,
  mapCloseCode,
  isInputEnabled,
  isPeerDegradedFrame,
  isPeerReattachedFrame,
  encodeHeartbeatFrame,
  isHeartbeatAckFrame,
  isBridgeVersionFrame,
  parseBridgeVersionFrame,
  parseBridgeVersionHost,
  parseBridgeVersionConv,
  parseBridgeVersionE2ee,
  shouldDeclareLinkSilent,
  shouldDeclareAfterProbe,
  LINK_SILENT_PROBE_MS,
  RELAUNCH_IF_BRIDGE_SILENT_MS,
  buildRelayUrl,
  encodeResizeMessage,
  decideResize,
  claimConnectGeneration,
  isConnectSuperseded,
  decideReconnectNow,
  isSameOwnerPreemptedClose,
  PREEMPTED_CLOSE_REASON,
  type TerminalConnectionState,
  type TerminalEvent,
} from "./connection";
import { DEFAULT_TTL_SECONDS } from "../../../terminal/shared/session-token.mjs";
import {
  encodeAttachedFrame,
  encodePeerDegradedFrame,
  encodePeerReattachedFrame,
  encodeHeartbeatFrame as encodeSharedHeartbeatFrame,
  encodeHeartbeatAckFrame as encodeSharedHeartbeatAckFrame,
  isHeartbeatFrame as isSharedHeartbeatFrame,
  encodeBridgeVersionFrame as encodeSharedBridgeVersionFrame,
} from "../../../terminal/shared/control-frames.mjs";
import { CLOSE as RELAY_PAIRING_CLOSE } from "../../../terminal/relay/src/pairing.js";

// Helper: fold a sequence of events through the reducer from the initial state.
function run(events: TerminalEvent[], start = initialConnectionState): TerminalConnectionState {
  return events.reduce(terminalReducer, start);
}

describe("terminalReducer — happy path", () => {
  it("starts idle", () => {
    expect(initialConnectionState.status).toBe("idle");
  });

  it("connect → session-created → relay-open → data reaches connected", () => {
    const s = run([
      { type: "connect" },
      { type: "session-created", sessionId: "a3f9" },
      { type: "relay-open" },
      { type: "data" },
    ]);
    expect(s.status).toBe("connected");
    expect(s.sessionId).toBe("a3f9");
    expect(s.errorKind).toBeNull();
  });

  it("relay-open before any bridge bytes is waiting-to-pair", () => {
    const s = run([{ type: "connect" }, { type: "relay-open" }]);
    expect(s.status).toBe("waiting-to-pair");
  });

  it("connect resets prior error/ended metadata", () => {
    const errored = run([{ type: "connect" }, { type: "connect-timeout" }]);
    expect(errored.status).toBe("error");
    const reconnected = terminalReducer(errored, { type: "connect" });
    expect(reconnected.status).toBe("connecting");
    expect(reconnected.errorKind).toBeNull();
    expect(reconnected.sessionId).toBeNull();
  });
});

describe("terminalReducer — guards", () => {
  it("session-created is ignored unless connecting", () => {
    const connected = run([{ type: "connect" }, { type: "relay-open" }, { type: "data" }]);
    const after = terminalReducer(connected, { type: "session-created", sessionId: "late" });
    expect(after.sessionId).toBeNull();
  });

  it("relay-open is ignored unless connecting", () => {
    const connected = run([{ type: "connect" }, { type: "relay-open" }, { type: "data" }]);
    const after = terminalReducer(connected, { type: "relay-open" });
    expect(after.status).toBe("connected");
  });

  it("data while connected is a no-op (same state)", () => {
    const connected = run([{ type: "connect" }, { type: "relay-open" }, { type: "data" }]);
    expect(terminalReducer(connected, { type: "data" })).toBe(connected);
  });

  it("connect-timeout after connected is ignored", () => {
    const connected = run([{ type: "connect" }, { type: "relay-open" }, { type: "data" }]);
    const after = terminalReducer(connected, { type: "connect-timeout" });
    expect(after.status).toBe("connected");
  });

  it("connect-timeout during handshake → error", () => {
    const s = run([{ type: "connect" }, { type: "relay-open" }, { type: "connect-timeout" }]);
    expect(s.status).toBe("error");
    expect(s.errorKind).toBe("connect-timeout");
  });
});

describe("terminalReducer — ending & failures", () => {
  it("user-end → session-ended with reason user", () => {
    const s = run([{ type: "connect" }, { type: "relay-open" }, { type: "data" }, { type: "user-end" }]);
    expect(s.status).toBe("session-ended");
    expect(s.endedReason).toBe("user");
  });

  it("a close event after a user-end does not clobber session-ended", () => {
    const ended = run([{ type: "connect" }, { type: "relay-open" }, { type: "data" }, { type: "user-end" }]);
    const after = terminalReducer(ended, { type: "closed", code: 1000 });
    expect(after.status).toBe("session-ended");
    expect(after.endedReason).toBe("user");
    expect(after.closeCode).toBe(1000);
  });

  it("session-mint-failed → error", () => {
    const s = run([{ type: "connect" }, { type: "session-mint-failed" }]);
    expect(s.status).toBe("error");
    expect(s.errorKind).toBe("session-mint-failed");
  });

  // Ghost-sessions fix C: a mint refused for hitting the per-user cap must
  // get its own errorKind so the persistent pane can say what actually
  // happened instead of the generic "check your connection" copy.
  it("session-mint-failed with refusal 'cap' → error with errorKind cap-reached", () => {
    const s = run([{ type: "connect" }, { type: "session-mint-failed", refusal: "cap" }]);
    expect(s.status).toBe("error");
    expect(s.errorKind).toBe("cap-reached");
    // No cap in the refusal body → null; the pane falls back to the default.
    expect(s.refusalCap).toBeNull();
  });

  // Card 695c2c54: the refusing route's own `cap` rides the event into state
  // (a deliberately non-default number proves the server value wins), and a
  // fresh connect clears it with the rest of the error metadata.
  it("session-mint-failed with refusal 'cap' carries the server's cap, cleared on the next connect", () => {
    const s = run([{ type: "connect" }, { type: "session-mint-failed", refusal: "cap", cap: 3 }]);
    expect(s.errorKind).toBe("cap-reached");
    expect(s.refusalCap).toBe(3);

    const retried = run([
      { type: "connect" },
      { type: "session-mint-failed", refusal: "cap", cap: 3 },
      { type: "connect" },
    ]);
    expect(retried.refusalCap).toBeNull();
  });

  it("a non-cap mint failure never stores a cap, even if one is present on the event", () => {
    const s = run([{ type: "connect" }, { type: "session-mint-failed", cap: 3 }]);
    expect(s.errorKind).toBe("session-mint-failed");
    expect(s.refusalCap).toBeNull();
  });

  it("session-mint-failed with no refusal keeps the generic errorKind (unrelated mint failure)", () => {
    const s = run([{ type: "connect" }, { type: "session-mint-failed", refusal: undefined }]);
    expect(s.errorKind).toBe("session-mint-failed");
  });

  it("reconnect-exhausted → honest session-ended (reconnect-failed), from a live drop", () => {
    // connect → live → drop (disconnected) → grace window / token lapses.
    const dropped = run([
      { type: "connect" },
      { type: "relay-open" },
      { type: "data" },
      { type: "closed", code: RELAY_CLOSE.PEER_GONE },
    ]);
    expect(dropped.status).toBe("disconnected");
    const ended = terminalReducer(dropped, { type: "reconnect-exhausted" });
    expect(ended.status).toBe("session-ended");
    expect(ended.endedReason).toBe("reconnect-failed");
    expect(ended.errorKind).toBeNull();
  });

  it("reconnect-exhausted never clobbers an existing session-ended (e.g. a user-end)", () => {
    const ended = run([
      { type: "connect" },
      { type: "relay-open" },
      { type: "data" },
      { type: "user-end" },
    ]);
    const after = terminalReducer(ended, { type: "reconnect-exhausted" });
    expect(after.status).toBe("session-ended");
    expect(after.endedReason).toBe("user");
  });

  it("reset returns to a fresh idle state", () => {
    const s = run([{ type: "connect" }, { type: "relay-open" }, { type: "data" }, { type: "reset" }]);
    expect(s).toEqual(initialConnectionState);
  });
});

describe("mapCloseCode", () => {
  it("4005 → owner-mismatch error", () => {
    expect(mapCloseCode(RELAY_CLOSE.OWNER_MISMATCH, undefined, "waiting-to-pair")).toEqual({
      status: "error",
      errorKind: "owner-mismatch",
      endedReason: null,
    });
  });

  it("4006 during first establishment (still handshaking) → bad-token error", () => {
    expect(mapCloseCode(RELAY_CLOSE.BAD_TOKEN, undefined, "connecting").errorKind).toBe("bad-token");
    expect(mapCloseCode(RELAY_CLOSE.BAD_TOKEN, undefined, "waiting-to-pair").errorKind).toBe("bad-token");
  });

  // Ghost-sessions fix B: a Mac sleep drops both legs; the grace-window reattach
  // (use-terminal-session.ts's scheduleReconnect / reconnectNow) reopens with the
  // ORIGINAL token while priorStatus stays "disconnected" (it never dispatches
  // "connect" — see that file's grace-reconnect branch). If the relay already tore
  // the session down by then, that reattach gets refused 4006 too — but this is an
  // honest "ended while you were away", not a genuinely bad/tampered token, so it
  // must render the calm ended copy, not the scary verify error — PROVIDED enough
  // real time has actually passed to look like a genuine away-for-a-while gap (see
  // BAD_TOKEN_CALM_THRESHOLD_MS's doc — the wire can't otherwise tell this apart
  // from a live bug refusing every attempt instantly).
  it("4006 refusing a RECONNECT, well past the threshold → calm session-ended, not an error", () => {
    expect(mapCloseCode(RELAY_CLOSE.BAD_TOKEN, undefined, "disconnected", BAD_TOKEN_CALM_THRESHOLD_MS)).toEqual({
      status: "session-ended",
      errorKind: null,
      endedReason: "reconnect-failed",
    });
    expect(mapCloseCode(RELAY_CLOSE.BAD_TOKEN, undefined, "disconnected", 60_000).status).toBe("session-ended");
  });

  // Bug fix (regression backfill): a reconnect refused within a couple of seconds
  // of the drop is far more likely a live bug or a genuine token problem than an
  // honest "you were away" ending — must still surface as a real, actionable error,
  // not be swallowed into the calm copy. This is the exact regression: the original
  // fix B applied the calm reading to EVERY refused reconnect regardless of timing,
  // which silently masked real freezes/drops as clean endings.
  it("4006 refusing a RECONNECT quickly (below the threshold) → still a real bad-token error", () => {
    expect(mapCloseCode(RELAY_CLOSE.BAD_TOKEN, undefined, "disconnected")).toEqual({
      status: "error",
      errorKind: "bad-token",
      endedReason: null,
    });
    expect(
      mapCloseCode(RELAY_CLOSE.BAD_TOKEN, undefined, "disconnected", BAD_TOKEN_CALM_THRESHOLD_MS - 1).errorKind,
    ).toBe("bad-token");
  });

  it("4001 / 4002 → duplicate error", () => {
    expect(mapCloseCode(RELAY_CLOSE.DUP_BROWSER, undefined, "connected").errorKind).toBe("duplicate");
    expect(mapCloseCode(RELAY_CLOSE.DUP_BRIDGE, undefined, "connected").errorKind).toBe("duplicate");
  });

  it("4004 peer-gone → disconnected (recoverable)", () => {
    expect(mapCloseCode(RELAY_CLOSE.PEER_GONE, undefined, "connected").status).toBe("disconnected");
  });

  it("1000 → session-ended; reason text classifies idle / max-duration", () => {
    expect(mapCloseCode(1000, undefined, "connected").endedReason).toBe("remote");
    expect(mapCloseCode(1000, "idle timeout", "connected").endedReason).toBe("idle");
    expect(mapCloseCode(1000, "max-duration", "connected").endedReason).toBe("max-duration");
  });

  // Lock-step with terminal/relay/src/pairing.js → idleCloseReason / maxCloseReason
  // (and the Node stand-in). These are the EXACT default strings the relay emits on
  // a lifecycle close; if those builders change, this must move with them.
  it("classifies the relay's actual lifecycle close reasons (slice 6)", () => {
    const idle = mapCloseCode(1000, "idle-timeout: ended after 30 min idle", "connected");
    expect(idle.status).toBe("session-ended");
    expect(idle.endedReason).toBe("idle");

    const max = mapCloseCode(1000, "max-duration: session reached its 4 hour limit", "connected");
    expect(max.status).toBe("session-ended");
    expect(max.endedReason).toBe("max-duration");
  });

  it("Terminal P2 (E2EE): a fail-closed negotiation-timeout close maps to its own errorKind, not a generic error", () => {
    const mapped = mapCloseCode(E2EE_CLOSE.REQUIRED_NEGOTIATION_FAILED, "e2ee-required-negotiation-failed", "connecting");
    expect(mapped.status).toBe("error");
    expect(mapped.errorKind).toBe("e2ee-required");
  });

  it("Terminal P2 (E2EE): a mid-session AEAD verification failure maps to its own errorKind, even from a live stream", () => {
    const mapped = mapCloseCode(E2EE_CLOSE.VERIFY_FAILED, "e2ee-verify-failed", "connected");
    expect(mapped.status).toBe("error");
    expect(mapped.errorKind).toBe("e2ee-verify-failed");
  });

  it("abnormal close depends on prior status", () => {
    // Never reached the machine while handshaking → error.
    expect(mapCloseCode(1006, undefined, "connecting").errorKind).toBe("relay-unreachable");
    // Dropped after a live stream → recoverable disconnect.
    expect(mapCloseCode(1006, undefined, "connected").status).toBe("disconnected");
  });

  it("closed event flows through the reducer with the mapped state + closeCode", () => {
    const live = run([{ type: "connect" }, { type: "relay-open" }, { type: "data" }]);
    const owner = terminalReducer(live, { type: "closed", code: RELAY_CLOSE.OWNER_MISMATCH });
    expect(owner.status).toBe("error");
    expect(owner.errorKind).toBe("owner-mismatch");
    expect(owner.closeCode).toBe(RELAY_CLOSE.OWNER_MISMATCH);
  });

  it("closed event also carries the close REASON alongside closeCode", () => {
    const live = run([{ type: "connect" }, { type: "relay-open" }, { type: "data" }]);
    const closed = terminalReducer(live, { type: "closed", code: RELAY_CLOSE.DUP_BROWSER, reason: "preempted" });
    expect(closed.closeCode).toBe(RELAY_CLOSE.DUP_BROWSER);
    expect(closed.closeReason).toBe("preempted");
  });

  it("a missing reason on the closed event stores null, not undefined", () => {
    const live = run([{ type: "connect" }, { type: "relay-open" }, { type: "data" }]);
    const closed = terminalReducer(live, { type: "closed", code: 1006 });
    expect(closed.closeReason).toBeNull();
  });
});

// ── same-owner takeover vs. genuine attach-rejection (card cbe60db5, rework 6) ─
//
// Nick's field-test item 4: the tab a same-owner reconnect TOOK OVER showed the
// generic "This session is already open elsewhere" error even though it was a
// deliberate, successful hand-off, not a failed attach. The relay tells the two
// apart via the close REASON on the shared 4001 code — see
// terminal/relay/src/pairing.js → CLOSE.DUP_BROWSER vs CLOSE.PREEMPTED, imported
// here directly (a pure, dependency-free module) so this test is pinned against
// the RELAY'S OWN literal strings, not a hand-copied guess.
describe("isSameOwnerPreemptedClose", () => {
  it("pins PREEMPTED_CLOSE_REASON against the relay's own CLOSE.PREEMPTED.reason", () => {
    expect(PREEMPTED_CLOSE_REASON).toBe(RELAY_PAIRING_CLOSE.PREEMPTED.reason);
    // Same code as DUP_BROWSER — only the reason string tells them apart.
    expect(RELAY_PAIRING_CLOSE.PREEMPTED.code).toBe(RELAY_CLOSE.DUP_BROWSER);
  });

  it("true for a same-owner takeover close (4001 + \"preempted\")", () => {
    expect(isSameOwnerPreemptedClose(RELAY_CLOSE.DUP_BROWSER, PREEMPTED_CLOSE_REASON)).toBe(true);
  });

  it("false for the genuine attach-rejection close — same code, the relay's real rejection reason", () => {
    expect(isSameOwnerPreemptedClose(RELAY_CLOSE.DUP_BROWSER, RELAY_PAIRING_CLOSE.DUP_BROWSER.reason)).toBe(false);
  });

  it("false when the reason is missing entirely (older relay, or a raw abnormal close)", () => {
    expect(isSameOwnerPreemptedClose(RELAY_CLOSE.DUP_BROWSER, null)).toBe(false);
  });

  it("false for any other close code, even with the preempted reason string", () => {
    expect(isSameOwnerPreemptedClose(RELAY_CLOSE.DUP_BRIDGE, PREEMPTED_CLOSE_REASON)).toBe(false);
    expect(isSameOwnerPreemptedClose(null, PREEMPTED_CLOSE_REASON)).toBe(false);
  });

  it("end to end: a takeover close on a LIVE session reaches the reducer as errorKind duplicate, discriminated as a takeover", () => {
    const live = run([{ type: "connect" }, { type: "relay-open" }, { type: "data" }]);
    const takenOver = terminalReducer(live, {
      type: "closed",
      code: RELAY_CLOSE.DUP_BROWSER,
      reason: RELAY_PAIRING_CLOSE.PREEMPTED.reason,
    });
    // The mechanism is UNCHANGED — same status/errorKind as any other duplicate
    // close (mirrors the popped-out window's isPreemptedClose, which also never
    // touches status). Only the discriminator flips.
    expect(takenOver.status).toBe("error");
    expect(takenOver.errorKind).toBe("duplicate");
    expect(isSameOwnerPreemptedClose(takenOver.closeCode, takenOver.closeReason)).toBe(true);
  });

  it("end to end: a genuine attach-rejection close reaches the reducer identically on status/errorKind, but is NOT discriminated as a takeover", () => {
    // This tab never got past the handshake — it tried to attach while another
    // leg already held the session and was refused outright.
    const handshaking = run([{ type: "connect" }, { type: "relay-open" }]);
    const rejected = terminalReducer(handshaking, {
      type: "closed",
      code: RELAY_CLOSE.DUP_BROWSER,
      reason: RELAY_PAIRING_CLOSE.DUP_BROWSER.reason,
    });
    expect(rejected.status).toBe("error");
    expect(rejected.errorKind).toBe("duplicate");
    expect(isSameOwnerPreemptedClose(rejected.closeCode, rejected.closeReason)).toBe(false);
  });
});

describe("isInputEnabled", () => {
  const connected: TerminalConnectionState = run([
    { type: "connect" },
    { type: "relay-open" },
    { type: "data" },
  ]);

  it("true only when connected and not read-only", () => {
    expect(isInputEnabled(connected, false)).toBe(true);
    expect(isInputEnabled(connected, true)).toBe(false);
  });

  it("false in every non-connected state", () => {
    expect(isInputEnabled(initialConnectionState, false)).toBe(false);
    const waiting = run([{ type: "connect" }, { type: "relay-open" }]);
    expect(isInputEnabled(waiting, false)).toBe(false);
  });
});

describe("buildRelayUrl", () => {
  it("builds the browser-leg attach URL and trims trailing slashes", () => {
    expect(buildRelayUrl("ws://127.0.0.1:8787/", "a3f9", "tok.sig")).toBe(
      "ws://127.0.0.1:8787/?session=a3f9&role=browser&token=tok.sig",
    );
  });

  it("URL-encodes the session id and token", () => {
    const url = buildRelayUrl("wss://relay.example", "s/i d", "a+b/c=");
    expect(url).toContain("session=s%2Fi%20d");
    expect(url).toContain("token=a%2Bb%2Fc%3D");
    expect(url).toContain("role=browser");
  });
});

describe("encodeResizeMessage", () => {
  it("produces the bridge's resize control frame", () => {
    expect(encodeResizeMessage(120, 30)).toBe('{"type":"resize","cols":120,"rows":30}');
  });

  it("rejects non-sane dimensions", () => {
    expect(encodeResizeMessage(0, 30)).toBeNull();
    expect(encodeResizeMessage(120, -1)).toBeNull();
    expect(encodeResizeMessage(1.5, 30)).toBeNull();
    expect(encodeResizeMessage(120, 99999)).toBeNull();
  });
});

describe("decideResize (fix/terminal-dock-launch-defects, fix/terminal-dock-cold-launch-resize)", () => {
  it("unchanged key → skip, regardless of reachability", () => {
    expect(decideResize("80x24", "80x24", true)).toEqual({ action: "skip" });
    expect(decideResize("80x24", "80x24", false)).toEqual({ action: "skip" });
  });

  it("changed key + reachable → send, carrying the new key", () => {
    expect(decideResize("120x30", "80x24", true)).toEqual({
      action: "send",
      nextLastKey: "120x30",
    });
  });

  it("changed key + NOT reachable → defer, with no nextLastKey (caller contract: the key must not advance)", () => {
    const decision = decideResize("120x30", "80x24", false);
    expect(decision).toEqual({ action: "defer" });
    expect(decision).not.toHaveProperty("nextLastKey");
  });

  it("skip also carries no nextLastKey", () => {
    const decision = decideResize("80x24", "80x24", true);
    expect(decision).not.toHaveProperty("nextLastKey");
  });

  it("the launch sequence: defer while CONNECTING, then the SAME key resolves to send once reachable", () => {
    // This is the exact bug this decision function fixes: the launch-time
    // ResizeObserver/expand-rAF compute the real dims before the socket is even
    // OPEN. The old code stamped the dedupe key on that first call regardless, so
    // the retry (same key) was wrongly treated as unchanged and never sent — the
    // PTY stayed stuck at the relay's 80x24 default.
    let lastKey = "";
    const key = "137x42";

    const atLaunch = decideResize(key, lastKey, false);
    expect(atLaunch).toEqual({ action: "defer" });
    // Caller contract: a "defer" must NOT advance the dedupe key.
    if (atLaunch.action === "send") lastKey = atLaunch.nextLastKey;

    const onReachable = decideResize(key, lastKey, true);
    expect(onReachable).toEqual({ action: "send", nextLastKey: key });
  });

  it("cold-launch hole: socket OPEN but bridge/peer unpaired still defers (OPEN alone is not reachable)", () => {
    // fix/terminal-dock-cold-launch-resize: the relay drops browser→bridge frames
    // with no buffering while no peer is attached. On a cold autolaunch the wss
    // handshake (~100-300ms) beats the helper→bridge attach (seconds), so the
    // socket reaches OPEN well before the bridge pairs. A resize computed in that
    // window must defer (isReachable=false) even though the socket is open —
    // sending it would be silently dropped by the relay and the key would wrongly
    // advance, permanently stranding the PTY at 80x24. The SAME key resolves to a
    // real send once the bridge attaches and reachability flips true.
    let lastKey = "";
    const key = "137x42";

    // Socket OPEN, but not yet reachable (bridge/peer not attached — status isn't
    // "connected" yet). Passing isReachable=false models exactly this state,
    // regardless of what ws.readyState reports.
    const openButUnpaired = decideResize(key, lastKey, false);
    expect(openButUnpaired).toEqual({ action: "defer" });
    if (openButUnpaired.action === "send") lastKey = openButUnpaired.nextLastKey;

    // Bridge attaches, status flips to "connected" → reachable → the deferred
    // dims finally go out.
    const onceReachable = decideResize(key, lastKey, true);
    expect(onceReachable).toEqual({ action: "send", nextLastKey: key });
  });

  it("a live-socket resize storm with unchanged dims stays deduped (existing behaviour preserved)", () => {
    let lastKey = "80x24";
    const first = decideResize("80x24", lastKey, true);
    expect(first).toEqual({ action: "skip" });
    // A genuinely new size still sends.
    const second = decideResize("100x28", lastKey, true);
    expect(second).toEqual({ action: "send", nextLastKey: "100x28" });
    if (second.action === "send") lastKey = second.nextLastKey;
    // And immediately repeating that size is deduped again.
    expect(decideResize("100x28", lastKey, true)).toEqual({ action: "skip" });
  });
});

describe("grace-window reconnect (fix/terminal-reconnect-reattach)", () => {
  it("the grace window is the sole reattach bound; TTL only bounds establishment", () => {
    // fix/terminal-expired-reattach: the relay waives token expiry for a same-owner
    // reattach to a LIVE session, so reattach is bounded purely by the grace window —
    // the dock keeps NO client-side expiry gate. The window still sits below the TTL
    // so a FIRST attach (never waived — no bound owner yet) always has a live token
    // for the whole launch flow.
    expect(RECONNECT_GRACE_MS).toBeLessThan(DEFAULT_TTL_SECONDS * 1000);
  });

  // The browser detectors are duplicated from terminal/shared/control-frames.mjs
  // (that module is plain .mjs outside the app's TS build graph). This pins them to
  // the REAL encoders the relay sends, so any drift fails here.
  it("detects the shared peer-degraded / peer-reattached frames the relay actually sends", () => {
    expect(isPeerDegradedFrame(encodePeerDegradedFrame())).toBe(true);
    expect(isPeerReattachedFrame(encodePeerReattachedFrame())).toBe(true);
  });

  it("each detector is strict to its own tag (mutually + attached-frame disjoint)", () => {
    expect(isPeerReattachedFrame(encodePeerDegradedFrame())).toBe(false);
    expect(isPeerDegradedFrame(encodePeerReattachedFrame())).toBe(false);
    expect(isPeerDegradedFrame(encodeAttachedFrame())).toBe(false);
    expect(isPeerReattachedFrame(encodeAttachedFrame())).toBe(false);
    expect(isPeerDegradedFrame("")).toBe(false);
    expect(isPeerDegradedFrame('{"t":"peer-degraded"' /* truncated */)).toBe(false);
  });
});

describe("silent-link watchdog (fix/terminal-dock-heartbeat)", () => {
  const connected = run([{ type: "connect" }, { type: "relay-open" }, { type: "data" }]);

  it("link-silent from connected → disconnected (recoverable, feeds the reattach loop)", () => {
    const s = terminalReducer(connected, { type: "link-silent" });
    expect(s.status).toBe("disconnected");
    expect(s.errorKind).toBeNull();
    expect(s.endedReason).toBeNull();
  });

  it("link-silent is ignored in every non-connected state", () => {
    const nonConnected: TerminalConnectionState[] = [
      initialConnectionState, // idle
      run([{ type: "connect" }]), // connecting
      run([{ type: "connect" }, { type: "relay-open" }]), // waiting-to-pair
      terminalReducer(connected, { type: "closed", code: RELAY_CLOSE.PEER_GONE }), // disconnected (already reconnecting)
      terminalReducer(connected, { type: "user-end" }), // session-ended
      run([{ type: "connect" }, { type: "session-mint-failed" }]), // error
    ];
    for (const state of nonConnected) {
      expect(terminalReducer(state, { type: "link-silent" })).toBe(state);
    }
  });

  // The heartbeat frame + ack detector are duplicated from
  // terminal/shared/control-frames.mjs (plain .mjs outside the TS build graph).
  // Pin BOTH directions byte-for-byte against the real shared encoders — the relay
  // auto-response matches the request string EXACTLY, so any drift breaks liveness.
  it("the probe frame is byte-for-byte the shared encoder's (relay auto-response matches exactly)", () => {
    expect(encodeHeartbeatFrame()).toBe(encodeSharedHeartbeatFrame());
    expect(isSharedHeartbeatFrame(encodeHeartbeatFrame())).toBe(true);
  });

  it("detects the shared hb-ack frame the relay actually echoes", () => {
    expect(isHeartbeatAckFrame(encodeSharedHeartbeatAckFrame())).toBe(true);
  });

  it("the ack detector is strict to its tag (disjoint from every other control frame)", () => {
    expect(isHeartbeatAckFrame(encodeSharedHeartbeatFrame())).toBe(false);
    expect(isHeartbeatAckFrame(encodeAttachedFrame())).toBe(false);
    expect(isHeartbeatAckFrame(encodePeerDegradedFrame())).toBe(false);
    expect(isHeartbeatAckFrame(encodePeerReattachedFrame())).toBe(false);
    expect(isHeartbeatAckFrame("")).toBe(false);
    expect(isHeartbeatAckFrame('{"t":"hb-ack"' /* truncated */)).toBe(false);
    // The other detectors must not claim the ack either.
    expect(isPeerDegradedFrame(encodeSharedHeartbeatAckFrame())).toBe(false);
    expect(isPeerReattachedFrame(encodeSharedHeartbeatAckFrame())).toBe(false);
  });

  it("detects the shared bridge-version frame byte-for-byte", () => {
    const frame = encodeSharedBridgeVersionFrame("0.2.0");
    expect(isBridgeVersionFrame(frame)).toBe(true);
    expect(parseBridgeVersionFrame(frame)).toBe("0.2.0");
  });

  it("the bridge-version detector/parser is strict to its tag (disjoint from every other control frame)", () => {
    expect(isBridgeVersionFrame(encodeSharedHeartbeatFrame())).toBe(false);
    expect(isBridgeVersionFrame(encodeSharedHeartbeatAckFrame())).toBe(false);
    expect(isBridgeVersionFrame(encodeAttachedFrame())).toBe(false);
    expect(isBridgeVersionFrame(encodePeerDegradedFrame())).toBe(false);
    expect(isBridgeVersionFrame(encodePeerReattachedFrame())).toBe(false);
    expect(isBridgeVersionFrame("")).toBe(false);
    expect(parseBridgeVersionFrame(encodeSharedHeartbeatAckFrame())).toBeNull();
    expect(parseBridgeVersionFrame(encodeAttachedFrame())).toBeNull();
    // The other detectors must not claim the bridge-version frame either.
    expect(isHeartbeatAckFrame(encodeSharedBridgeVersionFrame("0.2.0"))).toBe(false);
    expect(isPeerDegradedFrame(encodeSharedBridgeVersionFrame("0.2.0"))).toBe(false);
  });

  it("parseBridgeVersionFrame returns null for a non-string `v` or malformed JSON", () => {
    expect(parseBridgeVersionFrame('{"t":"bridge-version","v":123}')).toBeNull();
    expect(parseBridgeVersionFrame('{"t":"bridge-version"}')).toBeNull();
    expect(parseBridgeVersionFrame('{"t":"bridge-version"' /* truncated */)).toBeNull();
  });

  // Machine identity (Nick's sign-off change 2): the SAME frame gains an
  // optional `host` field — pin byte-for-byte against the real shared encoder,
  // same as the version field above.
  it("detects the shared bridge-version frame's host field byte-for-byte", () => {
    const frame = encodeSharedBridgeVersionFrame("0.3.2", "Nicks-MacBook-Pro");
    expect(isBridgeVersionFrame(frame)).toBe(true);
    expect(parseBridgeVersionFrame(frame)).toBe("0.3.2");
    expect(parseBridgeVersionHost(frame)).toBe("Nicks-MacBook-Pro");
  });

  it("parseBridgeVersionHost returns null when `host` is absent (old bridge — graceful degrade)", () => {
    const frame = encodeSharedBridgeVersionFrame("0.3.2");
    expect(parseBridgeVersionHost(frame)).toBeNull();
    expect(parseBridgeVersionFrame(frame)).toBe("0.3.2"); // version still parses fine
  });

  it("parseBridgeVersionHost returns null for a non-string `host` or malformed JSON", () => {
    expect(parseBridgeVersionHost('{"t":"bridge-version","v":"0.3.2","host":42}')).toBeNull();
    expect(parseBridgeVersionHost('{"t":"bridge-version"}')).toBeNull();
    expect(parseBridgeVersionHost('{"t":"bridge-version"' /* truncated */)).toBeNull();
  });

  it("a frame carrying only `host` (no version) still parses the host", () => {
    const frame = encodeSharedBridgeVersionFrame(undefined, "Nicks-MacBook-Pro");
    expect(isBridgeVersionFrame(frame)).toBe(true);
    expect(parseBridgeVersionFrame(frame)).toBeNull();
    expect(parseBridgeVersionHost(frame)).toBe("Nicks-MacBook-Pro");
  });

  // Exact-conversation resume (rework 5, card cbe60db5): the SAME frame gains
  // an optional `conv` field — pin byte-for-byte against the real shared
  // encoder, same as version/host above.
  const CONV_ID = "99999999-8888-7777-6666-555555555555";

  it("detects the shared bridge-version frame's conv field byte-for-byte", () => {
    const frame = encodeSharedBridgeVersionFrame("0.3.3", "Nicks-MacBook-Pro", CONV_ID);
    expect(isBridgeVersionFrame(frame)).toBe(true);
    expect(parseBridgeVersionFrame(frame)).toBe("0.3.3");
    expect(parseBridgeVersionHost(frame)).toBe("Nicks-MacBook-Pro");
    expect(parseBridgeVersionConv(frame)).toBe(CONV_ID);
  });

  it("parseBridgeVersionConv returns null when `conv` is absent (old bridge — graceful degrade)", () => {
    const frame = encodeSharedBridgeVersionFrame("0.3.3");
    expect(parseBridgeVersionConv(frame)).toBeNull();
    expect(parseBridgeVersionFrame(frame)).toBe("0.3.3"); // version still parses fine
  });

  it("parseBridgeVersionConv rejects a non-UUID/non-string `conv` or malformed JSON", () => {
    expect(parseBridgeVersionConv(`{"t":"bridge-version","conv":"not-a-uuid"}`)).toBeNull();
    expect(parseBridgeVersionConv('{"t":"bridge-version","conv":42}')).toBeNull();
    expect(parseBridgeVersionConv('{"t":"bridge-version"}')).toBeNull();
    expect(parseBridgeVersionConv('{"t":"bridge-version"' /* truncated */)).toBeNull();
  });

  it("a frame carrying only `conv` (no version/host) still parses the conv", () => {
    const frame = encodeSharedBridgeVersionFrame(undefined, undefined, CONV_ID);
    expect(isBridgeVersionFrame(frame)).toBe(true);
    expect(parseBridgeVersionFrame(frame)).toBeNull();
    expect(parseBridgeVersionHost(frame)).toBeNull();
    expect(parseBridgeVersionConv(frame)).toBe(CONV_ID);
  });

  it("a frame carrying a full-length version + host + conv stays within the control-frame length bound", () => {
    const frame = encodeSharedBridgeVersionFrame("999.999.999", "x".repeat(80), CONV_ID);
    expect(isBridgeVersionFrame(frame)).toBe(true);
    expect(parseBridgeVersionHost(frame)).toBe("x".repeat(80));
    expect(parseBridgeVersionConv(frame)).toBe(CONV_ID);
  });

  // Terminal P2 (E2EE, FR-5): the SAME frame gains an optional `e2ee` boolean —
  // pin byte-for-byte against the real shared encoder, same as version/host/conv.
  it("detects the shared bridge-version frame's e2ee field byte-for-byte", () => {
    const frame = encodeSharedBridgeVersionFrame("0.4.0", "Nicks-MacBook-Pro", undefined, true);
    expect(isBridgeVersionFrame(frame)).toBe(true);
    expect(parseBridgeVersionE2ee(frame)).toBe(true);
  });

  it("parseBridgeVersionE2ee returns false when `e2ee` is absent (old bridge — graceful degrade)", () => {
    const frame = encodeSharedBridgeVersionFrame("0.3.3");
    expect(parseBridgeVersionE2ee(frame)).toBe(false);
    expect(parseBridgeVersionFrame(frame)).toBe("0.3.3"); // version still parses fine
  });

  it("parseBridgeVersionE2ee rejects a falsy/non-boolean `e2ee` or malformed JSON", () => {
    expect(parseBridgeVersionE2ee(encodeSharedBridgeVersionFrame("0.4.0", undefined, undefined, false))).toBe(false);
    expect(parseBridgeVersionE2ee('{"t":"bridge-version","e2ee":"true"}')).toBe(false);
    expect(parseBridgeVersionE2ee('{"t":"bridge-version"}')).toBe(false);
    expect(parseBridgeVersionE2ee('{"t":"bridge-version"' /* truncated */)).toBe(false);
    expect(parseBridgeVersionE2ee(encodeSharedHeartbeatAckFrame())).toBe(false); // wrong tag entirely
  });

  it("shouldDeclareLinkSilent: exactly the threshold is NOT yet dead; strictly beyond is", () => {
    const last = 1_000_000;
    expect(shouldDeclareLinkSilent(last, last + LINK_SILENT_AFTER_MS, true)).toBe(false);
    expect(shouldDeclareLinkSilent(last, last + LINK_SILENT_AFTER_MS + 1, true)).toBe(true);
    expect(shouldDeclareLinkSilent(last, last, true)).toBe(false);
  });

  it("shouldDeclareLinkSilent: unarmed (no ack ever — old relay) never declares dead", () => {
    const last = 1_000_000;
    expect(shouldDeclareLinkSilent(last, last + LINK_SILENT_AFTER_MS * 100, false)).toBe(false);
  });

  it("the silence threshold tolerates lost acks (≥ 2 probe intervals of headroom)", () => {
    // One dropped ack must never be a false alarm; three probes fit in the window.
    expect(LINK_SILENT_AFTER_MS).toBeGreaterThanOrEqual(HEARTBEAT_INTERVAL_MS * 3);
  });
});

describe("connect() single-flight generation guard (PR #88)", () => {
  it("claimConnectGeneration returns the next generation", () => {
    expect(claimConnectGeneration(0)).toBe(1);
    expect(claimConnectGeneration(7)).toBe(8);
  });

  it("the attempt holding the current generation is NOT superseded (proceeds)", () => {
    expect(isConnectSuperseded(1, 1)).toBe(false);
  });

  it("an earlier attempt IS superseded once a later attempt claims (aborts)", () => {
    expect(isConnectSuperseded(1, 2)).toBe(true);
  });

  it("models two concurrent connect() attempts: the first aborts, the second proceeds", () => {
    // Shared generation counter, exactly as connectGenRef in the component.
    let counter = 0;
    // Attempt A claims a generation, then awaits its session mint...
    const aGen = (counter = claimConnectGeneration(counter)); // 1
    // ...while attempt B (concurrent double-activation) claims the next one.
    const bGen = (counter = claimConnectGeneration(counter)); // 2
    // Post-mint checkpoint: A sees it was superseded and bails BEFORE opening a
    // 2nd socket; B is still current and continues — so only one session/socket
    // ever goes live (the "connect fires twice" fix).
    expect(isConnectSuperseded(aGen, counter)).toBe(true);
    expect(isConnectSuperseded(bGen, counter)).toBe(false);
  });
});

describe("bring-back-from-pop-out state reset (fix/terminal-bringback-state-reset)", () => {
  it("a stray `data` event is ignored while status is error (no reducer forward edge — see the 'data' case's comment)", () => {
    const errored = run([{ type: "connect" }, { type: "session-mint-failed" }]);
    expect(errored.status).toBe("error");
    expect(terminalReducer(errored, { type: "data" })).toBe(errored);
  });

  it("the dock's own leg preempted by a pop-out (relay close 4001) lands in error/duplicate, and a stray data event there is still ignored", () => {
    const live = run([{ type: "connect" }, { type: "relay-open" }, { type: "data" }]);
    const preempted = terminalReducer(live, { type: "closed", code: RELAY_CLOSE.DUP_BROWSER });
    expect(preempted.status).toBe("error");
    expect(preempted.errorKind).toBe("duplicate");
    // A late message from the socket the relay already closed must not revive it.
    expect(terminalReducer(preempted, { type: "data" })).toBe(preempted);
  });

  it("the fresh-attach-reset sequence (connect → session-created → relay-open → data) reaches connected from error, sessionId retained", () => {
    const live = run([{ type: "connect" }, { type: "relay-open" }, { type: "data" }]);
    const preempted = terminalReducer(live, { type: "closed", code: RELAY_CLOSE.DUP_BROWSER });
    expect(preempted.status).toBe("error");

    // Exactly the sequence reconnectNow()'s "fresh-attach-reset" branch
    // dispatches (mirrors attachToExisting's two-dispatch reset) before it
    // reopens the browser leg — the relay's peer-reattached frame or the first
    // real PTY byte then lands as this final `data`.
    const reattached = run(
      [
        { type: "connect" },
        { type: "session-created", sessionId: "a3f9" },
        { type: "relay-open" },
        { type: "data" },
      ],
      preempted,
    );
    expect(reattached.status).toBe("connected");
    expect(reattached.sessionId).toBe("a3f9");
    expect(reattached.errorKind).toBeNull();
  });

  it("grace path is unchanged: a live drop (disconnected) reaches connected on `data` alone, no reset dispatches needed", () => {
    const dropped = run([
      { type: "connect" },
      { type: "relay-open" },
      { type: "data" },
      { type: "closed", code: RELAY_CLOSE.PEER_GONE },
    ]);
    expect(dropped.status).toBe("disconnected");
    const reconnected = terminalReducer(dropped, { type: "data" });
    expect(reconnected.status).toBe("connected");
    expect(reconnected.sessionId).toBe(dropped.sessionId);
  });
});

describe("decideReconnectNow (fix/terminal-bringback-state-reset)", () => {
  it("no retained pair → full-connect, regardless of status", () => {
    expect(decideReconnectNow("error", false, 1000, 0)).toBe("full-connect");
    expect(decideReconnectNow("idle", false, 1000, 0)).toBe("full-connect");
  });

  it("status error with a pair → fresh-attach-reset, regardless of the deadline bookkeeping", () => {
    // The ambient case: no prior drop ever routed through scheduleReconnect, so
    // the deadline is still 0 (exactly what a pop-out preemption looks like).
    expect(decideReconnectNow("error", true, 1000, 0)).toBe("fresh-attach-reset");
    // Even a stale/spent or still-open deadline from an unrelated prior drop
    // must not override an "error" status.
    expect(decideReconnectNow("error", true, 5000, 1000)).toBe("fresh-attach-reset");
    expect(decideReconnectNow("error", true, 1000, 5000)).toBe("fresh-attach-reset");
  });

  it("status disconnected with a pair, deadline unset or still open → grace-reconnect (unchanged ambient path)", () => {
    expect(decideReconnectNow("disconnected", true, 1000, 0)).toBe("grace-reconnect");
    expect(decideReconnectNow("disconnected", true, 1000, 5000)).toBe("grace-reconnect");
  });

  it("status disconnected with a pair, deadline already spent → full-connect (grace window exhausted)", () => {
    expect(decideReconnectNow("disconnected", true, 5000, 1000)).toBe("full-connect");
  });
});

// ── probe-before-declare (1–2 Sep 2026 incident) ─────────────────────────────
// A hidden tab's throttled timers make >45 s of silence routine on a healthy
// socket; the watchdog now sends one heartbeat and waits LINK_SILENT_PROBE_MS
// for ANY inbound frame before declaring the link dead.
describe("silent-link watchdog — probe before declaring", () => {
  const probeSentAt = 100_000;

  it("does not declare while the probe window is still open, even with nothing inbound", () => {
    expect(shouldDeclareAfterProbe(probeSentAt - LINK_SILENT_AFTER_MS - 1, probeSentAt, probeSentAt + LINK_SILENT_PROBE_MS - 1)).toBe(false);
  });

  it("declares once the probe window has elapsed with nothing inbound since the probe", () => {
    expect(shouldDeclareAfterProbe(probeSentAt - LINK_SILENT_AFTER_MS - 1, probeSentAt, probeSentAt + LINK_SILENT_PROBE_MS)).toBe(true);
  });

  it("never declares when anything arrived after the probe (an ack or PTY bytes prove the link)", () => {
    expect(shouldDeclareAfterProbe(probeSentAt + 10, probeSentAt, probeSentAt + LINK_SILENT_PROBE_MS * 5)).toBe(false);
    // Arriving in the same millisecond as the probe counts too.
    expect(shouldDeclareAfterProbe(probeSentAt, probeSentAt, probeSentAt + LINK_SILENT_PROBE_MS * 5)).toBe(false);
  });

  it("the probe window is short enough not to hide a genuinely dead link for long", () => {
    expect(LINK_SILENT_PROBE_MS).toBeLessThanOrEqual(10_000);
  });

  it("a reattach waits a bounded, token-safe time for bridge evidence before relaunching", () => {
    // Bridge tokens live DEFAULT_TTL_SECONDS; the wait must be a small fraction of that.
    expect(RELAUNCH_IF_BRIDGE_SILENT_MS).toBeGreaterThanOrEqual(1_000);
    expect(RELAUNCH_IF_BRIDGE_SILENT_MS).toBeLessThan(DEFAULT_TTL_SECONDS * 1000 / 10);
  });
});
