"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import {
  Lightbulb,
  Sparkles,
  Cog,
  Check,
  Replace as ReplaceIcon,
  X,
  Loader2,
  ArrowLeft,
  ChevronRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import {
  keepWorkflowSuggestion,
  replaceWorkflowSuggestion,
  removeWorkflowSuggestion,
} from "@/actions/workflow-suggestions";
import { listWorkflowTemplates } from "@/actions/workflow-templates";
import { WORKFLOW_AI_ADJUDICATION_TIMEOUT_MS } from "@/lib/workflow-suggestion-constants";
import type { WorkflowSuggestion, WorkflowTemplate } from "@/types";

/**
 * Inline panel surfacing an open mismatched-workflow suggestion at the top of a
 * task's workflow area (NOT a modal — keeps task context visible, works on
 * mobile). Renders the suggested template, a provenance badge (✨ AI / ⛭ Rules),
 * the reason, and Keep / Replace / Remove actions. See
 * docs/workflow-suggestion-ux.html for the approved design.
 *
 * Self-fetches the open suggestion and subscribes to Realtime so it appears,
 * updates, and collapses live. On Keep/Replace the parent's `onResolved`
 * callback re-fetches the workflow so the normal run UI takes over.
 */

/**
 * Whether an open suggestion is still being adjudicated (async AI verdict in
 * flight): no finalised reason yet and the adjudication started recently.
 * Module-level so the `Date.now()` read isn't an impure call during render.
 *
 * Uses the shared adjudication window so the UI and an agent's
 * `claim_next_step` never disagree about whether a row is still "checking fit".
 */
export function isAdjudicating(
  s: Pick<WorkflowSuggestion, "reason" | "adjudication_started_at">,
): boolean {
  if (s.reason) return false;
  if (!s.adjudication_started_at) return false;
  return (
    Date.now() - new Date(s.adjudication_started_at).getTime() <
    WORKFLOW_AI_ADJUDICATION_TIMEOUT_MS
  );
}

type OpenSuggestion = Pick<
  WorkflowSuggestion,
  | "id"
  | "task_id"
  | "idea_id"
  | "suggested_template_id"
  | "recommended_template_id"
  | "source"
  | "reason"
  | "adjudication_started_at"
  | "status"
>;

interface WorkflowSuggestionPanelProps {
  taskId: string;
  ideaId: string;
  isReadOnly?: boolean;
  /** Called after a successful Keep/Replace/Remove so the parent can re-fetch. */
  onResolved?: () => void;
}

function templateStepCount(t: WorkflowTemplate): number {
  return Array.isArray(t.steps) ? t.steps.length : 0;
}

/** Extract the title/role we display from a template's steps. */
function templateSteps(t: WorkflowTemplate): { title: string; role?: string }[] {
  if (!Array.isArray(t.steps)) return [];
  return t.steps.map((s) => ({
    title: s.title || "Untitled step",
    role: s.role || undefined,
  }));
}

