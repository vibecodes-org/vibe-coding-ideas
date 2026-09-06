// Plain-English "this agent isn't installed" copy for the bridge's pre-flight
// check (Codex support, docs/codex-terminal-requirements.md FR-3/FR-4, AC-5).
// Pure — the banner text is unit-tested without a PTY/relay, mirroring
// worktree-eligibility.js's `worktreeFallbackBanner`.
//
// Also the ONE place that names each agent's install-guide URL for THIS
// banner, so the bridge's terminal copy can't drift from itself; the app's
// own copy (e.g. launch-claude-code-button.tsx's CODEX_INSTALL_GUIDE_URL) is
// a separate constant by necessity (different build graph, same posture as
// deep-link.ts/.mjs duplicating logic across that boundary) — keep both in
// step by hand if the URL ever changes.

const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

/** @type {Record<"claude"|"codex", string>} */
export const AGENT_INSTALL_GUIDE_URLS = Object.freeze({
  claude: "https://docs.claude.com/en/docs/claude-code",
  codex: "https://developers.openai.com/codex/cli/",
});

/** @type {Record<"claude"|"codex", string>} */
const AGENT_DISPLAY_NAMES = Object.freeze({ claude: "Claude Code", codex: "Codex" });

/**
 * The one visible line written into the terminal (in place of the agent's own
 * output) when the chosen binary isn't on PATH. Calm, names the agent, points
 * at the install guide for Codex — never a raw "command not found" (FR-3).
 * @param {"claude"|"codex"} agent
 * @returns {string}
 */
export function agentNotInstalledBanner(agent) {
  const name = AGENT_DISPLAY_NAMES[agent] || agent;
  const guide = AGENT_INSTALL_GUIDE_URLS[agent];
  return (
    `${YELLOW}${name} isn't installed on this Mac, so this session couldn't start.` +
    (guide ? ` Install it, then start a new session: ${guide}` : "") +
    `${RESET}\r\n\r\n`
  );
}
