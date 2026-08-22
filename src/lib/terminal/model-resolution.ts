// Terminal starting-model resolution (task c4ca2d95 "Terminal starting
// model"). Mirrors the workflow model-tier platform-default/per-user-override
// STORAGE + PRECEDENCE pattern (src/lib/platform-model-defaults.ts,
// src/actions/profile.ts's model_tier_map handling) — not its three-tier
// vocabulary. See docs/terminal-starting-model-design.html.
//
// BINDING (Nick, design-review approval gate, overrides the design doc's
// seed recommendation): the platform default has NO seed value. Until an
// admin explicitly sets one on the Platform tab, resolution omits the model
// entirely — exactly today's behaviour (the local machine's Claude Code
// default wins). Do not add a hardcoded seed anywhere in this module.
//
// Framework-agnostic (no "use server", no Next.js-only imports, no Supabase
// import) so it's usable from client components, server actions, and the API
// route alike — same posture as platform-model-defaults.ts.

/**
 * Sentinel stored on `users.terminal_model` (and selectable in the Profile
 * UI) meaning "explicitly do not pass a model — the local machine's Claude
 * Code config decides" (AC-5). Distinct from NULL/unset, which means "no
 * override, use the platform default" (AC-6) — collapsing the two into one
 * stored value would make it impossible to tell "never asked" apart from
 * "asked not to." Mirrors model-tier-settings.tsx's `__platform_default__`
 * sentinel one level up (Radix Select can't hold `""` as an item value).
 */
export const MACHINE_DEFAULT_TERMINAL_MODEL = "__machine_default__";

/** The same 4 family aliases the workflow-tier UI already offers. "Known"
 *  here only changes whether the UI shows a non-blocking amber advisory —
 *  it never affects whether a value is ACCEPTED (custom free text is always
 *  structurally valid; a new model family needs no code change). */
export const KNOWN_TERMINAL_MODEL_ALIASES = ["fable", "opus", "sonnet", "haiku"] as const;
export type KnownTerminalModelAlias = (typeof KNOWN_TERMINAL_MODEL_ALIASES)[number];

export function isKnownTerminalModelAlias(value: string): boolean {
  return (KNOWN_TERMINAL_MODEL_ALIASES as readonly string[]).includes(value);
}

export type TerminalModelValidation = { ok: true } | { ok: false; reason: string };

/**
 * Config-time structural validation (AC-12), shared verbatim by the Profile
 * server action, the admin platform-default server action, and (duplicated,
 * dependency-free, same posture as the shared deep-link module's other
 * guards) the bridge/helper's own defense-in-depth re-check.
 *
 * Blocks empty/whitespace-only values and anything containing whitespace or
 * a shell metacharacter. The model rides the bridge's spawn command as a
 * single token (see terminal/bridge/src/resume-cmd.js) — it is never
 * shell-interpreted, but the rule mirrors the compact bootstrap prompt's own
 * argv-safety posture so a typo is caught here, at config time, instead of
 * surfacing later as an opaque `claude` CLI rejection in the terminal.
 * Structurally valid free text is otherwise accepted unconditionally — a
 * brand-new model family or a pinned model id needs no code change.
 */
export function validateTerminalModelValue(value: string): TerminalModelValidation {
  if (value.trim().length === 0) {
    return { ok: false, reason: "Enter a model name, or choose one of the options above." };
  }
  if (/\s/.test(value)) {
    return { ok: false, reason: "Model names can't contain spaces." };
  }
  const SHELL_METACHARACTERS = /[\]`$(){}<>\\'"*?~#!;&|[]/;
  if (SHELL_METACHARACTERS.test(value)) {
    return {
      ok: false,
      reason:
        "Model names can't contain shell characters. Use a family alias like opus or a model id like claude-opus-5.",
    };
  }
  return { ok: true };
}

export interface ResolveTerminalModelInput {
  /** The launching user's own `users.terminal_model` value. NULL/undefined = unset. */
  userValue: string | null | undefined;
  /** The live platform default. NULL/undefined = the admin has never set one. */
  platformValue: string | null | undefined;
}

/**
 * Resolution order (AC-7, binding approval-gate note): user override ->
 * platform default -> omit. There is deliberately NO seed step — an unset
 * platform default omits the model entirely, exactly like today's
 * behaviour, until an admin explicitly sets one. Returns `undefined` when no
 * `--model` flag should be passed at all.
 *
 * The machine-default sentinel wins over the platform default even when one
 * is set (AC-5 takes precedence over AC-1/AC-3 for that user) — a user who
 * deliberately opted out is never overridden by an admin's later change.
 */
export function resolveEffectiveTerminalModel({
  userValue,
  platformValue,
}: ResolveTerminalModelInput): string | undefined {
  if (userValue === MACHINE_DEFAULT_TERMINAL_MODEL) return undefined;
  if (userValue) return userValue;
  if (platformValue) return platformValue;
  return undefined;
}

/** Display-cased model alias, e.g. "sonnet" -> "Sonnet". Local copy of
 *  lib/constants.ts's capitalizeModelName (that module isn't terminal-
 *  specific) so this stays a single, framework-agnostic import for the
 *  admin/profile/chooser surfaces that need only this. */
export function capitalizeTerminalModelName(model: string): string {
  return model.charAt(0).toUpperCase() + model.slice(1);
}

export type TerminalModelSource = "platform" | "user" | "machine";

/**
 * The passive launch-surface line (design §4.2/§4.3): "New sessions start on
 * <Model> · platform default|your setting" or "New sessions use your
 * machine's default model" when the resolved source is "machine". Returns
 * null when nothing would be passed at all (both platform and user are
 * unset) — the design's instruction is to omit the line entirely rather than
 * announce a non-event.
 */
export function terminalLaunchModelLine(
  effectiveModel: string | undefined,
  source: TerminalModelSource
): string | null {
  if (source === "machine") return "New sessions use your machine's default model.";
  if (!effectiveModel) return null;
  const modelLabel = capitalizeTerminalModelName(effectiveModel);
  const sourceLabel = source === "user" ? "your setting" : "platform default";
  return `New sessions start on ${modelLabel} · ${sourceLabel}.`;
}

/**
 * The terser per-task dedupe-dialog variant (design §4.3, Design Review
 * note 2: "Starts on Sonnet · your setting" is enough — no "New sessions"
 * preamble, no link, no machine-default case since a fresh session's model
 * is what "Start fresh anyway" is qualifying). Returns null when nothing
 * would be passed at all, same omission rule as terminalLaunchModelLine.
 */
export function terminalDialogModelLine(
  effectiveModel: string | undefined,
  source: TerminalModelSource
): string | null {
  if (source === "machine") return "Starts on your machine's default model.";
  if (!effectiveModel) return null;
  const modelLabel = capitalizeTerminalModelName(effectiveModel);
  const sourceLabel = source === "user" ? "your setting" : "platform default";
  return `Starts on ${modelLabel} · ${sourceLabel}.`;
}

/**
 * Which source resolveEffectiveTerminalModel actually used — for the launch
 * surfaces' source tag ("your setting" vs "platform default" vs "your
 * machine decides"). Kept separate from the resolver above so callers that
 * only need the flag value (mint time) don't have to compute this too.
 */
export function resolveTerminalModelSource({
  userValue,
  platformValue: _platformValue,
}: ResolveTerminalModelInput): TerminalModelSource {
  if (userValue === MACHINE_DEFAULT_TERMINAL_MODEL) return "machine";
  if (userValue) return "user";
  return "platform";
}
