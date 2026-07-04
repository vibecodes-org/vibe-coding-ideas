import { describe, it, expect } from "vitest";
import {
  RELAY_CLOSE,
  RECONNECT_GRACE_MS,
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
  shouldDeclareLinkSilent,
  buildRelayUrl,
  encodeResizeMessage,
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
} from "../../../terminal/shared/control-frames.mjs";

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

  it("4006 → bad-token error", () => {
    expect(mapCloseCode(RELAY_CLOSE.BAD_TOKEN, undefined, "connecting").errorKind).toBe("bad-token");
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

describe("grace-window reconnect (fix/terminal-reconnect-reattach)", () => {
  it("the reconnect window stays strictly inside the token TTL (no re-mint)", () => {
    // The whole point: original tokens must still be valid for the entire window, so
    // a reattach never needs a fresh mint. Keep a safety margin below the 300s TTL.
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
