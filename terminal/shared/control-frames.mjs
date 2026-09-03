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
//     forwarded to the peer and never counted as session activity (the 2-hour
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
//
// MACHINE IDENTITY (Nick's sign-off change 2 — "hide conversations that aren't on
// the machine that you're running vibecodes on") extends this SAME frame with an
// optional `host` field: `{"t":"bridge-version","v":"x.y.z","host":"Nicks-MBP"}`.
// The bridge announces `os.hostname()` (sanitized with `sanitizeMachineLabel`
// below — same query-param path as `helperVersion`, see terminal/bridge/src/
// index.js) alongside its version; the relay stores it durably as `bridgeHost`
// (mirroring `bridgeHelperVersion`) and replays it to a late-attaching browser
// leg exactly like the version. Extending the existing frame (rather than adding
// a new one) keeps this skew-safe the same way: an OLD bridge never sends `host`
// at all (the relay has nothing to forward, `host` is simply absent), and a dock
// that predates this field ignores the unknown key. `host` is OPTIONAL even on a
// frame that also carries `v` — either field alone is a valid, useful frame.
//
// HELPER LIFECYCLE (card cc74a067) adds three more control frames, all scoped to
// the NEW `helper` leg (terminal/helper/main.js's persistent control connection —
// see session-token.mjs's "helper" role) — never sent on a bridge/browser leg:
//   - `{"t":"helper-cmd","cmd":"stop"|"quiesce"|"set-always-on","value"?:boolean}`
//     — sent by the relay to the HELPER leg, forwarding a web-originated command
//     (POST /helper/command, see relay/src/index.js). `value` is present only for
//     `set-always-on`. The relay never interprets `cmd` — it is a dumb forwarder,
//     exactly like the bridge-version frame above; the helper decides what each
//     command means.
//   - `{"t":"goodbye","reason":"idle-quit"|"stop"|"quiesce"|"quit"|"crash"}` — sent
//     by the HELPER to the relay immediately before every CLEAN exit (never on a
//     crash-then-kill — there the process may not get a chance to flush). Its
//     ABSENCE before a helper leg's socket closes is exactly what the relay/web
//     app class as "stopped unexpectedly" (design §5a chip) — see
//     HELPER_GOODBYE_REASONS below for the closed set of valid reasons.
//   - `{"t":"always-on","value":boolean}` — sent by the HELPER to the relay right
//     after attach (reporting its persisted setting) and again whenever the
//     setting changes locally (the tray checkbox, or echoing a `set-always-on`
//     command). The relay stores it durably so a `GET /helper/status` call always
//     has a current answer without waking the helper.
// All three are skew-safe the same way as every frame above: an old relay/helper
// that doesn't know a tag treats it as an unknown control frame and ignores it.
//
// EXACT-CONVERSATION RESUME (rework 5, card cbe60db5 — Nick's field test: a
// Resume click resumed the wrong conversation because `claude --continue`
// only ever continues whatever's most recent ON DISK in a folder, not the
// specific chooser row clicked) extends the SAME bridge-version frame with a
// third optional field: `{"t":"bridge-version","v":"x.y.z","host":"…","conv":
// "<uuid>"}`. `conv` is the id of the CLAUDE CONVERSATION the bridge just
// spawned or resumed — minted by the bridge itself via `--session-id <uuid>`
// for a brand-new session, or the `--resume <uuid>` id it was handed for a
// tracked one (terminal/bridge/src/index.js's resolveClaudeLaunch). Verified
// empirically: `claude --resume <id>` keeps appending to the SAME <id>.jsonl
// transcript forever (never forks to a new id), so the id announced here is
// exactly the id every future Resume of this row needs to reach the same
// conversation. Same skew-safe shape as `v`/`host`: optional, independently
// present, ignored by anything that predates it.

/** The closed set of reasons a helper's goodbye frame may carry (design §2 table). */
export const HELPER_GOODBYE_REASONS = Object.freeze([
  "idle-quit",
  "stop",
  "quiesce",
  "quit",
  "crash",
]);

/** The closed set of commands the web app may forward to a helper leg. */
export const HELPER_COMMANDS = Object.freeze(["stop", "quiesce", "set-always-on"]);

/** Detect any control TEXT frame with a given `t` tag. Cheap + strict + bounded.
 *  200 (not the original 64, bumped from 160 for the `conv` field) is sized to
 *  fit the bridge-version frame's worst case — `v` (semver) plus a full
 *  80-char `host` (sanitizeMachineLabel's own cap) plus a 36-char `conv` UUID
 *  plus JSON overhead (176 bytes measured) — while staying a trivially
 *  bounded, DoS-safe size for every other (much shorter) control frame that
 *  shares this same gate. */
