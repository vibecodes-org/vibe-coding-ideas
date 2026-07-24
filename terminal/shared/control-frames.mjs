// Shared relay→bridge control frame — the R1 "attached" confirmation.
//
// The relay REJECTS a bad leg by `accept()`ing the WebSocket and immediately
// closing it with an app close code (4005/4006/…), so a client-side `onopen`
// alone does NOT prove the token was accepted. A prompt-carrying bridge must
// therefore defer its PTY spawn until the relay explicitly confirms the attach
// (acceptance criterion: the URL-carried prompt never reaches a child process
// before the owner-bound token passes authorizeAttach + decideAttach).
//
// This module is that confirmation's ONE definition, imported by:
//   - the Cloudflare relay DO   (relay/src/index.js)     — SENDS it to the
//     bridge leg only, immediately after a successful accept
//   - the Node stand-in relay   (test/standin-relay.mjs) — same
//   - the bridge                (bridge/src/index.js)    — WAITS on it before
//     spawning a prompt-carrying PTY (promptless launches spawn immediately,
//     exactly as before — version-skew safe with an old relay)
//
// Wire form: a TEXT frame `{"t":"attached"}`. TEXT frames are already the
// control channel (see bridge/src/framing.js); the browser dock ignores TEXT
// frames entirely, and an OLD bridge treats an unknown control frame as a
// logged no-op — so sending this unconditionally is skew-safe in both
// directions. The key `t` (not `type`) keeps it disjoint from the browser→
// bridge control namespace (`{"type":"resize",…}`).
//
// GRACE-WINDOW REATTACH (fix/terminal-reconnect-reattach) adds two more relay→leg
// TEXT control frames in the SAME `{"t":…}` namespace, sent instead of a hard
// PEER_GONE close while a session is held open for the reconnect grace window:
//   - `{"t":"peer-degraded"}`   — sent to the SURVIVING leg the moment its peer
//     drops. "Your peer went away; I'm holding the session — keep your stream,
//     it may resume." The survivor is NOT closed.
//   - `{"t":"peer-reattached"}` — sent to BOTH legs once the dropped peer
//     re-attaches (same sid + owner) inside the window and the pair is whole
//     again. "Resume — the pairing is restored."
// Both are skew-safe exactly like `attached`: an old bridge logs-and-ignores an
// unknown control frame, and a browser dock that doesn't know them treats them
// as a no-op.
//
// LINK-LIVENESS HEARTBEAT (fix/terminal-dock-heartbeat) adds a browser→relay probe
// pair in the SAME `{"t":…}` namespace. macOS never RSTs a socket when the network
// silently dies (wifi off / network switch), so the browser leg needs an app-level
// echo to prove the link is alive — the protocol-level pings the bridge relies on
// are invisible to browser JS:
//   - `{"t":"hb"}`     — sent BY the browser dock every ~15s while connected.
//   - `{"t":"hb-ack"}` — echoed BY the relay, to the SENDING leg only. Never
//     forwarded to the peer and never counted as session activity (the 30-min
//     idle cap is unaffected). On Cloudflare this is a hibernation-safe
//     setWebSocketAutoResponse pair — zero DO wakes.
// Skew-safe both ways: an OLD relay forwards the hb to the bridge, which
// logs-and-ignores it as an unknown control frame; the dock's watchdog only ARMS
// on the first hb-ack, so with an old relay (no ack, ever) the pre-watchdog
// behaviour is unchanged.
//
// HELPER-VERSION ANNOUNCEMENT (release-gate rework 2a) adds one more relay->browser
// TEXT control frame in the SAME `{"t":…}` namespace:
//   - `{"t":"bridge-version","v":"x.y.z"}` — sent by the relay to the BROWSER leg
//     only, carrying the version the bridge announced on its own attach (via a
//     `helperVersion` query param on its relay connect URL — see
//     terminal/bridge/src/index.js). The relay is a dumb, honest forwarder here:
//     it validates the shape (strict x.y.z, bounded length) and stores it durably
//     so it can be re-sent regardless of WHICH leg attaches first (relay/src/index.js
//     TerminalRelay.fetch), but never interprets the version itself — the
//     comparison/gating policy is the browser dock's job (src/lib/terminal/
//     helper-version.ts). Skew-safe: an OLD bridge never sends `helperVersion` (the
//     relay simply has nothing to forward), and a dock that predates this frame
//     ignores an unknown `t` tag exactly like it already does for any other one.

