/**
 * Mismatched-workflow detection — hybrid keyword + AI matching.
 *
 * A cheap, deterministic keyword pre-filter classifies a workflow template and a
 * task into one of two broad categories ('discovery' vs 'build'). When they
 * clearly agree, the auto-rule applies silently; when they clearly disagree, or
 * either side is ambiguous, the case is "suspect" and sent to AI adjudication.
 *
 * `adjudicateWorkflowMatch()` wraps the existing AI stack but ALWAYS resolves —
 * if AI is unavailable, throws, times out, or returns invalid output, it falls
 * back to the keyword heuristic and flags `source: 'heuristic'`.
 *
 * This module is the data + logic layer slice; wiring into auto-rule application,
 * MCP tools, server actions, and UI happens in later slices.
 */

import { generateObject } from "ai";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, WorkflowTemplateStep } from "@/types/database";
import {
  resolveAiProvider,
  logAiUsage,
  decrementStarterCredit,
} from "@/lib/ai-helpers";
import { logger } from "@/lib/logger";
import { WORKFLOW_AI_ADJUDICATION_TIMEOUT_MS } from "@/lib/workflow-suggestion-constants";

// ============================================================
// Constants
// ============================================================

/** AI confidence at or above which a recommended match auto-applies silently. */
export const WORKFLOW_AI_AUTOAPPLY_THRESHOLD = 0.85;

/**
 * Re-exported from the client-safe constants module so server-side callers that
 * already import workflow-matching.ts keep working, while UI components import
 * the client-safe module directly (no AI SDK in the browser bundle).
 */
export { WORKFLOW_AI_ADJUDICATION_TIMEOUT_MS };

/**
 * Model for the cheap workflow-matching adjudication (gated behind the keyword
 * pre-filter, tiny 3-field output). Uses the same model the rest of the app's AI
 * runs on — the `claude-haiku-4-5` alias was rejected by the Anthropic API on the
 * resolved key (adjudication silently fell back to heuristic in prod); the proven
 * model works. Revisit a Haiku-tier id (e.g. dated) later as a cost optimisation.
 */
export const WORKFLOW_MATCHING_MODEL = "claude-sonnet-4-6";

const AI_TIMEOUT_MS = 30_000;

export type WorkflowCategory = "discovery" | "build" | "unknown";

/**
 * Keyword sets per category. Multi-word phrases are matched as substrings;
 * single words are matched on word boundaries so "api" doesn't fire on
 * "rapid" or "capital". Order within a set is irrelevant.
 */
const DISCOVERY_KEYWORDS = [
  "market research",
  "competitor",
  "user interview",
  "go/no-go",
  "go / no-go",
  "persona",
  "validation",
  "pricing",
  "survey",
  "discovery",
  "feasibility",
] as const;

const BUILD_KEYWORDS = [
  "implement",
  "code",
  "build",
  "develop",
  "bug",
  "fix",
  "refactor",
  "deploy",
  "migration",
  "api",
  "test",
  "qa",
  "design",
  "ux",
  "wireframe",
  "architecture",
  "spike",
  "engineer",
  "frontend",
  "backend",
  "instrument",
  "render",
  "perf",
] as const;

// ============================================================
// Keyword matching
// ============================================================