function isControlFrame(text, tag) {
  if (typeof text !== "string" || text.length === 0 || text.length > 200) return false;
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

/**
 * TEXT frame the relay sends the BROWSER leg announcing the bridge's helper
 * version, machine identity, and/or the id of the claude conversation it just
 * spawned/resumed (exact-conversation Resume, rework 5). Every field is
 * optional (omitted whenever falsy) so a call site that only knows a subset
 * still emits a valid, minimal frame — see this module's MACHINE IDENTITY and
 * EXACT-CONVERSATION RESUME header comments.
 * @param {string | null | undefined} version
 * @param {string | null | undefined} [host]
 * @param {string | null | undefined} [conv]
 * @param {boolean} [e2ee]
 * @returns {string}
 */
export function encodeBridgeVersionFrame(version, host, conv, e2ee) {
  const msg = { t: "bridge-version" };
  if (version) msg.v = version;
  if (host) msg.host = host;
  if (conv) msg.conv = conv;
  // E2EE CAPABILITY NEGOTIATION (Terminal P2, FR-5): a bridge that was handed
  // a session key (see terminal/bridge/src/index.js) announces `e2ee:true`
  // alongside its version/host/conv, on the SAME frame — no new relay message
  // type, exactly the "reuse the existing bridge-version announce/forward
  // mechanism" FR-3 requires. Boolean, omitted entirely (not `false`) when
  // the bridge has no key, so an old bridge (or one that failed to receive a
  // key) is indistinguishable from "capability unknown" — the dock's gating
  // policy (src/lib/terminal/e2ee-policy.ts) treats missing exactly like
  // false, same graceful-degrade shape as a missing `v`/`host`/`conv`.
  if (e2ee) msg.e2ee = true;
  return JSON.stringify(msg);
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
 * Extract + validate the HOST carried by a bridge-version frame (Nick's
 * sign-off change 2 — per-session machine identity). Returns null for
 * anything absent/malformed — an OLD bridge never sends `host` at all, which
 * parses identically to "unknown" here (the same graceful-degrade shape as a
 * missing `v`). Re-validated with `sanitizeMachineLabel` even though the relay
 * already sanitized it before forwarding — defense in depth, never trust the
 * wire twice-removed from the source.
 * @param {unknown} text
 * @returns {string | null}
 */
export function parseBridgeVersionHost(text) {
  if (!isBridgeVersionFrame(text)) return null;
  try {
    const msg = JSON.parse(text);
    return typeof msg.host === "string" ? sanitizeMachineLabel(msg.host) : null;
  } catch {
    return null;
  }
}

/**
 * Extract + validate the claude conversation id carried by a bridge-version
 * frame (exact-conversation Resume, rework 5). Returns null for anything
 * absent/malformed — an OLD bridge never sends `conv` at all, which parses
 * identically to "unknown" here (the same graceful-degrade shape as a missing
 * `v`/`host`). Re-validated with `sanitizeConversationId` even though the
 * relay already sanitized it before forwarding — defense in depth, never
 * trust the wire twice-removed from the source.
 * @param {unknown} text
 * @returns {string | null}
 */
export function parseBridgeVersionConv(text) {
  if (!isBridgeVersionFrame(text)) return null;
  try {
    const msg = JSON.parse(text);
    return typeof msg.conv === "string" ? sanitizeConversationId(msg.conv) : null;
  } catch {
    return null;
  }
}

/**
 * Extract the bridge's announced E2EE capability (Terminal P2, FR-5). Returns
 * `true` only for the literal boolean `true` — anything else (absent,
 * malformed, `false`) is treated as "not encrypted", never trusted as
 * capable by default. Same defense-in-depth re-validation posture as
 * parseBridgeVersionHost/parseBridgeVersionConv.
 * @param {unknown} text
 * @returns {boolean}
 */
export function parseBridgeVersionE2ee(text) {
  if (!isBridgeVersionFrame(text)) return false;
  try {
    const msg = JSON.parse(text);
    return msg.e2ee === true;
  } catch {
    return false;
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

/**
 * Validate a raw machine-label value (e.g. `os.hostname()`, carried as a URL
 * query param on the helper's connect URL) before it's stored/forwarded. Unlike
 * the version, this is a free-form display string — the only gate is "not
 * absurd": bounded length, trimmed, never a non-string. Never trust it as
 * anything but display text (never used in a path, command, or comparison).
 * @param {unknown} raw
 * @returns {string | null}
 */
export function sanitizeMachineLabel(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, 80);
}

/** Strict UUID shape (any version/variant — `crypto.randomUUID()`'s own shape,
 *  and whatever `claude --session-id`/`--resume` accept). Mirrors the format
 *  the `claude` CLI itself requires ("must be a valid UUID"). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate a raw claude-conversation-id value (exact-conversation Resume,
 * rework 5 — e.g. a `conv`/`resume_id` query param, or a `claude_session_id`
 * DB column value) before it's stored/forwarded/spawned-with. A strict UUID
 * gate: this value is later interpolated into a shell-split bridge CMD
 * string (`claude --resume <id>`/`claude --session-id <id>`), so anything
 * that isn't exactly a UUID is rejected outright rather than sanitized —
 * there is no safe partial value here, unlike the free-form machine label.
 * Lower-cased so a case-varying but otherwise valid id always compares equal.
 * @param {unknown} raw
 * @returns {string | null}
 */
export function sanitizeConversationId(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return UUID_RE.test(trimmed) ? trimmed.toLowerCase() : null;
}

// ── helper-command frame (web -> relay -> helper leg) ─────────────────────────

/**
 * The TEXT frame the relay forwards to a live `helper` leg. `value` is included
 * only for `set-always-on` (a boolean); omitted for `stop`/`quiesce`.
 * @param {"stop"|"quiesce"|"set-always-on"} cmd
 * @param {boolean} [value]
 * @returns {string}
 */
export function encodeHelperCommandFrame(cmd, value) {
  return JSON.stringify(value === undefined ? { t: "helper-cmd", cmd } : { t: "helper-cmd", cmd, value });
}

/** @param {unknown} text @returns {boolean} */
export function isHelperCommandFrame(text) {
  return isControlFrame(text, "helper-cmd");
}

/**
 * Extract + validate a helper-command frame's `cmd` (and `value` for
 * `set-always-on`). Returns null for anything not shaped like a known command —
 * a malformed or hostile frame is treated identically to "no command", never
 * forwarded to helper-side logic that could misinterpret it.
 * @param {unknown} text
 * @returns {{ cmd: "stop"|"quiesce"|"set-always-on", value?: boolean } | null}
 */
export function parseHelperCommandFrame(text) {
  if (!isHelperCommandFrame(text)) return null;
  try {
    const msg = JSON.parse(text);
    if (typeof msg.cmd !== "string" || !HELPER_COMMANDS.includes(msg.cmd)) return null;
    if (msg.cmd === "set-always-on") {
      return typeof msg.value === "boolean" ? { cmd: msg.cmd, value: msg.value } : null;
    }
    return { cmd: msg.cmd };
  } catch {
    return null;
  }
}

// ── goodbye frame (helper leg -> relay, sent immediately before every clean exit) ──

/**
 * The TEXT frame a helper sends the relay right before a CLEAN close. Its
 * absence before the socket actually closes is what marks a disconnect
 * "stopped unexpectedly" (design §5a) — see HELPER_GOODBYE_REASONS.
 * @param {"idle-quit"|"stop"|"quiesce"|"quit"|"crash"} reason
 * @returns {string}
 */
export function encodeGoodbyeFrame(reason) {
  return JSON.stringify({ t: "goodbye", reason });
}

/** @param {unknown} text @returns {boolean} */
export function isGoodbyeFrame(text) {
  return isControlFrame(text, "goodbye");
}

/**
 * Extract + validate a goodbye frame's reason. Null for anything outside the
 * closed HELPER_GOODBYE_REASONS set — an unrecognised reason is treated the
 * same as no goodbye at all (never invent a lifecycle state the UI can't show).
 * @param {unknown} text
 * @returns {"idle-quit"|"stop"|"quiesce"|"quit"|"crash"|null}
 */
export function parseGoodbyeReason(text) {
  if (!isGoodbyeFrame(text)) return null;
  try {
    const msg = JSON.parse(text);
    return typeof msg.reason === "string" && HELPER_GOODBYE_REASONS.includes(msg.reason) ? msg.reason : null;
  } catch {
    return null;
  }
}

// ── always-on frame (helper leg -> relay, on attach + whenever the setting changes) ──

/**
 * The TEXT frame a helper sends the relay to report its current "Keep helper
 * ready" setting — once right after attach, and again whenever it changes
 * locally (the tray checkbox, or echoing a `set-always-on` command).
 * @param {boolean} value
 * @returns {string}
 */
export function encodeAlwaysOnFrame(value) {
  return JSON.stringify({ t: "always-on", value: !!value });
}

/** @param {unknown} text @returns {boolean} */
export function isAlwaysOnFrame(text) {
  return isControlFrame(text, "always-on");
}

/**
 * Extract + validate an always-on frame's boolean value. Null for anything
 * malformed — the caller keeps whatever value it last had rather than trusting
 * a non-boolean.
 * @param {unknown} text
 * @returns {boolean | null}
 */
export function parseAlwaysOnValue(text) {
  if (!isAlwaysOnFrame(text)) return null;
  try {
    const msg = JSON.parse(text);
    return typeof msg.value === "boolean" ? msg.value : null;
  } catch {
    return null;
  }
}
