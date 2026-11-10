/**
 * Pure pieces of the daily "is there a newer Sonnet?" job (card 279b94ae):
 * pick the newest Sonnet, decide whether to test it, and word the board card.
 * No server-only imports, so they are easy to unit test.
 */

export type AnthropicModel = {
  id: string;
  display_name: string;
  created_at: string;
};

export type CheckName =
  | "task generation"
  | "workflow matching"
  | "short rewrite";

export type CheckResult = {
  name: CheckName;
  ok: boolean;
  inputTokens: number;
  outputTokens: number;
  ms: number;
  finishReason?: string;
  error?: string;
};

export type ModelWatchState = {
  seen: string[];
  last_checked_at: string;
};

const SONNET_PREFIX = "claude-sonnet-";

/** Newest model whose id starts `claude-sonnet-`, by `created_at`. */
export function pickNewestSonnet(models: AnthropicModel[]): AnthropicModel | null {
  let best: AnthropicModel | null = null;
  for (const m of models) {
    if (!m.id.startsWith(SONNET_PREFIX)) continue;
    if (!best || Date.parse(m.created_at) > Date.parse(best.created_at)) best = m;
  }
  return best;
}

/**
 * True only if the candidate differs from the model in use AND (the model in
 * use is not in the list, or the candidate was created later).
 */
export function isNewer(
  candidate: AnthropicModel,
  currentId: string,
  models: AnthropicModel[]
): boolean {
  if (candidate.id === currentId) return false;
  const current = models.find((m) => m.id === currentId);
  if (!current) return true;
  return Date.parse(candidate.created_at) > Date.parse(current.created_at);
}

export function shouldTestDrive(
  candidate: AnthropicModel | null,
  currentId: string,
  models: AnthropicModel[],
  seen: string[]
): boolean {
  if (!candidate) return false;
  if (seen.includes(candidate.id)) return false;
  return isNewer(candidate, currentId, models);
}

/** Overloaded, rate-limited or 5xx: worth one retry. */
export function isRetryableAiError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { statusCode?: unknown; status?: unknown; message?: unknown };
  const status = typeof e.statusCode === "number" ? e.statusCode : e.status;
  if (typeof status === "number" && [429, 500, 502, 503, 529].includes(status)) {
    return true;
  }
  return typeof e.message === "string" && /overloaded/i.test(e.message);
}

const TITLE_ERROR_MAX = 80;

/** Start of every card title the job writes: `Sonnet <version> is out`. */
export function modelWatchTitlePrefix(model: AnthropicModel): string {
  return `Sonnet ${model.display_name.replace(/^Claude Sonnet\s*/i, "").trim()} is out`;
}

/** Escape `%`, `_` and `\` so the text matches literally inside an ILIKE pattern. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function shorten(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

function tableRow(r: CheckResult): string {
  const status = r.ok ? "PASS" : "FAIL";
  const finish = r.finishReason ? `, finish: ${r.finishReason}` : "";
  const err = r.error ? `\n  Error: ${r.error}` : "";
  return `- **${r.name}**: ${status} (${r.inputTokens} tokens in, ${r.outputTokens} out, ${(r.ms / 1000).toFixed(1)}s${finish})${err}`;
}

export function buildModelWatchCard(input: {
  model: AnthropicModel;
  results: CheckResult[];
  currentModel: string;
}): { title: string; description: string } {
  const { model, results, currentModel } = input;
  const failed = results.find((r) => !r.ok);
  const released = model.created_at.slice(0, 10);
  const head =
    `Model \`${model.id}\` was released ${released}. The app currently uses \`${currentModel}\`.\n\n` +
    `Results (platform key):\n${results.map(tableRow).join("\n")}\n\n`;

  if (failed) {
    return {
      title: `${modelWatchTitlePrefix(model)} but fails ${failed.name}: ${shorten(failed.error ?? failed.finishReason ?? "unknown", TITLE_ERROR_MAX)}`,
      description:
        head +
        "Fix this before anyone switches. The daily check won't test this model again.",
    };
  }
  return {
    title: `${modelWatchTitlePrefix(model)} and passed the app's checks: switch?`,
    description:
      head +
      "To switch:\n" +
      `1. Set \`ANTHROPIC_MODEL\` to \`${model.id}\` in Vercel production and redeploy.\n` +
      "2. Check a real call on the platform key AND on a BYOK key writes a usage row with the new model (CLAUDE.md, Model update cadence).\n" +
      "3. Change the `AI_MODEL` default in `src/lib/ai-helpers.ts`.\n" +
      "4. Re-check the skills in `docs/skills/README.md` and the CLAUDE.md gotchas on the new model.\n\n" +
      "This check only used the app's own key; your own-key users aren't tested.",
  };
}
