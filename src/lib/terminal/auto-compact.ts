// Terminal memory limit (auto-compact window), task 5e654dd1. Pure helpers:
// the user -> site -> none resolution (separately per agent), the allowed
// steps, the launch guard, labels and help copy. Framework-agnostic, same
// posture as claude-effort.ts. The bridge keeps its own copy of the range in
// terminal/bridge/src/auto-compact.js (a drift test pins the two together).

export type AutoCompactAgent = "claude" | "codex";

/** The launch path accepts any whole number in this range (so a later change to the steps never breaks a saved value). */
export const AUTO_COMPACT_MIN = 100_000;
export const AUTO_COMPACT_MAX = 1_000_000;

/**
 * Board agents (Claude --agents definitions and synced agent files) tidy up at
 * 400k: only the biggest builds ever reach it (task 5e654dd1, stage 9).
 */
export const BOARD_AGENT_AUTO_COMPACT_WINDOW = 400_000;

/** What the Settings and Admin strips offer. */
export const AUTO_COMPACT_STEPS: Record<AutoCompactAgent, readonly number[]> = {
  claude: [200_000, 300_000, 400_000, 500_000, 1_000_000],
  codex: [100_000, 150_000, 200_000],
};

/** About what each agent does when nothing is set (shown in the empty states). */
export const AUTO_COMPACT_OWN_SIZE_TEXT: Record<AutoCompactAgent, string> = {
  claude: "about 967,000 tokens",
  codex: "about 245,000 tokens on today's Codex models",
};

export function isValidAutoCompactWindow(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= AUTO_COMPACT_MIN &&
    value <= AUTO_COMPACT_MAX
  );
}

export function isAutoCompactStep(agent: AutoCompactAgent, value: unknown): value is number {
  return typeof value === "number" && AUTO_COMPACT_STEPS[agent].includes(value);
}

export type AutoCompactSource = "user" | "platform" | "none";

/**
 * The order is the user's own size, then the site default an admin set, then
 * nothing (the agent decides: today's behaviour). An invalid value on either
 * side counts as unset and is never mixed with the other.
 */
export function resolveTerminalAutoCompact(input: {
  userValue?: unknown;
  platformValue?: unknown;
}): { window: number | undefined; source: AutoCompactSource } {
  if (isValidAutoCompactWindow(input.userValue)) return { window: input.userValue, source: "user" };
  if (isValidAutoCompactWindow(input.platformValue)) return { window: input.platformValue, source: "platform" };
  return { window: undefined, source: "none" };
}

/** 300000 -> "300k", 1000000 -> "1M". */
export function autoCompactShortLabel(value: number): string {
  if (value >= 1_000_000 && value % 1_000_000 === 0) return `${value / 1_000_000}M`;
  return `${Math.round(value / 1000)}k`;
}

/** 300000 -> "300,000". */
export function autoCompactTokens(value: number): string {
  return value.toLocaleString("en-US");
}

function agentName(agent: AutoCompactAgent): string {
  return agent === "claude" ? "Claude" : "Codex";
}

/** Second line under the Default segment. null while the site default loads. */
export function autoCompactDefaultSubLabel(agent: AutoCompactAgent, platformValue: unknown): string | null {
  if (platformValue === undefined) return null;
  return isValidAutoCompactWindow(platformValue)
    ? `site: ${autoCompactShortLabel(platformValue)}`
    : `${agentName(agent)}'s own`;
}

/** The Default button's accessible name. */
export function autoCompactDefaultAriaLabel(agent: AutoCompactAgent, platformValue: unknown): string {
  return isValidAutoCompactWindow(platformValue)
    ? `Default, site setting ${autoCompactShortLabel(platformValue)}`
    : agent === "claude"
      ? "Default, Claude Code decides"
      : "Default, Codex decides";
}

const BOARD_FULL = `Board agents tidy up at ${autoCompactTokens(BOARD_AGENT_AUTO_COMPACT_WINDOW)} tokens.`;
const TYPE_AUTOCOMPACT = "Change it any time by typing /autocompact in the terminal.";
const NEXT_LAUNCH = "Takes effect from your next launch or resume.";

/** Help line under a Settings memory-limit strip. userValue null = Default. */
export function autoCompactHelp({
  agent,
  userValue,
  platformValue,
}: {
  agent: AutoCompactAgent;
  userValue: unknown;
  platformValue: unknown;
}): string {
  const name = agentName(agent);
  const tail = agent === "claude" ? `${BOARD_FULL} ${TYPE_AUTOCOMPACT}` : NEXT_LAUNCH;
  if (isValidAutoCompactWindow(userValue)) {
    return `New and resumed ${name} ${agent === "claude" ? "Code " : ""}sessions tidy up their memory when it reaches ${autoCompactTokens(userValue)} tokens (your setting). ${tail}`;
  }
  if (isValidAutoCompactWindow(platformValue)) {
    return `Uses the site default: new and resumed ${name} ${agent === "claude" ? "Code " : ""}sessions tidy up their memory when it reaches ${autoCompactTokens(platformValue)} tokens. ${tail}`;
  }
  return agent === "claude"
    ? `Claude Code decides: the size you last saved with /autocompact, otherwise about 967,000 tokens. Applies to new and resumed sessions. ${BOARD_FULL}`
    : "Codex decides: about 245,000 tokens on today's Codex models. Applies to new and resumed sessions.";
}
