// Codex model catalogue + shell-safe validation (Codex model-tier task, FR-1).
//
// Mirrors src/lib/terminal/model-resolution.ts's `validateTerminalModelValue`
// shape (non-empty, length cap, no whitespace/shell metacharacters) — Codex
// model ids ride a CLI invocation the same way the terminal's `--model`
// value does (terminal/bridge spawns `codex`), so the same defence-in-depth
// posture applies even though this module is unrelated to the in-app
// terminal itself (it's read by mcp-server's claim-time resolution, not the
// bridge). Framework-agnostic (no "use server", no Supabase import) so it's
// usable from client components, server actions, and mcp-server alike — same
// posture as platform-model-defaults.ts.
//
// Known model ids drive UI advisories ONLY (isKnownCodexModel) — free text is
// always structurally valid (a new Codex model needs no code change here).

import { REASONING_EFFORT_LEVELS, type ReasoningEffort } from "@/lib/platform-model-defaults";

export { REASONING_EFFORT_LEVELS, type ReasoningEffort };

/**
 * Seed Codex model catalogue — PLACEHOLDERS PENDING NICK'S CONFIRMATION.
 * `codex --help` / `codex doctor` (installed locally, CLI v0.153.4) confirm
 * `-m/--model <MODEL>` takes a free-text model id and `-c
 * model_reasoning_effort=<level>` is a real, separate config key (this
 * machine's own `~/.codex/config.toml` has `model_reasoning_effort = "high"`
 * set) — but neither surfaces an enumerable model catalogue, and this repo
 * has no network access to OpenAI's live model list. These three ids are
 * realistic-shaped placeholders (Codex's own "-codex" / "-codex-mini" naming
 * convention) for a strong/mid/small ladder, NOT confirmed real ids — swap
 * them for whatever Nick confirms before shipping FR-7's UI.
 */
export const KNOWN_CODEX_MODELS = [
  { value: "gpt-5.1-codex", label: "gpt-5.1-codex", tier: "frontier" as const },
  { value: "gpt-5.1-codex-mini", label: "gpt-5.1-codex-mini", tier: "standard" as const },
] as const;

export function isKnownCodexModel(value: string): boolean {
  return (KNOWN_CODEX_MODELS as readonly { value: string }[]).some((m) => m.value === value);
}

export type CodexModelValidation = { ok: true } | { ok: false; reason: string };

/** Same cap as validateTerminalModelValue — generous headroom over any realistic model id. */
const MAX_CODEX_MODEL_VALUE_LENGTH = 100;

/**
 * Shell-safe structural validation for a Codex model id (FR-1). Reuses the
 * exact validation shape of `validateTerminalModelValue` in
 * src/lib/terminal/model-resolution.ts: non-empty, length-capped, no
 * whitespace, no shell metacharacters. Structurally valid free text is
 * otherwise accepted unconditionally — a brand-new Codex model id needs no
 * code change.
 */
export function validateCodexModelValue(value: string): CodexModelValidation {
  if (value.trim().length === 0) {
    return { ok: false, reason: "Enter a Codex model id." };
  }
  if (value.trim().length > MAX_CODEX_MODEL_VALUE_LENGTH) {
    return {
      ok: false,
      reason: `Model ids can't be longer than ${MAX_CODEX_MODEL_VALUE_LENGTH} characters.`,
    };
  }
  if (/\s/.test(value)) {
    return { ok: false, reason: "Model ids can't contain spaces." };
  }
  const SHELL_METACHARACTERS = /[\]`$(){}<>\\'"*?~#!;&|[]/;
  if (SHELL_METACHARACTERS.test(value)) {
    return {
      ok: false,
      reason: "Model ids can't contain shell characters. Use a model id like gpt-5.1-codex.",
    };
  }
  return { ok: true };
}

/**
 * Enum-of-string validity check for a self-reported/configured effort value
 * (FR-6: effort is first-class and always an enum, unlike the free-text
 * model). Not Codex-specific — the same ladder applies to Claude (Nick's
 * approval-gate note 2).
 */
export function validateReasoningEffort(value: string): CodexModelValidation {
  if ((REASONING_EFFORT_LEVELS as readonly string[]).includes(value)) return { ok: true };
  return {
    ok: false,
    reason: `Effort must be one of: ${REASONING_EFFORT_LEVELS.join(", ")}.`,
  };
}
