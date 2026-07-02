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
  if (typeof text !== "string" || text.length === 0 || text.length > 64) return false;
  try {
    const msg = JSON.parse(text);
    return !!msg && typeof msg === "object" && msg.t === "attached";
  } catch {
    return false;
  }
}
