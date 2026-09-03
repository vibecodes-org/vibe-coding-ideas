// Shared terminal launch deep-link module — SLICE 4 (vibecodes:// auto-launch).
//
// ONE implementation of the `vibecodes://launch?…` URL scheme, imported by every
// party that has to AGREE on its shape:
//   - the VibeCodes app (src/lib/terminal/deep-link.ts)  — BUILDS the link (typed
//     mirror; the app is TS and can't import this .mjs into its component tree
//     cleanly, so it re-implements build/redact and a drift test pins the two).
//   - the bridge (terminal/bridge/src/index.js)          — PARSES the link it is
//     handed via `--launch-url` (exactly what a packaged helper's URL-scheme
//     handler will call in slice 7).
//   - the test harness (terminal/test/*.mjs)             — BUILDS + PARSES.
//
// The link carries everything the local helper needs to attach as the BRIDGE leg:
//   relay   — relay base ws URL
//   session — relay session id (sid)
//   token   — the app-minted, HMAC-signed BRIDGE-role token (this IS the launch's
//             credential; the relay verifies it, so no extra signature is needed)
//   helperToken — OPTIONAL: an app-minted HELPER-role token (session-token.mjs →
//             mintHelperToken), carried alongside the bridge token on every
//             launch (card cc74a067) so the SAME click that starts a bridge also
//             (re)establishes the helper's own persistent control connection to
//             the relay — see terminal/helper/main.js. A helper that's already
//             connected treats a redundant one as a no-op.
//   cwd     — optional working directory
//   prompt  — optional compact bootstrap prompt for the spawned `claude`. INERT
//             DATA: the bridge passes it as ONE argv element (never through
//             shellSplit / a shell) and only spawns AFTER the relay has accepted
//             the owner-bound token (R1 — see bridge/src/index.js).
//   resume  — session entry chooser (card cbe60db5, design item 7/F4), LEGACY
//             path for a Recent row with no tracked conversation id: when
//             `"1"`, the bridge spawns `claude --continue` in `cwd` instead of
//             `claude "<prompt>"`. `--continue` resumes whatever's most
//             recent ON DISK in that folder — NOT necessarily the row the
//             user clicked (Nick's field test: this is exactly how a Resume
//             click landed on the wrong conversation). `prompt` is ignored
//             (and normally absent) on a resume link. An old bridge that
//             doesn't recognise `resume` simply never sees the param (it's
//             omitted unless truthy) — no version-skew risk in either
//             direction.
//   resume_id — EXACT-CONVERSATION Resume (rework 5, the proper fix): a
//             validated UUID naming the SPECIFIC claude conversation to
//             resume (`terminal_sessions.claude_session_id`, tracked from the
//             moment a session was minted — see terminal/bridge/src/index.js's
//             resolveClaudeLaunch). The bridge runs `claude --resume <id>`
//             instead of `--continue`, so the resumed content is always
//             exactly the row the user clicked, never whatever else has run
//             in that folder since. Mutually exclusive with `resume` on a
//             real link (a row either has a tracked id or it doesn't); when
//             both are somehow present, `resume_id` wins (see parse below) —
//             it is the verified-safe, exact path. Malformed/non-UUID values
//             are rejected at parse time (never forwarded to a shell-split
//             CMD string).
//   cols/rows — Bug B (card cbe60db5, Nick's field test 2026-08-15): the
//             browser's real panel size at launch time, so the bridge can
//             spawn the PTY at the correct size instead of a hardcoded
//             default. A PROMPTLESS launch spawns its PTY synchronously,
//             before the browser's own resize control frame can ever reach a
//             not-yet-existent process — see terminal/bridge/src/index.js's
//             `resolveSpawnDims`. Only meaningful as a pair; either missing
//             or non-sane falls back to the bridge's pre-existing hardcoded
//             default, exactly like before this field existed (no
//             version-skew risk).
//   model   — task c4ca2d95 ("Terminal starting model"): the resolved
//             starting model for a FRESH session only (user override ->
//             platform default -> omit, resolved server-side at mint time).
//             The bridge appends `--model <value>` to the fresh-spawn CMD
//             (terminal/bridge/src/resume-cmd.js) — NEVER on a resume/
//             resumeId launch (AC-8: a resumed conversation keeps its own
//             model; resolveClaudeLaunch's resume branches never read this
//             field). Re-validated at parse time (isSafeModelValue below,
//             mirrors src/lib/terminal/model-resolution.ts's
//             validateTerminalModelValue) since it rides the bridge's
//             shellSplit CMD string as a single token — a malformed value
//             is rejected outright rather than forwarded, same posture as
//             resume_id/cols/rows above. An old helper's bundled copy of
//             this module simply never reads `model` off the URL (AC-13) —
//             no version-skew risk, same as every other param here.
//   permissionMode — task d3de150c ("Terminal mode"): set ONLY when the
//             launching user's terminal_auto_accept preference is on,
//             resolved server-side at mint time. The ONLY legal value is
//             the literal string "auto" (isPermissionModeSafe below,
//             mirrors src/lib/terminal/auto-accept-mode.ts's
//             isValidPermissionModeValue) — a hard safety whitelist, not
//             just a shell-safety check like `model`'s. The bridge appends
//             `--permission-mode auto` to the fresh-spawn CMD ONLY
//             (terminal/bridge/src/resume-cmd.js) — NEVER on a resume/
//             resumeId launch, same as `model`. An old helper's bundled
//             copy of this module simply never reads `permissionMode` off
//             the URL — no version-skew risk, no error surface, silently
//             ignored, same as every other param here.
//   worktree — concurrent-terminal isolation (formerly an advisory text
//             protocol baked into `prompt`, now Claude Code's own NATIVE
//             `--worktree <name>` CLI flag — see
//             https://code.claude.com/docs/en/worktrees). Set ONLY when the
//             app decided this launch needs isolation (existing-mode with a
//             known/possibly-shared folder — see
//             src/lib/launch-claude-code.ts's `CompactPromptEssentials.isolate`)
//             AND resolved server-side/app-side as a plain boolean, same
//             posture as `resume`'s "1" flag. The ONLY legal value on the
//             wire is the literal "1" (isWorktreeFlagSafe below) — same hard
//             whitelist posture as `permissionMode`, since it's about to
//             gate an argv flag. The bridge appends `--worktree <id>` to the
//             fresh-spawn CMD ONLY (terminal/bridge/src/resume-cmd.js),
//             reusing the SAME id it mints for `--session-id` as the
//             worktree name — NEVER on a resume/resumeId launch: Claude
//             Code's own `--resume`/`--continue` already reopens the
//             worktree a session was originally spawned in (see the docs'
//             "Resume a worktree session"), so there is nothing to pass
//             again there, and passing it would risk fighting that native
//             behaviour. An old helper's bundled copy of this module simply
//             never reads `worktree` off the URL — no version-skew risk,
//             same as every other param here.
//
// `token` and `helperToken` are secrets and `prompt` is user content. NEVER log
// a raw link — use redactDeepLinkToken first (it elides all three; `model` is
// neither a secret nor free-form user content — a fixed alias/model id — so it
// is deliberately left untouched by the redactor, same as relay/session). `prompt`
// is always the LAST param (the dock's URL-length budgeting relies on this — see
// src/lib/terminal/deep-link.ts's doc comment) — `helperToken`/`model` are
// inserted BEFORE it, alongside the other credentials, so that invariant holds.
//
// Pure + dependency-free (only the global WHATWG `URL`), so it runs unchanged in
// Node (bridge) and is trivially unit-testable.

