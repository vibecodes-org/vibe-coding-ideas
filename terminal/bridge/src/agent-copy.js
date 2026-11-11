// Plain-English "this agent isn't installed" copy for the bridge's pre-flight
// check (Codex support, docs/codex-terminal-requirements.md FR-3/FR-4, AC-5).
// Pure — the banner text is unit-tested without a PTY/relay, mirroring
// worktree-eligibility.js's `worktreeFallbackBanner`.
//
// The install-guide URLs come from agent-setup.js. The app's typed copy is
// src/lib/terminal/agent-install.ts; a drift test pins the two.

const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

import { AGENT_DISPLAY_NAMES, AGENT_INSTALL_GUIDE_URLS } from "./agent-setup.js";

// The install addresses now live in agent-setup.js (card 63a60792), the one
// table shared with the setup session; re-exported so existing importers work.
export { AGENT_INSTALL_GUIDE_URLS };

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
