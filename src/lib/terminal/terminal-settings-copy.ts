// Wording shared by the Settings dialog's Claude Code and Codex terminal rows
// (task fae2ce4f). Pure functions so every string is pinned by a test and the
// two agents' lines keep one shape: "<what happens> (your setting)." /
// "Uses the site default: <what happens>." / "<Agent> decides: ...".

import { EFFORT_LABELS } from "@/lib/terminal/claude-effort";
import {
  MACHINE_DEFAULT_TERMINAL_MODEL,
  capitalizeTerminalModelName,
  type ResolvedTerminalCodexModel,
  type TerminalCodexModelPair,
} from "@/lib/terminal/model-resolution";
import type { ReasoningEffort } from "@/lib/platform-model-defaults";

/**
 * Codex's terminal UI lists a /model command ("choose what model and reasoning
 * effort to use"; checked against codex-cli 0.163.0, 27 Oct 2026), so the
 * "Change it any time by typing /model" sentence is allowed for Codex.
 */
export const CODEX_HAS_MODEL_COMMAND = true;

const TYPE_MODEL = "Change it any time by typing /model in the terminal.";

function effortLabel(effort: string): string {
  return EFFORT_LABELS[effort as ReasoningEffort] ?? effort;
}

/** Help line under the Claude "Starting model" list. userValue null = Default. */
export function claudeModelHelp({
  userValue,
  platformValue,
}: {
  userValue: string | null;
  platformValue: string | null | undefined;
}): string {
  const resumed = "Resumed sessions keep their model.";
  if (userValue !== null && userValue !== MACHINE_DEFAULT_TERMINAL_MODEL) {
    return `New Claude Code sessions start on ${capitalizeTerminalModelName(userValue)} (your setting). ${resumed} ${TYPE_MODEL}`;
  }
  if (userValue === null && platformValue) {
    return `Uses the site default: new Claude Code sessions start on ${capitalizeTerminalModelName(platformValue)}. ${resumed} ${TYPE_MODEL}`;
  }
  return `Your machine decides which model new Claude Code sessions start on. ${resumed} ${TYPE_MODEL}`;
}

/** Help line under the Codex "Starting model" list. null resolution = still loading. */
export function codexModelHelp(resolution: ResolvedTerminalCodexModel | null): string {
  if (resolution === null) return "Checking the Codex terminal default…";
  const resumed = "Resumed sessions keep their model.";
  const tail = CODEX_HAS_MODEL_COMMAND ? ` ${TYPE_MODEL}` : "";
  if (resolution.source === "machine") return `Your machine decides the Codex model and effort. ${resumed}`;
  if (resolution.pair === undefined) return "No valid Codex terminal default is available.";
  const { model } = resolution.pair;
  if (resolution.source === "user") return `New Codex sessions start on ${model} (your setting). ${resumed}${tail}`;
  if (resolution.source === "platform") return `Uses the site default: new Codex sessions start on ${model}. ${resumed}${tail}`;
  return `Uses the Standard tier: new Codex sessions start on ${model}. ${resumed}`;
}

/** Help line under the Codex "Starting effort" strip. */
export function codexEffortHelp(resolution: ResolvedTerminalCodexModel | null): string {
  if (resolution === null) return "Checking the Codex terminal default…";
  if (resolution.source === "machine") return "Your machine decides the Codex model and effort.";
  if (resolution.pair === undefined) return "No valid Codex terminal default is available.";
  const level = effortLabel(resolution.pair.effort);
  if (resolution.source === "user") {
    return `New Codex sessions start at ${level} (your setting). Resumed sessions keep theirs. Codex saves the model and effort together.`;
  }
  const which = resolution.source === "platform" ? "the site default" : "the Standard tier";
  const withWhat = resolution.source === "platform" ? "the site's model" : "the Standard tier's model";
  return `Uses ${which}: new Codex sessions start at ${level}, with ${withWhat}. Pick a model above to choose your own effort.`;
}

/** Second line under the Codex effort strip's Default segment. null while the site pair loads. */
export function codexEffortDefaultSubLabel(
  platformPair: TerminalCodexModelPair | null | undefined,
  machine = false
): string | null {
  if (machine) return "your machine";
  if (platformPair === undefined) return null;
  return platformPair ? `site: ${effortLabel(platformPair.effort)}` : "Standard tier";
}

/** The Default entry of a model list: "Default (site: Opus)" etc. `fallback` is what shows with no site value. */
export function siteModelOptionLabel(site: string | null | undefined, fallback: string): string {
  return site ? `Default (site: ${site})` : `Default (${fallback})`;
}

/**
 * The effort to stage when a user picks a specific Codex model while on
 * Default: the level the Default row was showing (site pair, else the
 * Standard tier's), so the pair doesn't jump; "medium" if neither is usable.
 */
export function codexPrefillEffort(
  platformPair: TerminalCodexModelPair | null | undefined,
  fallbackPair: TerminalCodexModelPair | null | undefined,
  isValidEffort: (effort: string) => boolean
): string {
  for (const pair of [platformPair, fallbackPair]) {
    if (pair && isValidEffort(pair.effort)) return pair.effort;
  }
  return "medium";
}