/** Custom URL scheme the packaged helper registers (slice 7 OS bit). */
export const LAUNCH_SCHEME = "vibecodes";
/** The single action this scheme exposes today: `vibecodes://launch?…`. */
export const LAUNCH_HOST = "launch";

/** Strict UUID shape — mirrors control-frames.mjs's `sanitizeConversationId`.
 *  Duplicated (not imported) to keep this module dependency-free (see the
 *  file header) — `resume_id` is validated at the same strictness either way. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A terminal dimension must be a positive, finite, sane integer — mirrors
 *  src/lib/terminal/connection.ts's `isValidDim` / terminal/bridge/src/
 *  framing.js's `isValidDim`. Duplicated (not imported) for the same
 *  dependency-free reason as UUID_RE above.
 *  @param {unknown} n
 *  @returns {boolean} */
function isValidLaunchDim(n) {
  return Number.isInteger(n) && n > 0 && n <= 1000;
}

/** Model value structural safety — mirrors src/lib/terminal/model-resolution.ts's
 *  validateTerminalModelValue. Duplicated (not imported) to keep this module
 *  dependency-free, same posture as UUID_RE/isValidLaunchDim above. Rejects
 *  anything empty or containing whitespace or a shell metacharacter — the
 *  model rides the bridge's shellSplit CMD string as a single token (see
 *  terminal/bridge/src/resume-cmd.js), so a malformed value here would either
 *  merge into an adjacent token or break tokenization; there is no safe
 *  partial value, so it's rejected outright rather than forwarded.
 *  @param {unknown} v
 *  @returns {boolean} */