/** True if `keyword` (a word or multi-word phrase) occurs in `haystack`. */
function keywordMatches(haystack: string, keyword: string): boolean {
  // Multi-word / contains-non-word-char phrases → plain substring match.
  if (/[^a-z0-9]/.test(keyword)) {
    return haystack.includes(keyword);
  }
  // Single token → word-boundary match to avoid spurious substring hits.
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`).test(haystack);
}

/** Distinct keywords from a set that appear in `text` (already lower-cased). */
function matchedKeywords(text: string, keywords: readonly string[]): string[] {
  const found: string[] = [];
  for (const kw of keywords) {
    if (keywordMatches(text, kw)) found.push(kw);
  }
  return found;
}

export interface CategoryScore {
  category: WorkflowCategory;
  discoveryHits: string[];
  buildHits: string[];
}

/**
 * Score arbitrary text against both keyword sets and pick a category.
 * Higher hit-count wins; a tie (including 0-0) is 'unknown' so the case is
 * sent to AI rather than guessed.
 */
function scoreText(text: string): CategoryScore {
  const lower = text.toLowerCase();
  const discoveryHits = matchedKeywords(lower, DISCOVERY_KEYWORDS);
  const buildHits = matchedKeywords(lower, BUILD_KEYWORDS);

  let category: WorkflowCategory = "unknown";
  if (discoveryHits.length > buildHits.length) category = "discovery";
  else if (buildHits.length > discoveryHits.length) category = "build";

  return { category, discoveryHits, buildHits };
}

/** Classify a workflow template by its step titles, descriptions, and roles. */
export function classifyTemplateCategory(
  steps: Pick<WorkflowTemplateStep, "title" | "description" | "role">[]
): CategoryScore {
  const text = steps
    .map((s) => [s.title, s.description ?? "", s.role].join(" "))
    .join(" ");
  return scoreText(text);
}

/** Classify a task by its title, description, and the names of its labels. */
export function classifyTaskCategory(
  task: { title: string; description?: string | null },
  labelNames: string[] = []
): CategoryScore {
  const text = [task.title, task.description ?? "", ...labelNames].join(" ");
  return scoreText(text);
}

// ============================================================
// Mismatch detection
// ============================================================

export interface MismatchResult {
  /** Hard mismatch: both sides are known and opposite. */
  mismatch: boolean;
  /** Worth a second look (AI adjudication) — true unless clearly-good. */
  suspect: boolean;
  /** Human-readable explanation naming both categories + matched keywords. */
  reason: string;
  categories: { template: WorkflowCategory; task: WorkflowCategory };
}

function topHits(score: CategoryScore): string[] {
  // Surface the hits from the winning side (or both, if unknown/tie).
  if (score.category === "discovery") return score.discoveryHits;
  if (score.category === "build") return score.buildHits;
  return [...score.discoveryHits, ...score.buildHits];
}

function categoryLabel(cat: WorkflowCategory): string {
  switch (cat) {
    case "discovery":
      return "discovery / market-research";
    case "build":
      return "build / engineering";
    default:
      return "unclear";
  }
}

function describeSide(label: string, score: CategoryScore): string {
  const hits = topHits(score);
  const kw = hits.length ? ` (matched ${hits.map((h) => `"${h}"`).join(", ")})` : "";
  return `${label} looks like ${categoryLabel(score.category)}${kw}`;
}

export interface DetectMismatchInput {
  steps: Pick<WorkflowTemplateStep, "title" | "description" | "role">[];
  name?: string;
}

/**
 * Decide whether a template's category clashes with a task's.
 *
 * Rules:
 *  - Same known category           → not suspect, not mismatch (auto-apply).
 *  - Opposite known categories     → suspect + hard mismatch.
 *  - Either side unknown/ambiguous → suspect (send to AI) but NOT a hard mismatch.
 */
export function detectMismatch(
  template: DetectMismatchInput,
  task: { title: string; description?: string | null },
  labelNames: string[] = []
): MismatchResult {
  const templateScore = classifyTemplateCategory(template.steps);
  const taskScore = classifyTaskCategory(task, labelNames);
  const categories = {
    template: templateScore.category,
    task: taskScore.category,
  };

  const templateName = template.name ?? "Template";
  const templateSide = describeSide(templateName, templateScore);
  const taskSide = describeSide("but this task", taskScore);

  const bothKnown =
    templateScore.category !== "unknown" && taskScore.category !== "unknown";

  // Clearly-good: same known category → silent auto-apply.
  if (bothKnown && templateScore.category === taskScore.category) {
    return {
      mismatch: false,
      suspect: false,
      reason: `${templateSide}, and this task matches the same category — looks like a good fit.`,
      categories,
    };
  }

  // Opposite known categories → hard mismatch.
  if (bothKnown && templateScore.category !== taskScore.category) {
    return {
      mismatch: true,
      suspect: true,
      reason: `${templateSide}, ${taskSide} — these look mismatched.`,
      categories,
    };
  }

  // Either side ambiguous → suspect, defer to AI, but not a hard mismatch.
  return {
    mismatch: false,
    suspect: true,
    reason: `${templateSide}, ${taskSide} — category unclear, worth a closer look.`,
    categories,
  };
}

// ============================================================
// AI adjudication
// ============================================================

const adjudicationSchema = z.object({
  recommended_template_id: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
});

export interface AdjudicationCandidateTemplate {
  id: string;
  name: string;
  description?: string | null;
  steps: Pick<WorkflowTemplateStep, "title" | "role">[];
}

export interface AdjudicationTask {
  title: string;
  description?: string | null;
  labelNames?: string[];
}

export interface AdjudicationResult {
  /** Whether the verdict came from AI or the keyword fallback. */
  source: "ai" | "heuristic";
  /** Template the model (or heuristic) thinks best fits, if any. */
  recommendedTemplateId: string | null;
  /** 0–1; from the heuristic this is a coarse value, never above the threshold. */
  confidence: number;
  /** One-line explanation (AI rationale or heuristic reason). */
  rationale: string;
  /** Whether confidence clears the auto-apply bar. */
  autoApply: boolean;
}

/**
 * The injectable AI call. Mirrors the parts of `generateObject`'s result that we
 * consume, so tests can supply a fake without importing the `ai` package.
 */
export type GenerateObjectFn = typeof generateObject;

export interface AdjudicateOptions {
  ideaId?: string | null;
  /** Override the AI call for testing. Defaults to the real `generateObject`. */
  generate?: GenerateObjectFn;
}

/**
 * Build the deterministic heuristic verdict used both as the fallback and as the
 * basis for the AI prompt's "originally labelled" context.
 */
function heuristicVerdict(
  suggestedTemplate: AdjudicationCandidateTemplate,
  task: AdjudicationTask
): AdjudicationResult {
  const detected = detectMismatch(
    {
      steps: suggestedTemplate.steps.map((s) => ({ title: s.title, role: s.role })),
      name: suggestedTemplate.name,
    },
    task,
    task.labelNames ?? []
  );
  return {
    source: "heuristic",
    recommendedTemplateId: null,
    // Heuristic confidence is intentionally kept below the auto-apply bar so a
    // fallback never silently applies a workflow.
    confidence: detected.mismatch ? 0.5 : 0.3,
    rationale: detected.reason,
    autoApply: false,
  };
}

/**
 * Adjudicate which candidate template best fits a task, using AI with a
 * deterministic keyword fallback.
 *
 * NEVER throws. On any failure (no AI access, thrown error, timeout, invalid
 * output) it returns a `source: 'heuristic'` result derived from the classifier.
 */
export async function adjudicateWorkflowMatch(
  supabase: SupabaseClient<Database>,
  userId: string,
  suggestedTemplate: AdjudicationCandidateTemplate,
  candidateTemplates: AdjudicationCandidateTemplate[],
  task: AdjudicationTask,
  options: AdjudicateOptions = {}
): Promise<AdjudicationResult> {
  const fallback = () => heuristicVerdict(suggestedTemplate, task);
  const generate = options.generate ?? generateObject;
  const validIds = new Set(candidateTemplates.map((t) => t.id));

  try {
    const resolved = await resolveAiProvider(supabase, userId);
    if (!resolved.ok) {
      logger.info("Workflow matching: AI unavailable, using heuristic", {
        userId,
        error: resolved.error,
      });
      return fallback();
    }

    const candidateList = candidateTemplates
      .map((t) => {
        const steps = t.steps.map((s) => `${s.title} [${s.role}]`).join("; ");
        return `- ID: ${t.id}, Name: "${t.name}"${
          t.description ? `, Description: "${t.description}"` : ""
        }, Steps: ${steps}`;
      })
      .join("\n");

    const labels = (task.labelNames ?? []).join(", ") || "(none)";

    const { object, usage } = await generate({
      model: resolved.anthropic(WORKFLOW_MATCHING_MODEL),
      system:
        "You decide whether a workflow template fits a task, and pick the best-fitting template from a list. " +
        "Distinguish DISCOVERY work (market research, validation, competitor analysis, pricing) from BUILD work " +
        "(engineering, coding, bug fixes, deploys, performance, design). " +
        "Return the ID of the template that best fits the task (or null if none fit), a confidence from 0 to 1, " +
        "and a one-sentence rationale. Only use IDs from the provided list.",
      prompt:
        `Task title: "${task.title}"\n` +
        `Task description: "${task.description ?? ""}"\n` +
        `Task labels: ${labels}\n\n` +
        `The label rule would attach template ID ${suggestedTemplate.id} ("${suggestedTemplate.name}").\n\n` +
        `Candidate templates:\n${candidateList}`,
      schema: adjudicationSchema,
      maxOutputTokens: 500,
      abortSignal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });

    const parsed = adjudicationSchema.safeParse(object);
    if (!parsed.success) {
      logger.warn("Workflow matching: AI output failed validation, using heuristic", {
        userId,
      });
      return fallback();
    }

    await logAiUsage(supabase, {
      userId,
      actionType: "workflow_matching",
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      model: WORKFLOW_MATCHING_MODEL,
      ideaId: options.ideaId ?? null,
      keyType: resolved.keyType,
    });

    if (resolved.keyType === "platform") {
      await decrementStarterCredit(supabase, userId);
    }

    // Only trust a recommended ID that exists in the candidate set.
    const recommendedTemplateId =
      parsed.data.recommended_template_id &&
      validIds.has(parsed.data.recommended_template_id)
        ? parsed.data.recommended_template_id
        : null;

    const confidence = parsed.data.confidence;

    return {
      source: "ai",
      recommendedTemplateId,
      confidence,
      rationale: parsed.data.rationale,
      autoApply:
        confidence >= WORKFLOW_AI_AUTOAPPLY_THRESHOLD && recommendedTemplateId !== null,
    };
  } catch (err) {
    logger.error("Workflow matching: AI adjudication failed, using heuristic", {
      error: err instanceof Error ? err.message : String(err),
      userId,
    });
    return fallback();
  }
}

// ============================================================
// Shared auto-rule decision: apply vs. suggest
// ============================================================

/**
 * Minimal template shape we need to classify a candidate workflow.
 * `steps` is the raw JSONB from `workflow_templates.steps`.
 */
export interface AutoRuleTemplate {
  id: string;
  name: string;
  description?: string | null;
  steps: Pick<WorkflowTemplateStep, "title" | "description" | "role">[];
}

export interface AutoRuleTask {
  id: string;
  title: string;
  description?: string | null;
  /** Names of OTHER labels currently on the task (used to classify the task). */
  labelNames: string[];
}

export interface DecideAutoRuleInput {
  ideaId: string;
  labelId: string;
  ruleId: string | null;
  template: AutoRuleTemplate;
  task: AutoRuleTask;
  /**
   * Apply the resolved template to the task. Same contract as the existing
   * auto-rule `applyFn`. Must resolve (or reject) — never returns a value we use.
   */
  applyFn: (taskId: string, templateId: string) => Promise<unknown>;
  /**
   * True when an autonomous agent (not a human in the UI) triggered this. In
   * that case a confident AI verdict NEVER silently swaps the template — it
   * just updates the suggestion for a human to resolve later.
   */
  isAutonomousAgent?: boolean;
  /** Candidate templates the AI may recommend. Defaults to [template]. */
  candidateTemplates?: AdjudicationCandidateTemplate[];
  /** User id used for AI access resolution / usage logging. */
  userId: string;
  /** Override the AI call for testing. */
  generate?: GenerateObjectFn;
  /**
   * Test seam: await the async adjudication instead of firing-and-forgetting.
   * Production callers leave this false so the request path stays fast.
   */
  awaitAdjudication?: boolean;
  /**
   * Schedule the async adjudication as a post-response task (e.g. Next.js
   * `after()`) so it reliably runs on serverless AND its logs are captured. A
   * bare detached promise is dropped (and un-logged) once the function returns
   * on Vercel. Falls back to `void` when not provided (non-Next contexts).
   */
  schedule?: (task: () => void) => void;
}

export interface DecideAutoRuleResult {
  /** Whether the template was applied synchronously. */
  applied: boolean;
  /** Whether a suggestion row was written (suspect path). */
  suggested: boolean;
  /** The open suggestion's id, if one was written/found. */
  suggestionId?: string;
  /** detectMismatch verdict (for callers/tests). */
  mismatch: MismatchResult;
  /** Set when awaitAdjudication=true: the resolved AI verdict. */
  adjudication?: AdjudicationResult;
}

function normalizeSteps(
  raw: unknown
): Pick<WorkflowTemplateStep, "title" | "description" | "role">[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
    .map((s) => ({
      title: typeof s.title === "string" ? s.title : "",
      description: typeof s.description === "string" ? s.description : undefined,
      role: typeof s.role === "string" ? s.role : "",
    }));
}

/**
 * Normalize a raw `workflow_templates` row into an {@link AutoRuleTemplate}.
 * Safe against the JSONB `steps` being null / malformed.
 */
export function templateFromRow(row: {
  id: string;
  name: string;
  description?: string | null;
  steps?: unknown;
}): AutoRuleTemplate {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    steps: normalizeSteps(row.steps),
  };
}

/**
 * Shared chokepoint deciding whether an auto-rule's template auto-applies or
 * raises a mismatch suggestion. Single source of truth for both the synchronous
 * label-write path (`checkAndApplyAutoRules`) and the retroactive bulk path.
 *
 * NEVER throws — every failure is logged and the function resolves. The
 * synchronous AI adjudication is fire-and-forget unless `awaitAdjudication` is
 * set (tests only).
 */
export async function decideAutoRuleApplication(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  input: DecideAutoRuleInput
): Promise<DecideAutoRuleResult> {
  const {
    ideaId,
    labelId,
    ruleId,
    template,
    task,
    applyFn,
    userId,
    isAutonomousAgent = false,
    candidateTemplates,
    generate,
    awaitAdjudication = false,
    schedule,
  } = input;

  const mismatch = detectMismatch(
    { steps: template.steps, name: template.name },
    { title: task.title, description: task.description },
    task.labelNames
  );

  // Clearly-good fit → silent auto-apply, no AI, no suggestion (AC-1).
  if (!mismatch.suspect) {
    await applyFn(task.id, template.id);
    return { applied: true, suggested: false, mismatch };
  }

  // Suspect → write an in-flight suggestion (idempotent via partial-unique index).
  let suggestionId: string | undefined;
  try {
    const { data: inserted, error: insertErr } = await supabase
      .from("workflow_suggestions")
      .insert({
        idea_id: ideaId,
        task_id: task.id,
        label_id: labelId,
        rule_id: ruleId,
        suggested_template_id: template.id,
        status: "suggested",
        source: "heuristic",
        reason: mismatch.reason,
        detected_categories: mismatch.categories,
        adjudication_started_at: new Date().toISOString(),
      })
      .select("id")
      .maybeSingle();

    if (insertErr) {
      // 23505 = duplicate open suggestion for (task,label) → idempotent no-op (AC-4).
      if (insertErr.code === "23505") {
        const { data: existing } = await supabase
          .from("workflow_suggestions")
          .select("id")
          .eq("task_id", task.id)
          .eq("label_id", labelId)
          .eq("status", "suggested")
          .maybeSingle();
        suggestionId = existing?.id;
        return { applied: false, suggested: true, suggestionId, mismatch };
      }
      throw new Error(insertErr.message);
    }
    suggestionId = inserted?.id;
  } catch (err) {
    logger.error("Workflow suggestion: failed to record open suggestion", {
      error: err instanceof Error ? err.message : String(err),
      taskId: task.id,
      labelId,
    });
    // Detection/persistence must never block the label write (AC-18).
    return { applied: false, suggested: false, mismatch };
  }

  if (!suggestionId) {
    return { applied: false, suggested: true, mismatch };
  }

  const adjudicate = () =>
    runAdjudication(supabase, {
      suggestionId: suggestionId!,
      userId,
      ideaId,
      template,
      task,
      applyFn,
      isAutonomousAgent,
      candidateTemplates,
      generate,
    });

  if (awaitAdjudication) {
    const adjudication = await adjudicate();
    return { applied: false, suggested: true, suggestionId, mismatch, adjudication };
  }

  // Run after the response so the request path stays fast. Prefer a scheduled
  // post-response task (Next.js `after()`): it reliably runs on serverless and
  // its logs are captured. A bare detached promise is dropped + un-logged there.
  const runAdjudicate = () =>
    adjudicate().catch((err) => {
      logger.error("Workflow suggestion: async adjudication crashed", {
        error: err instanceof Error ? err.message : String(err),
        suggestionId,
      });
    });
  if (schedule) {
    schedule(runAdjudicate);
  } else {
    void runAdjudicate();
  }

  return { applied: false, suggested: true, suggestionId, mismatch };
}

interface RunAdjudicationInput {
  suggestionId: string;
  userId: string;
  ideaId: string;
  template: AutoRuleTemplate;
  task: AutoRuleTask;
  applyFn: (taskId: string, templateId: string) => Promise<unknown>;
  isAutonomousAgent: boolean;
  candidateTemplates?: AdjudicationCandidateTemplate[];
  generate?: GenerateObjectFn;
}

/**
 * Resolve an open suggestion via AI. On a confident verdict (and a human
 * context) it applies the recommended template and marks the suggestion
 * accepted/replaced; otherwise it records the AI verdict for a human to
 * resolve. AI failure leaves a heuristic-sourced open suggestion. Never throws.
 */
async function runAdjudication(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  input: RunAdjudicationInput
): Promise<AdjudicationResult> {
  const {
    suggestionId,
    userId,
    ideaId,
    template,
    task,
    applyFn,
    isAutonomousAgent,
    candidateTemplates,
    generate,
  } = input;

  const suggestedCandidate: AdjudicationCandidateTemplate = {
    id: template.id,
    name: template.name,
    description: template.description,
    steps: template.steps.map((s) => ({ title: s.title, role: s.role })),
  };
  const candidates =
    candidateTemplates && candidateTemplates.length > 0
      ? candidateTemplates
      : [suggestedCandidate];

  let result: AdjudicationResult;
  try {
    result = await adjudicateWorkflowMatch(
      supabase as SupabaseClient<Database>,
      userId,
      suggestedCandidate,
      candidates,
      {
        title: task.title,
        description: task.description,
        labelNames: task.labelNames,
      },
      { ideaId, generate }
    );
  } catch (err) {
    // adjudicateWorkflowMatch is non-throwing, but belt-and-suspenders.
    logger.error("Workflow suggestion: adjudication threw, leaving heuristic", {
      error: err instanceof Error ? err.message : String(err),
      suggestionId,
    });
    await clearInFlight(supabase, suggestionId).catch(() => {});
    return {
      source: "heuristic",
      recommendedTemplateId: null,
      confidence: 0,
      rationale: "AI unavailable",
      autoApply: false,
    };
  }

  // Confident verdict + valid recommendation + human context → auto-apply.
  if (result.autoApply && result.recommendedTemplateId && !isAutonomousAgent) {
    try {
      await applyFn(task.id, result.recommendedTemplateId);
      const replaced = result.recommendedTemplateId !== template.id;
      await supabase
        .from("workflow_suggestions")
        .update({
          status: replaced ? "replaced" : "accepted",
          source: result.source,
          ai_confidence: result.confidence,
          recommended_template_id: result.recommendedTemplateId,
          replacement_template_id: replaced ? result.recommendedTemplateId : null,
          reason: result.rationale,
          adjudication_started_at: null,
          resolved_at: new Date().toISOString(),
        })
        .eq("id", suggestionId)
        .eq("status", "suggested");
      return result;
    } catch (err) {
      logger.error("Workflow suggestion: auto-apply of AI recommendation failed", {
        error: err instanceof Error ? err.message : String(err),
        suggestionId,
      });
      // Fall through and just persist the verdict for manual resolution.
    }
  }

  // Uncertain (or autonomous, or auto-apply failed) → record verdict, stay open.
  await supabase
    .from("workflow_suggestions")
    .update({
      source: result.source,
      ai_confidence: result.confidence,
      recommended_template_id: result.recommendedTemplateId,
      reason: result.rationale,
      adjudication_started_at: null,
    })
    .eq("id", suggestionId)
    .eq("status", "suggested")
    .then(undefined, (err: unknown) => {
      logger.error("Workflow suggestion: failed to persist AI verdict", {
        error: err instanceof Error ? err.message : String(err),
        suggestionId,
      });
    });

  return result;
}

/** Clear the in-flight marker so a stuck "checking…" suggestion resolves. */
async function clearInFlight(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  suggestionId: string
): Promise<void> {
  await supabase
    .from("workflow_suggestions")
    .update({ adjudication_started_at: null })
    .eq("id", suggestionId)
    .eq("status", "suggested");
}

/**
 * Transition any open suggestion(s) for a (task,label) to `dismissed` — called
 * when the label is removed from the task (AC-8). Never throws.
 */
export async function dismissSuggestionsForLabel(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  taskId: string,
  labelId: string,
  reason = "label_removed"
): Promise<void> {
  try {
    await supabase
      .from("workflow_suggestions")
      .update({
        status: "dismissed",
        reason,
        resolved_at: new Date().toISOString(),
      })
      .eq("task_id", taskId)
      .eq("label_id", labelId)
      .eq("status", "suggested");
  } catch (err) {
    logger.error("Workflow suggestion: failed to dismiss on label removal", {
      error: err instanceof Error ? err.message : String(err),
      taskId,
      labelId,
    });
  }
}
