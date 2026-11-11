// Session-to-session messages (card f0a13bde): the dependency-free pieces the
// relay needs too (a Cloudflare Worker has no node:crypto). Constants, the
// bridge's answer frame, the "a message arrived" notice for the browser tab,
// and the test for frames a browser must never be allowed to send.

export const PEER_MAX_CHARS = 2000;
/** A signed message is refused when its timestamp is older (or newer) than this. */
export const PEER_MAX_AGE_MS = 2 * 60 * 1000;
/** Held messages are dropped after this long, and at most this many are held. */
export const PEER_HOLD_MAX_MS = 30 * 60 * 1000;
export const PEER_HOLD_MAX_COUNT = 20;
/** Loop guard, counted per receiving session by the relay. */
export const PEER_RATE_PER_MINUTE = 10;
export const PEER_RATE_PER_HOUR = 60;
/** The first helper that understands peer messages. Below this the relay says "helper too old". */
export const PEER_MESSAGE_MIN_HELPER = "0.3.33";

export const PEER_AGENTS = Object.freeze(["claude", "codex"]);
export const PEER_AGENT_LABEL = Object.freeze({ claude: "Claude Code", codex: "Codex" });

/** What the bridge tells the relay, and the relay tells the app. */
export const PEER_OUTCOMES = Object.freeze([
  "delivered",
  "waiting",
  "not-running",
  "helper-too-old",
  "cannot-receive",
  "rate-limited",
  "unconfirmed",
  "rejected",
]);

export function encodePeerAckFrame(id, outcome) {
  return JSON.stringify({ t: "peer-message-ack", id, outcome });
}

/** @returns {{ id: string, outcome: string } | null} */
export function parsePeerAckFrame(text) {
  if (typeof text !== "string" || text.length === 0 || text.length > 512) return null;
  try {
    const m = JSON.parse(text);
    if (!m || m.t !== "peer-message-ack" || typeof m.id !== "string" || !PEER_OUTCOMES.includes(m.outcome)) return null;
    return { id: m.id, outcome: m.outcome };
  } catch {
    return null;
  }
}

/** Relay to browser: a message arrived (name only, never the text). */
export function encodePeerNoticeFrame(fromName) {
  return JSON.stringify({ t: "peer-message-notice", fromName: String(fromName ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Untitled session" });
}

export function isPeerNoticeFrame(text) {
  if (typeof text !== "string" || text.length === 0 || text.length > 400) return false;
  try {
    const m = JSON.parse(text);
    return !!m && m.t === "peer-message-notice";
  } catch {
    return false;
  }
}

/** True for a text frame a browser must never be allowed to send toward a bridge. */
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

/**
 * True when `version` ("0.3.33") is at least `min`. Missing or unreadable is
 * "no": a helper that never reported a version is an old one.
 * @param {unknown} version @param {string} min
 */
export function helperVersionAtLeast(version, min) {
  const parse = (v) => {
    const m = /^(\d{1,5})\.(\d{1,5})\.(\d{1,5})/.exec(String(v ?? "").trim());
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  const a = parse(version);
  const b = parse(min);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return true;
}