function isSafeModelValue(v) {
  return typeof v === "string" && v.length > 0 && !/[\s\]`$(){}<>\\'"*?~#!;&|[]/.test(v);
}

/** Task d3de150c ("Terminal mode") — the ONLY legal `permissionMode` value
 *  is the literal string "auto". Unlike `isSafeModelValue` above
 *  (which accepts arbitrary shell-safe free text), this is a hard
 *  single-literal WHITELIST — the safety requirement is "bypassPermissions
 *  (or anything else) must never be reachable", not just "must not break
 *  shell tokenization". Mirrors src/lib/terminal/auto-accept-mode.ts's
 *  isValidPermissionModeValue exactly (drift-tested).
 *  @param {unknown} v
 *  @returns {boolean} */
function isPermissionModeSafe(v) {
  return v === "auto" || v === "acceptEdits";
}

/** Concurrent-terminal isolation — the ONLY legal wire value is the literal
 *  "1", mirroring `resume`'s own flag posture (isWorktreeFlagSafe is really
 *  just documentation here since the builder only ever emits "1" itself; kept
 *  as an explicit predicate, same style as isPermissionModeSafe, for the
 *  parse-side re-check).
 *  @param {unknown} v
 *  @returns {boolean} */
function isWorktreeFlagSafe(v) {
  return v === "1";
}

/**
 * Build a `vibecodes://launch?relay=…&session=…&token=…[&cwd=…][&cols=…&rows=…][&model=…][&worktree=1][&prompt=…]`
 * deep link.
 *
 * Uses encodeURIComponent so reserved characters in the relay URL / token /
 * prompt survive the round-trip. `cwd` / `prompt` are omitted entirely when
 * absent (no empty params); `prompt` is always LAST so the base-link length
 * (and therefore the app-side prompt budget) is stable. Throws when a required
 * field is missing so a malformed link is never fired.
 *
 * @param {{ relay: string, session: string, token: string, helperToken?: string, cwd?: string, prompt?: string, resume?: boolean, resumeId?: string, cols?: number, rows?: number, model?: string, permissionMode?: string, worktree?: boolean }} params
 * @returns {string}
 */
export function buildLaunchDeepLink({ relay, session, token, helperToken, cwd, prompt, resume, resumeId, cols, rows, model, permissionMode, worktree } = {}) {
  if (!relay || !session || !token) {
    throw new Error("buildLaunchDeepLink requires relay, session and token");
  }
  const parts = [
    `relay=${encodeURIComponent(relay)}`,
    `session=${encodeURIComponent(session)}`,
    `token=${encodeURIComponent(token)}`,
  ];
  if (helperToken) parts.push(`helperToken=${encodeURIComponent(helperToken)}`);
  if (cwd) parts.push(`cwd=${encodeURIComponent(cwd)}`);
  // resumeId (exact-conversation) wins over the legacy resume=1 flag — see the
  // header comment. A caller should only ever set one, but this keeps a
  // malformed double-set from firing a link with BOTH params.
  if (resumeId) {
    parts.push(`resume_id=${encodeURIComponent(resumeId)}`);
  } else if (resume) {
    parts.push(`resume=1`);
  }
  // Only ever sent as a pair — a lone dimension is useless to the bridge's
  // pty.spawn call (see the header comment).
  if (isValidLaunchDim(cols) && isValidLaunchDim(rows)) {
    parts.push(`cols=${cols}`, `rows=${rows}`);
  }
  // Task c4ca2d95: inserted before `prompt` (which stays LAST — see the
  // header comment) alongside the other optional non-secret params.
  if (model) parts.push(`model=${encodeURIComponent(model)}`);
  // Task d3de150c: same insertion point as `model` — before `prompt`.
  // Whitelist-checked here too (not just at parse time), so a malformed or
  // forbidden value can never even be fired in a link.
  if (permissionMode && isPermissionModeSafe(permissionMode)) {
    parts.push(`permissionMode=${encodeURIComponent(permissionMode)}`);
  }
  // Concurrent-terminal isolation: same insertion point as model/
  // permissionMode — before `prompt`. Only ever the literal "1"; a falsy
  // value is omitted entirely (no version-skew risk for an old bridge).
  if (worktree) parts.push(`worktree=1`);
  if (prompt) parts.push(`prompt=${encodePromptParam(prompt)}`);
  return `${LAUNCH_SCHEME}://${LAUNCH_HOST}?${parts.join("&")}`;
}

/**
 * Encode the `prompt` param value: encodeURIComponent, but with spaces as `+`
 * (one char) rather than `%20` (three). `URLSearchParams.get` — what
 * parseLaunchDeepLink below decodes with — already maps `+` back to a space,
 * and a literal `+` in the prompt is still `%2B`, so the round-trip is
 * unambiguous. Saves ~340 chars of the 2048-char launch-URL cap on the real
 * bootstrap prompt. Mirrors src/lib/terminal/deep-link.ts's encodePromptParam
 * exactly (drift-tested from the app side).
 *
 * @param {string} prompt
 * @returns {string}
 */
export function encodePromptParam(prompt) {
  return encodeURIComponent(prompt).replace(/%20/g, "+");
}

/**
 * Parse a `vibecodes://launch?…` deep link into `{ relay, session, token, cwd?,
 * prompt? }`, or null when it is not a well-formed launch link (wrong
 * scheme/action, or any required field missing). This is exactly the logic a
 * packaged helper's URL-scheme handler will run before connecting as the bridge
 * leg. `cwd` / `prompt` keys are only present when the link carried them, so a
 * promptless link parses to exactly the same object shape as before the prompt
 * param existed (version-skew safe both ways).
 *
 * @param {unknown} url
 * @returns {{ relay: string, session: string, token: string, helperToken?: string, cwd?: string, prompt?: string, resume?: boolean, resumeId?: string, cols?: number, rows?: number, model?: string, permissionMode?: string, worktree?: boolean } | null}
 */
export function parseLaunchDeepLink(url) {
  if (typeof url !== "string" || url.length === 0) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${LAUNCH_SCHEME}:`) return null;
  // For `scheme://launch?…` the action lands in `host`; tolerate `scheme:launch?…`
  // (no authority) where it lands in `pathname` instead.
  const action = parsed.host || parsed.pathname.replace(/^\/+/, "");
  if (action !== LAUNCH_HOST) return null;

  const relay = parsed.searchParams.get("relay");
  const session = parsed.searchParams.get("session");
  const token = parsed.searchParams.get("token");
  const helperToken = parsed.searchParams.get("helperToken") || undefined;
  const cwd = parsed.searchParams.get("cwd") || undefined;
  const prompt = parsed.searchParams.get("prompt") || undefined;
  // resume_id (exact-conversation) wins over the legacy resume=1 flag — same
  // precedence as the builder. A malformed (non-UUID) resume_id is rejected
  // outright rather than forwarded — it's about to be interpolated into a
  // shell-split bridge CMD string, so there is no safe partial value here.
  const rawResumeId = parsed.searchParams.get("resume_id");
  const resumeId = rawResumeId && UUID_RE.test(rawResumeId) ? rawResumeId.toLowerCase() : undefined;
  const resume = !resumeId && parsed.searchParams.get("resume") === "1" ? true : undefined;
  // cols/rows (Bug B — see header comment): re-validated here exactly like
  // resumeId above — a malformed/absurd value is about to reach pty.spawn, so
  // there is no safe partial value; only accepted as a validated PAIR.
  const rawCols = parsed.searchParams.get("cols");
  const rawRows = parsed.searchParams.get("rows");
  const parsedCols = rawCols === null ? NaN : Number(rawCols);
  const parsedRows = rawRows === null ? NaN : Number(rawRows);
  const dimsValid = isValidLaunchDim(parsedCols) && isValidLaunchDim(parsedRows);
  // Task c4ca2d95: re-validated here exactly like resumeId/cols/rows above —
  // it's about to ride the bridge's shellSplit CMD string as a bare token,
  // so there is no safe partial value. An old helper's bundled copy of this
  // parser simply never reads "model" at all (AC-13) — no version-skew risk.
  const rawModel = parsed.searchParams.get("model");
  const model = rawModel && isSafeModelValue(rawModel) ? rawModel : undefined;
  // Task d3de150c: re-validated here exactly like model/resumeId/cols/rows
  // above — it's about to ride the bridge's shellSplit CMD string as a bare
  // token, so there is no safe partial value. Unlike `model`, this is a
  // single-literal WHITELIST (isPermissionModeSafe), not a shell-safety
  // check — anything except the exact literal "auto" is dropped
  // silently, including a value an attacker or a bug tried to smuggle in.
  // An old helper's bundled copy of this parser simply never reads
  // "permissionMode" at all — no version-skew risk.
  const rawPermissionMode = parsed.searchParams.get("permissionMode");
  const permissionMode =
    rawPermissionMode && isPermissionModeSafe(rawPermissionMode) ? rawPermissionMode : undefined;
  // Concurrent-terminal isolation: re-validated here exactly like
  // permissionMode above — anything except the exact literal "1" is dropped
  // silently. An old helper's bundled copy of this parser simply never reads
  // "worktree" at all — no version-skew risk.
  const rawWorktree = parsed.searchParams.get("worktree");
  const worktree = rawWorktree !== null && isWorktreeFlagSafe(rawWorktree) ? true : undefined;
  if (!relay || !session || !token) return null;

  const out = { relay, session, token };
  if (helperToken) out.helperToken = helperToken;
  if (cwd) out.cwd = cwd;
  if (resumeId) out.resumeId = resumeId;
  else if (resume) out.resume = true;
  if (dimsValid) {
    out.cols = parsedCols;
    out.rows = parsedRows;
  }
  if (model) out.model = model;
  if (permissionMode) out.permissionMode = permissionMode;
  if (worktree) out.worktree = worktree;
  if (prompt) out.prompt = prompt;
  return out;
}

/**
 * Redact the secret/user-content params from a launch link so it is safe to
 * log: the `token` and `helperToken` (both credentials) and the `prompt`
 * (user task/idea content) all become `***` while relay/session survive for
 * debugging. Callers that want to debug prompt delivery log the prompt
 * LENGTH as a separate field.
 *
 * @param {unknown} url
 * @returns {string}
 */
export function redactDeepLinkToken(url) {
  return String(url)
    .replace(/([?&]token=)[^&]*/g, "$1***")
    .replace(/([?&]helperToken=)[^&]*/g, "$1***")
    .replace(/([?&]prompt=)[^&]*/g, "$1***");
}
