// Codex support (docs/codex-terminal-ux-design.html §1/§4/§10, implementation
// slice 2) — pure copy/label helpers shared by every surface that shows or
// picks an agent (chooser picker, Ready panel, task-launch dialog, tab strip,
// session header, My-sessions rows, pop-out title). Framework-agnostic and
// dependency-free (mirrors agent-launch.ts's own posture) so it's usable from
// any component and unit-testable without React.

import { type LaunchAgent } from "./agent-launch";

/** Design §10 copy sheet: picker.options. */
export const AGENT_LABEL: Record<LaunchAgent, string> = {
  claude: "Claude Code",
  codex: "Codex",
};

/** Design §10: codexSettingsLine — replaces the model/auto-accept lines one-for-one when Codex is selected (§1a annotation 3), keeping the launch-surface block's height stable. */
export const CODEX_SETTINGS_LINE = "Codex uses its own model and permission settings.";

/** Design §1a annotation 4 — shown only the first 3 times Codex is selected in this browser. */
export const CODEX_SIGNIN_HINT =
  "Codex signs in with your own ChatGPT account on this Mac — nothing to set up here.";

/** Design §5/§8: the honest "most recent conversation" resume copy, agent-named. */
export function resumeConfirmLine(agent: LaunchAgent, folder: string): string {
  return agent === "codex"
    ? `Starts a new terminal that picks up your most recent Codex conversation in ${folder}.`
    : `Starts a new terminal that picks up the most recent conversation in ${folder}.`;
}

/** Design §10: taskMenu.dedupeToast / desktop.pathTooLong — agent-named refusal copy. */
export function agentDedupeToast(agent: LaunchAgent): string {
  return `This task already has a ${AGENT_LABEL[agent]} terminal — switched to it.`;
}
