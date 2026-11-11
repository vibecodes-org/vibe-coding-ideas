// In-app terminal — where each agent is installed from (card 63a60792).
//
// The ONE place the app names each maker's install page and the one-line
// installer their own website tells you to paste. Replaces the copies that
// lived in launch-claude-code-button.tsx and terminal-session-view.tsx (two of
// which pointed at addresses that now redirect). The bridge keeps its own copy
// in terminal/bridge/src/agent-setup.js (a different build graph); the drift
// test in agent-install.test.ts pins the two together.

export type SetupAgent = "claude" | "codex";

export const AGENT_DISPLAY_NAMES: Record<SetupAgent, string> = { claude: "Claude Code", codex: "Codex" };

/** Each maker's current install page (opened in a real browser, 11 Nov 2026). */
export const AGENT_INSTALL_GUIDE_URLS: Record<SetupAgent, string> = {
  claude: "https://code.claude.com/docs/en/setup",
  codex: "https://learn.chatgpt.com/docs/codex/cli",
};

/** The exact line each maker tells you to paste into Terminal. */
export const AGENT_INSTALL_COMMANDS: Record<SetupAgent, string> = {
  claude: "curl -fsSL https://claude.ai/install.sh | bash",
  codex: "curl -fsSL https://chatgpt.com/codex/install.sh | sh",
};

/** The readable name a setup session carries in "My sessions". */
export function setupSessionDisplayName(agent: SetupAgent): string {
  return `Set up ${AGENT_DISPLAY_NAMES[agent]}`;
}
