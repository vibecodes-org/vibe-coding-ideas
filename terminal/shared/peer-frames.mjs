// Session-to-session messages (card f0a13bde): the dependency-free pieces.
//
// Messages travel only inside the person's Mac: the Mac app passes them
// between its own sessions, and they never go through the relay or VibeCodes'
// servers. The relay still uses isPeerBridgeFrameType to drop any old-style
// message frame, because Mac apps before 0.3.39 would act on one.

export const PEER_MAX_CHARS = 2000;
/** Held messages are dropped after this long, and at most this many are held. */
export const PEER_HOLD_MAX_MS = 30 * 60 * 1000;
export const PEER_HOLD_MAX_COUNT = 20;
/** Loop guard, counted per receiving session by the Mac app. */
export const PEER_RATE_PER_MINUTE = 10;
export const PEER_RATE_PER_HOUR = 60;

export const PEER_AGENTS = Object.freeze(["claude", "codex"]);
export const PEER_AGENT_LABEL = Object.freeze({ claude: "Claude Code", codex: "Codex" });

/** True for an old-style message frame, which nothing may pass toward a bridge. */
export function isPeerBridgeFrameType(text) {
  if (typeof text !== "string" || text.length > 20000) return false;
  if (!text.includes("peer-message")) return false;
  try {
    const m = JSON.parse(text);
    return !!m && (m.t === "peer-message" || m.t === "peer-message-ack" || m.t === "peer-message-notice");
  } catch {
    return false;
  }
}
