import { generateObject, generateText, streamObject } from "ai";
import type { z } from "zod";
import {
  ANTHROPIC_LOW_EFFORT_OPTIONS,
  ANTHROPIC_STRUCTURED_OUTPUT_LOW_EFFORT_OPTIONS,
  ANTHROPIC_STRUCTURED_OUTPUT_OPTIONS,
} from "@/lib/ai-helpers";
import {
  GENERATE_TASKS_MAX_OUTPUT_TOKENS,
  GeneratedBoardSchema,
} from "@/lib/generate-tasks-stream";
import { adjudicationSchema } from "@/lib/workflow-matching";
import { isRetryableAiError, type CheckName, type CheckResult } from "@/lib/model-watch";

const CHECK_TIMEOUT_MS = 120_000;

type Usage = { inputTokens?: number; outputTokens?: number } | undefined;
type Outcome = { value: unknown; usage: Usage; finishReason?: string };

// The real AI-SDK calls are injectable so tests can stub them.
export type ModelWatchDeps = {
  generate: typeof generateObject;
  stream: typeof streamObject;
  text: typeof generateText;
};

export const defaultModelWatchDeps: ModelWatchDeps = {
  generate: generateObject,
  stream: streamObject,
  text: generateText,
};

type Provider = (modelId: string) => Parameters<typeof generateText>[0]["model"];

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function runCheck(
  name: CheckName,
  attempt: () => Promise<Outcome>,
  validate: (o: Outcome) => string | null
): Promise<CheckResult> {
  const startedAt = Date.now();
  let last: unknown;
  for (let i = 0; i < 2; i++) {
    try {
      const o = await attempt();
      const problem = validate(o);
      return {
        name,
        ok: problem === null,
        inputTokens: o.usage?.inputTokens ?? 0,
        outputTokens: o.usage?.outputTokens ?? 0,
        ms: Date.now() - startedAt,
        finishReason: o.finishReason,
        ...(problem ? { error: problem } : {}),
      };
    } catch (err) {
      last = err;
      if (i === 0 && isRetryableAiError(err)) continue;
      break;
    }
  }
  return {
    name,
    ok: false,
    inputTokens: 0,
    outputTokens: 0,
    ms: Date.now() - startedAt,
    error: errorText(last),
  };
}

function validateSchema(schema: z.ZodType) {
  return (o: Outcome): string | null => {
    if (o.finishReason !== "stop") {
      return `Output was cut off or ended early (finish reason: ${o.finishReason ?? "unknown"})`;
    }
    const parsed = schema.safeParse(o.value);
    return parsed.success ? null : "Output did not match the expected shape";
  };
}

export async function runModelChecks(
  provider: Provider,
  modelId: string,
  deps: ModelWatchDeps = defaultModelWatchDeps
): Promise<CheckResult[]> {
  const model = provider(modelId);

  const taskGeneration = runCheck(
    "task generation",
    async () => {
      const result = deps.stream({
        model,
        system: "You generate task lists for software project boards.",
        prompt: "Generate 5 tasks for a recipe-sharing web app.",
        schema: GeneratedBoardSchema,
        providerOptions: ANTHROPIC_STRUCTURED_OUTPUT_OPTIONS,
        maxOutputTokens: GENERATE_TASKS_MAX_OUTPUT_TOKENS,
        abortSignal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      });
      const value = await result.object;
      return { value, usage: await result.usage, finishReason: await result.finishReason };
    },
    validateSchema(GeneratedBoardSchema)
  );

  const matching = () =>
    runCheck(
      "workflow matching",
      async () => {
        const { object, usage, finishReason } = await deps.generate({
          model,
          system:
            "You decide whether a workflow template fits a task. Return the best template ID (or null), a confidence from 0 to 1, and a one-sentence rationale.",
          prompt:
            'Task title: "Fix login redirect bug"\nTask description: "Users land on a blank page after signing in."\n\n' +
            'Candidate templates:\n- tpl-1: "Bug Fix" (Investigate, Fix, Review)\n- tpl-2: "Market Research" (Research, Report)',
          schema: adjudicationSchema,
          providerOptions: ANTHROPIC_STRUCTURED_OUTPUT_LOW_EFFORT_OPTIONS,
          maxOutputTokens: 500,
          abortSignal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
        });
        return { value: object, usage, finishReason };
      },
      validateSchema(adjudicationSchema)
    );

  const rewrite = () =>
    runCheck(
      "short rewrite",
      async () => {
        const { text, usage, finishReason } = await deps.text({
          model,
          system:
            "You are a concise technical writer. Improve the task description's clarity. Return ONLY the improved description.",
          prompt: "**Task Title:** Fix login\n**Current Description:**\nlogin broken after redirect, users see blank page",
          providerOptions: ANTHROPIC_LOW_EFFORT_OPTIONS,
          maxOutputTokens: 1000,
          abortSignal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
        });
        return { value: text, usage, finishReason };
      },
      (o) => {
        if (o.finishReason !== "stop") {
          return `Output was cut off or ended early (finish reason: ${o.finishReason ?? "unknown"})`;
        }
        return typeof o.value === "string" && o.value.trim() ? null : "Output was empty";
      }
    );

  // One after another, so a pass costs little and errors are easy to read.
  const results: CheckResult[] = [await taskGeneration];
  results.push(await matching());
  results.push(await rewrite());
  return results;
}