export function WorkflowSuggestionPanel({
  taskId,
  ideaId,
  isReadOnly = false,
  onResolved,
}: WorkflowSuggestionPanelProps) {
  const [suggestion, setSuggestion] = useState<OpenSuggestion | null>(null);
  const [loading, setLoading] = useState(true);

  // Replace-picker state
  const [showPicker, setShowPicker] = useState(false);
  const [templates, setTemplates] = useState<WorkflowTemplate[] | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");

  // Action loading state — null when idle, else the active action
  const [working, setWorking] = useState<"keep" | "replace" | "remove" | null>(
    null,
  );

  const supabaseRef = useRef(createClient());

  const fetchSuggestion = useCallback(async () => {
    const supabase = supabaseRef.current;
    const { data } = await supabase
      .from("workflow_suggestions")
      .select(
        "id, task_id, idea_id, suggested_template_id, recommended_template_id, source, reason, adjudication_started_at, status",
      )
      .eq("task_id", taskId)
      .eq("status", "suggested")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setSuggestion((data as OpenSuggestion | null) ?? null);
    setLoading(false);
  }, [taskId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchSuggestion();

    const supabase = supabaseRef.current;
    const channel = supabase
      .channel(`workflow-suggestions-${taskId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "workflow_suggestions",
          filter: `task_id=eq.${taskId}`,
        },
        () => {
          fetchSuggestion();
        },
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [taskId, fetchSuggestion]);

  // The AI recommends a DIFFERENT template than the label attached → the primary
  // action should follow that recommendation, not "Keep" the mismatched one.
  const recommendedId = suggestion?.recommended_template_id ?? null;
  const hasDistinctRecommendation =
    suggestion?.source === "ai" &&
    !!recommendedId &&
    recommendedId !== suggestion?.suggested_template_id;

  // Load templates when the picker opens, when there's a distinct recommendation
  // to name, OR whenever a suggestion is open so we can name the labelled
  // template the "Keep" action would attach. Without this last case (the common
  // heuristic/"Rules" suggestion), templates stay null and the panel falls back
  // to an unnamed "Keep & attach".
  const needsTemplateNames =
    showPicker || hasDistinctRecommendation || !!suggestion?.suggested_template_id;
  useEffect(() => {
    if (templates !== null) return;
    if (!needsTemplateNames) return;
    listWorkflowTemplates(ideaId)
      .then((data) => setTemplates((data ?? []) as WorkflowTemplate[]))
      .catch(() => setTemplates([]));
  }, [needsTemplateNames, ideaId, templates]);

  // The same panel instance is reused across suggestions (it returns null while
  // hidden but never unmounts). When the active suggestion changes — a resolved
  // one clears, or a fresh one arrives — drop any stale action/picker state from
  // the previous suggestion, otherwise the busy "Working…" state from a prior
  // Keep/Replace/Remove sticks to the new row's buttons. The id is unchanged
  // during an in-flight action, so this never interrupts the deliberate
  // keep-busy-until-collapse behaviour.
  const suggestionId = suggestion?.id ?? null;
  useEffect(() => {
    // Resetting in response to the suggestion changing is the intended effect.
    /* eslint-disable react-hooks/set-state-in-effect */
    setWorking(null);
    setShowPicker(false);
    setSelectedTemplateId("");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [suggestionId]);

  const openPicker = useCallback(() => {
    // Pre-select the AI's recommended fit when present (one-click accept).
    setSelectedTemplateId(suggestion?.recommended_template_id ?? "");
    setShowPicker(true);
  }, [suggestion?.recommended_template_id]);

  async function handleKeep() {
    if (!suggestion || working) return;
    setWorking("keep");
    const result = await keepWorkflowSuggestion(suggestion.id);
    if ("error" in result) {
      toast.error(result.error);
      setWorking(null);
      return;
    }
    toast.success("Workflow attached");
    // Leave `working` set so the panel stays in its busy state until the
    // realtime fetch collapses it — avoids a flash of the idle panel.
    onResolved?.();
  }

  async function handleReplace(templateId?: string) {
    const targetId = templateId ?? selectedTemplateId;
    if (!suggestion || !targetId || working) return;
    setWorking("replace");
    const result = await replaceWorkflowSuggestion(suggestion.id, targetId);
    if ("error" in result) {
      toast.error(result.error);
      setWorking(null);
      return;
    }
    toast.success("Workflow attached");
    onResolved?.();
  }

  async function handleRemove() {
    if (!suggestion || working) return;
    setWorking("remove");
    const result = await removeWorkflowSuggestion(suggestion.id);
    if ("error" in result) {
      toast.error(result.error);
      setWorking(null);
      return;
    }
    toast.success("Suggestion dismissed");
    onResolved?.();
  }

  if (loading || isReadOnly) return null;
  if (!suggestion) return null;

  // A suggestion row whose source hasn't been finalised yet (async AI
  // adjudication in flight): show the calm "checking fit…" micro-state.
  if (isAdjudicating(suggestion)) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-3 rounded-md border border-dashed border-violet-500/40 bg-violet-500/10 px-3 py-3"
      >
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-violet-500/20 text-violet-300"
          aria-hidden="true"
        >
          <Sparkles className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-violet-200">
            Checking workflow fit&hellip;
          </p>
          <p className="text-[11.5px] text-muted-foreground">
            We&rsquo;ll surface anything that needs a decision. You can keep
            working.
          </p>
        </div>
      </div>
    );
  }

  const isAi = suggestion.source === "ai";
  const recommendedTemplate = recommendedId
    ? templates?.find((t) => t.id === recommendedId)
    : undefined;
  const recommendedName = recommendedTemplate?.name;
  // The originally-labelled template — what "Keep" would attach. Surfaced
  // explicitly so the action never refers to an unnamed workflow.
  const suggestedTemplate = templates?.find(
    (t) => t.id === suggestion.suggested_template_id
  );
  const suggestedName = suggestedTemplate?.name;

  return (
    <div
      role="region"
      aria-label="Workflow suggestion"
      aria-busy={working !== null}
      className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3.5"
    >
      {!showPicker ? (
        <>
          {/* Heading row */}
          <div className="flex items-start gap-2.5">
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-amber-500/20 text-amber-400"
              aria-hidden="true"
            >
              <Lightbulb className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <h4 className="text-[13px] font-semibold text-amber-200">
                  Suggested workflow looks mismatched
                </h4>
                {isAi ? (
                  <Badge
                    variant="outline"
                    className="gap-1 border-violet-500/40 bg-violet-500/15 text-[10px] font-bold text-violet-300"
                    title="Reason generated by AI adjudication"
                  >
                    <Sparkles className="h-2.5 w-2.5" aria-hidden="true" />
                    AI
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="gap-1 border-border bg-muted text-[10px] font-bold text-muted-foreground"
                    title="Reason from the keyword heuristic"
                  >
                    <Cog className="h-2.5 w-2.5" aria-hidden="true" />
                    Rules
                  </Badge>
                )}
              </div>
              {suggestedName && (
                <p className="mb-1.5 text-[12px] text-muted-foreground">
                  Your label suggests the{" "}
                  <span className="font-semibold text-foreground">
                    {suggestedName}
                  </span>{" "}
                  workflow.
                </p>
              )}
              {suggestion.reason && (
                <p className="rounded-md border border-border bg-background/60 px-2.5 py-2 text-[12.5px] leading-relaxed text-foreground/90">
                  {suggestion.reason}
                </p>
              )}
            </div>
          </div>

          {/* Actions. When the AI recommends a DIFFERENT template, the primary
              action follows that recommendation; "Keep" is demoted. Otherwise
              (heuristic / no distinct pick) Keep stays primary. Stack full-width
              on mobile, inline ≥sm; every target ≥44px. */}
          {hasDistinctRecommendation ? (
            <>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                <Button
                  size="sm"
                  onClick={() => recommendedId && handleReplace(recommendedId)}
                  disabled={working !== null}
                  className="min-h-[44px] gap-1.5 bg-emerald-600 text-white hover:bg-emerald-600/90 sm:min-h-9"
                >
                  {working === "replace" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  {working === "replace"
                    ? "Working…"
                    : recommendedName
                      ? `Use “${recommendedName}”`
                      : "Use recommended workflow"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleKeep}
                  disabled={working !== null}
                  className="min-h-[44px] gap-1.5 sm:min-h-9"
                >
                  {working === "keep" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  {working === "keep"
                    ? "Working…"
                    : suggestedName
                      ? `Keep “${suggestedName}”`
                      : "Keep anyway"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleRemove}
                  disabled={working !== null}
                  className="min-h-[44px] gap-1.5 text-muted-foreground hover:text-foreground sm:min-h-9 sm:ml-auto"
                >
                  {working === "remove" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  {working === "remove" ? "Working…" : "Remove"}
                </Button>
              </div>
              <p className="mt-2.5 text-[11.5px] text-muted-foreground">
                Nothing is attached until you choose.{" "}
                <button
                  type="button"
                  onClick={openPicker}
                  disabled={working !== null}
                  className="font-medium text-foreground underline underline-offset-2 hover:text-foreground/80 disabled:opacity-50"
                >
                  Replace with a different workflow&hellip;
                </button>
              </p>
            </>
          ) : (
            <>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <Button
                  size="sm"
                  onClick={handleKeep}
                  disabled={working !== null}
                  className="min-h-[44px] gap-1.5 bg-emerald-600 text-white hover:bg-emerald-600/90 sm:min-h-9"
                >
                  {working === "keep" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  {working === "keep"
                    ? "Working…"
                    : suggestedName
                      ? `Keep & attach “${suggestedName}”`
                      : "Keep & attach"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={openPicker}
                  disabled={working !== null}
                  className="min-h-[44px] gap-1.5 sm:min-h-9"
                >
                  <ReplaceIcon className="h-3.5 w-3.5" aria-hidden="true" />
                  Replace&hellip;
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleRemove}
                  disabled={working !== null}
                  className="min-h-[44px] gap-1.5 text-muted-foreground hover:text-foreground sm:min-h-9 sm:ml-auto"
                >
                  {working === "remove" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  {working === "remove" ? "Working…" : "Remove"}
                </Button>
              </div>
              <p className="mt-2.5 text-[11.5px] text-muted-foreground">
                Nothing is attached until you Keep or Replace. Remove keeps the
                label and dismisses this suggestion.
              </p>
            </>
          )}
        </>
      ) : (
        <ReplacePicker
          templates={templates}
          suggestedTemplateId={suggestion.suggested_template_id}
          recommendedTemplateId={
            isAi ? suggestion.recommended_template_id : null
          }
          selectedTemplateId={selectedTemplateId}
          onSelect={setSelectedTemplateId}
          onBack={() => setShowPicker(false)}
          onAttach={handleReplace}
          working={working === "replace"}
          disabled={working !== null}
          templateStepCount={templateStepCount}
        />
      )}
    </div>
  );
}

interface ReplacePickerProps {
  templates: WorkflowTemplate[] | null;
  suggestedTemplateId: string | null;
  recommendedTemplateId: string | null;
  selectedTemplateId: string;
  onSelect: (id: string) => void;
  onBack: () => void;
  onAttach: () => void;
  working: boolean;
  disabled: boolean;
  templateStepCount: (t: WorkflowTemplate) => number;
}

function ReplacePicker({
  templates,
  suggestedTemplateId,
  recommendedTemplateId,
  selectedTemplateId,
  onSelect,
  onBack,
  onAttach,
  working,
  disabled,
  templateStepCount,
}: ReplacePickerProps) {
  // Which row's steps are expanded. All rows start collapsed; the user expands
  // whichever they want via the arrow. Declared before any early return to
  // satisfy the Rules of Hooks.
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (templates === null) {
    return (
      <div className="flex items-center gap-2 py-3">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <span className="text-xs text-muted-foreground">
          Loading templates&hellip;
        </span>
      </div>
    );
  }

  // Empty / edge: only the labelled template exists → never a dead-end.
  const otherTemplates = templates.filter(
    (t) => t.id !== suggestedTemplateId,
  );
  if (otherTemplates.length === 0) {
    return (
      <div>
        <p className="text-[12.5px] text-muted-foreground">
          This idea has only the labelled template.{" "}
          <a
            href="?tab=workflows"
            className="font-medium text-primary underline underline-offset-2"
          >
            Create a workflow template
          </a>{" "}
          to replace it, or Remove the suggestion instead.
        </p>
        <div className="mt-3">
          <Button
            size="sm"
            variant="ghost"
            onClick={onBack}
            className="min-h-[44px] gap-1.5 sm:min-h-9"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Back
          </Button>
        </div>
      </div>
    );
  }

  // Order: AI-recommended first (pinned), then the rest, then the originally
  // labelled template last (tagged), so the mismatch relationship is explicit.
  const recommended = recommendedTemplateId
    ? templates.find((t) => t.id === recommendedTemplateId)
    : undefined;
  const originallyLabelled = suggestedTemplateId
    ? templates.find((t) => t.id === suggestedTemplateId)
    : undefined;

  const ordered: { template: WorkflowTemplate; tag: "ai" | "labelled" | null }[] =
    [];
  if (recommended) ordered.push({ template: recommended, tag: "ai" });
  for (const t of templates) {
    if (t.id === recommendedTemplateId) continue;
    if (t.id === suggestedTemplateId) continue;
    ordered.push({ template: t, tag: null });
  }
  if (originallyLabelled)
    ordered.push({ template: originallyLabelled, tag: "labelled" });

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);

  return (
    <div>
      <p className="mb-2.5 text-[12.5px] text-muted-foreground">
        Pick the workflow that matches this work. Scoped to this idea&rsquo;s
        templates. Tap a workflow to select it, or the arrow to preview its
        steps.
      </p>
      <ul role="listbox" aria-label="Replacement workflow templates" className="space-y-1.5">
        {ordered.map(({ template, tag }) => {
          const selected = template.id === selectedTemplateId;
          const expanded = template.id === expandedId;
          const steps = templateSteps(template);
          return (
            <li key={template.id}>
              <div
                className={`flex w-full items-stretch rounded-md border transition-colors ${
                  selected
                    ? "border-violet-500/60 bg-violet-500/10"
                    : "border-border bg-muted/40 hover:border-border/80 hover:bg-muted/70"
                } ${tag === "labelled" ? "opacity-80" : ""}`}
              >
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => onSelect(template.id)}
                  disabled={disabled}
                  className="flex min-h-[44px] flex-1 items-center gap-3 rounded-l-md px-3 py-2 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-[13px] font-semibold text-foreground">
                        {template.name}
                      </span>
                      {tag === "ai" && (
                        <Badge
                          variant="outline"
                          className="gap-1 border-violet-500/40 bg-violet-500/15 text-[10px] font-bold uppercase text-violet-300"
                        >
                          <Sparkles className="h-2.5 w-2.5" aria-hidden="true" />
                          AI recommends
                        </Badge>
                      )}
                      {tag === "labelled" && (
                        <Badge
                          variant="outline"
                          className="border-border text-[10px] font-medium text-muted-foreground"
                        >
                          originally labelled
                        </Badge>
                      )}
                    </div>
                    <span className="text-[11.5px] text-muted-foreground">
                      {templateStepCount(template)} step
                      {templateStepCount(template) === 1 ? "" : "s"}
                    </span>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : template.id)}
                  disabled={disabled}
                  aria-expanded={expanded}
                  aria-label={
                    expanded
                      ? `Hide ${template.name} steps`
                      : `Show ${template.name} steps`
                  }
                  className="flex min-h-[44px] shrink-0 items-center rounded-r-md px-3 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ChevronRight
                    className={`h-4 w-4 shrink-0 transition-transform ${
                      expanded ? "rotate-90" : ""
                    } ${selected ? "text-violet-300" : ""}`}
                    aria-hidden="true"
                  />
                </button>
              </div>
              {expanded && (
                <ol className="mb-0.5 mt-1 space-y-1 rounded-md border border-border/60 bg-background/40 px-3 py-2">
                  {steps.length === 0 ? (
                    <li className="text-[11.5px] text-muted-foreground">
                      No steps defined.
                    </li>
                  ) : (
                    steps.map((s, i) => (
                      <li
                        key={i}
                        className="flex items-center gap-2 text-[11.5px]"
                      >
                        <span className="shrink-0 tabular-nums text-muted-foreground/70">
                          {i + 1}.
                        </span>
                        <span className="min-w-0 truncate text-foreground/90">
                          {s.title}
                        </span>
                        {s.role && (
                          <span className="ml-auto shrink-0 text-muted-foreground/70">
                            {s.role}
                          </span>
                        )}
                      </li>
                    ))
                  )}
                </ol>
              )}
            </li>
          );
        })}
      </ul>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Button
          size="sm"
          onClick={onAttach}
          disabled={!selectedTemplateId || disabled}
          className="min-h-[44px] gap-1.5 bg-emerald-600 text-white hover:bg-emerald-600/90 sm:min-h-9"
        >
          {working ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {working
            ? "Working…"
            : selectedTemplate
              ? `Attach “${selectedTemplate.name}”`
              : "Attach"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onBack}
          disabled={disabled}
          className="min-h-[44px] gap-1.5 text-muted-foreground hover:text-foreground sm:min-h-9"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back
        </Button>
      </div>
    </div>
  );
}
