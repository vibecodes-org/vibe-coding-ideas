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
 * Codex model catalogue — the advisory "known" list (drives the model picker's
 * suggestions and the "unknown model" advisory; free text is always accepted).
 * Current Codex lineup as of Sept 2026: GPT-6 Astra (`gpt-6-astra`, GA 3 Sep,
 * staged rollout) is the new frontier; the GPT-5.6 family — Sol (flagship),
 * Terra (workhorse), Luna (budget) — is the broadly-available generation, with
 * GPT-5.5 / GPT-5.4 still selectable. `-c model_reasoning_effort=` accepts
 * minimal/low/medium/high/xhigh, but the 5.6 family tops out at "high". This
 * list is advisory only and updated as OpenAI's lineup moves.
 */
export const KNOWN_CODEX_MODELS = [
  { value: "gpt-6-astra", label: "gpt-6-astra", tier: "frontier" as const },
  { value: "gpt-5.6-sol", label: "gpt-5.6-sol", tier: "frontier" as const },
  { value: "gpt-5.6-terra", label: "gpt-5.6-terra", tier: "standard" as const },
  { value: "gpt-5.6-luna", label: "gpt-5.6-luna", tier: "cheap" as const },
  { value: "gpt-5.5", label: "gpt-5.5", tier: "standard" as const },
  { value: "gpt-daybreak-blue-latest", label: "gpt-daybreak-blue-latest", tier: "frontier" as const },
  { value: "gpt-5.4-mini", label: "gpt-5.4-mini", tier: "cheap" as const },
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
      reason: "Model ids can't contain shell characters. Use a model id like gpt-6-astra.",
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