/** Detect any control TEXT frame with a given `t` tag. Cheap + strict + bounded. */
function isControlFrame(text, tag) {
  if (typeof text !== "string" || text.length === 0 || text.length > 64) return false;
  try {
    const msg = JSON.parse(text);
    return !!msg && typeof msg === "object" && msg.t === tag;
  } catch {
    return false;
  }
}

/** The exact TEXT frame the relay sends the bridge leg on successful attach. */
export function encodeAttachedFrame() {
  return JSON.stringify({ t: "attached" });
}

/**
 * Whether a received TEXT frame is the relay's attach confirmation.
 * Cheap + strict: bounded length, valid JSON, `t === "attached"`.
 *
 * @param {unknown} text
 * @returns {boolean}
 */
export function isAttachedFrame(text) {
  return isControlFrame(text, "attached");
}

/** TEXT frame the relay sends the SURVIVOR when its peer drops (grace window opened). */
export function encodePeerDegradedFrame() {
  return JSON.stringify({ t: "peer-degraded" });
}

/** @param {unknown} text @returns {boolean} */
export function isPeerDegradedFrame(text) {
  return isControlFrame(text, "peer-degraded");
}

/** TEXT frame the relay sends BOTH legs once the pair is whole again inside the window. */
export function encodePeerReattachedFrame() {
  return JSON.stringify({ t: "peer-reattached" });
}

/** @param {unknown} text @returns {boolean} */
export function isPeerReattachedFrame(text) {
  return isControlFrame(text, "peer-reattached");
}

/** TEXT frame the browser dock sends the relay as its app-level liveness probe. */
export function encodeHeartbeatFrame() {
  return JSON.stringify({ t: "hb" });
}

/** @param {unknown} text @returns {boolean} */
export function isHeartbeatFrame(text) {
  return isControlFrame(text, "hb");
}

/** TEXT frame the relay echoes back to the PROBING leg only (never forwarded). */
export function encodeHeartbeatAckFrame() {
  return JSON.stringify({ t: "hb-ack" });
}

/** @param {unknown} text @returns {boolean} */
export function isHeartbeatAckFrame(text) {
  return isControlFrame(text, "hb-ack");
}

/** Strict `x.y.z` (non-negative integers only) shape guard — mirrors
 *  src/lib/terminal/helper-version.ts's parser so the relay never forwards
 *  something the dock's gating logic can't parse. */
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

/** TEXT frame the relay sends the BROWSER leg announcing the bridge's helper version. */
export function encodeBridgeVersionFrame(version) {
  return JSON.stringify({ t: "bridge-version", v: version });
}

/** @param {unknown} text @returns {boolean} */
export function isBridgeVersionFrame(text) {
  return isControlFrame(text, "bridge-version");
}

/**
 * Extract + validate the version carried by a bridge-version frame. Returns
 * null for anything not shaped like a strict `x.y.z` string — a malformed or
 * hostile `v` is treated identically to "no version announced" by the caller.
 * @param {unknown} text
 * @returns {string | null}
 */
export function parseBridgeVersionFrame(text) {
  if (!isBridgeVersionFrame(text)) return null;
  try {
    const msg = JSON.parse(text);
    return typeof msg.v === "string" && SEMVER_RE.test(msg.v) ? msg.v : null;
  } catch {
    return null;
  }
}

/**
 * Validate a raw `helperVersion` value (e.g. straight off a URL query param)
 * before it's ever stored/forwarded — the ONE gate the relay applies so a
 * hostile/malformed bridge can't smuggle arbitrary text into a control frame
 * the browser dock parses.
 * @param {unknown} raw
 * @returns {string | null}
 */
export function sanitizeHelperVersion(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return SEMVER_RE.test(trimmed) ? trimmed : null;
}
