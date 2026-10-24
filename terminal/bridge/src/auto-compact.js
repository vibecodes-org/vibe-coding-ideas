// The memory limit (auto-compact window) a session starts with — the bridge's
// side (task 5e654dd1). The app resolves the owner's value (own setting, else
// the site default) and serves it in the same answer as the board's agents
// (POST /api/terminal/session/agents → `autoCompactWindow`), so the launch
// link never grows. Everything here is pure so it is unit-testable without a
// PTY; the one subprocess call (`claude --version`) lives in index.js.
//
// A launch is never broken by this: any missing, malformed or out-of-range
// value, an explicit --cmd, or (for Claude) a version too old to know the
// flag adds nothing, and the session starts exactly as it did before.

/** Mirrors AUTO_COMPACT_MIN / AUTO_COMPACT_MAX in src/lib/terminal/auto-compact.ts (a drift test pins them). */
export const AUTO_COMPACT_MIN = 100_000;
export const AUTO_COMPACT_MAX = 1_000_000;

/** `claude --autocompact` first shipped in 2.1.221 (checked on the user's Mac). */
export const MIN_CLAUDE_VERSION = [2, 1, 221];

/**
 * @param {unknown} value
 * @returns {value is number}
 */
export function isValidWindow(value) {
  return (
    typeof value === "number" && Number.isInteger(value) && value >= AUTO_COMPACT_MIN && value <= AUTO_COMPACT_MAX
  );
}

/**
 * The endpoint's `autoCompactWindow`, or null when absent or not a whole
 * number in range. An older app that doesn't send it gives null.
 * @param {unknown} body
 * @returns {number | null}
 */
export function parseAutoCompactWindow(body) {
  const value = body && typeof body === "object" ? /** @type {any} */ (body).autoCompactWindow : undefined;
  return isValidWindow(value) ? value : null;
}

/**
 * The version in `claude --version` output ("2.1.221 (Claude Code)").
 * @param {unknown} text
 * @returns {[number, number, number] | null}
 */
export function parseClaudeVersion(text) {
  if (typeof text !== "string") return null;
  const m = /(?:^|[^\d.])(\d{1,4})\.(\d{1,4})\.(\d{1,6})(?![\d.])/.exec(text.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/**
 * @param {[number, number, number] | null} version
 * @returns {boolean} true only for a known version at or above the minimum
 */
export function supportsAutocompact(version) {
  if (!version) return false;
  for (let i = 0; i < 3; i++) {
    if (version[i] > MIN_CLAUDE_VERSION[i]) return true;
    if (version[i] < MIN_CLAUDE_VERSION[i]) return false;
  }
  return true;
}

/**
 * The launch flags that carry the memory limit, plus why they were skipped.
 *  - Claude: `--autocompact N`, only when `claude --version` was read and is
 *    new enough (an unknown flag would stop the launch).
 *  - Codex: `-c model_auto_compact_token_limit=N`, no version check (Codex
 *    ignores keys it doesn't know, and N is always a whole number, so it can't
 *    break parsing).
 *  - An explicit --cmd override, or anything invalid: nothing.
 * @param {{ agent: string, explicitCmd: string | null, window: unknown, claudeVersionText?: string | null }} input
 * @returns {{ flags: string[], skipped: string | null }}
 */
export function autoCompactArgs({ agent, explicitCmd, window, claudeVersionText }) {
  if (explicitCmd) return { flags: [], skipped: "explicit-cmd" };
  if (!isValidWindow(window)) return { flags: [], skipped: "no-value" };
  if (agent === "codex") {
    return { flags: ["-c", `model_auto_compact_token_limit=${window}`], skipped: null };
  }
  if (agent === "claude") {
    if (!supportsAutocompact(parseClaudeVersion(claudeVersionText))) return { flags: [], skipped: "claude-too-old-or-unknown" };
    return { flags: ["--autocompact", String(window)], skipped: null };
  }
  return { flags: [], skipped: "unknown-agent" };
}
