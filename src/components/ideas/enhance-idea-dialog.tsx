"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  Sparkles,
  ArrowLeft,
  MessageSquareMore,
  PenLine,
  RotateCcw,
  Plus,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Markdown } from "@/components/ui/markdown";
import {
  applyEnhancedDescription,
  generateClarifyingQuestions,
} from "@/actions/ai";
import { PromptTemplateSelector } from "@/components/ai/prompt-template-selector";
import { AiProgressSteps } from "@/components/ai/ai-progress-steps";
import type { ClarifyingQuestion } from "@/actions/ai";
import type { BotProfile } from "@/types";

const DEFAULT_PROMPT =
  "Improve this idea description. Add more detail, user stories, technical scope, and a clear product vision. Keep the original intent and key points, but make it more comprehensive and well-structured.";

type DialogPhase = "configure" | "questions" | "result" | "refine";

interface EnhanceIdeaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ideaId: string;
  ideaTitle: string;
  currentDescription: string;
  bots: BotProfile[];
  onCreditUsed?: () => void;
}

/** Extract top-level markdown headings (## only) from enhanced text for change summary chips. */
function extractHeadings(text: string): string[] {
  const headings: string[] = [];
  for (const line of text.split("\n")) {
    const match = line.match(/^##\s+(.+)/);
    if (match) headings.push(match[1].trim());
  }
  return headings;
}

const MAX_CHIPS = 6;

export function EnhanceIdeaDialog({
  open,
  onOpenChange,
  ideaId,
  ideaTitle,
  currentDescription,
  bots,
  onCreditUsed,
}: EnhanceIdeaDialogProps) {
  const router = useRouter();

  // Phase state
  const [phase, setPhase] = useState<DialogPhase>("configure");

  // Configure phase
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [selectedBotId, setSelectedBotId] = useState<string>("default");
  const [askQuestions, setAskQuestions] = useState(true);

  // Questions phase
  const [questions, setQuestions] = useState<ClarifyingQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [generatingQuestions, setGeneratingQuestions] = useState(false);

  // Result phase
  const [enhancedText, setEnhancedText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);

  // Refine phase
  const [refinementInput, setRefinementInput] = useState("");
  const [truncated, setTruncated] = useState(false);

  // Result phase: collapsible original on mobile
  const [originalExpanded, setOriginalExpanded] = useState(true);

  // Auto-scroll the enhanced text box while streaming
  const enhancedBoxRef = useRef<HTMLDivElement>(null);

  const busy = loading || applying || generatingQuestions;

  // Extract section headings for change summary chips
  const sectionHeadings = useMemo(
    () => (enhancedText ? extractHeadings(enhancedText) : []),
    [enhancedText]
  );

  // Auto-scroll enhanced text box to bottom while streaming
  useEffect(() => {
    if (loading && enhancedBoxRef.current) {
      enhancedBoxRef.current.scrollTop = enhancedBoxRef.current.scrollHeight;
    }
  }, [loading, enhancedText]);

  const questionSteps = [
    { title: "Reading your idea", description: "Analyzing the description and prompt" },
    { title: "Crafting targeted questions", description: "Identifying gaps to fill" },
    { title: "Preparing", description: "Finalizing questions" },
  ];

  const enhanceSteps = [
    { title: "Analyzing description", description: "Understanding your idea" },
    { title: "Enhancing content", description: "Writing improved version" },
    { title: "Polishing output", description: "Refining structure and detail" },
  ];

  const refineSteps = [
    { title: "Reading feedback", description: "Understanding your changes" },
    { title: "Revising content", description: "Applying your feedback" },
    { title: "Polishing", description: "Finalizing the revision" },
  ];
  const activeBots = bots.filter((b) => b.is_active);

  function getPersonaPrompt() {
    if (selectedBotId === "default") return null;
    return activeBots.find((b) => b.id === selectedBotId)?.system_prompt ?? null;
  }

  // ── Phase: Configure → Questions or Result ──────────────────────────

  async function handleNext() {
    if (askQuestions) {
      // Generate clarifying questions
      setGeneratingQuestions(true);
      try {
        const result = await generateClarifyingQuestions(
          ideaId,
          prompt,
          getPersonaPrompt()
        );
        onCreditUsed?.();
        setQuestions(result.questions);
        setAnswers({});
        setPhase("questions");
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to generate questions"
        );
      } finally {
        setGeneratingQuestions(false);
      }
    } else {
      // Legacy one-shot path
      await handleEnhanceLegacy();
    }
  }

  // Shared streaming helper — calls /api/ai/enhance and reads the text stream
  async function runStreamingEnhance(options?: {
    personaPrompt?: string | null;
    answers?: Record<string, { question: string; answer: string }>;
    previousEnhanced?: string;
    refinementFeedback?: string;
  }) {
    setLoading(true);
    setEnhancedText("");
    setTruncated(false);
    setPhase("result");
    try {
      const res = await fetch("/api/ai/enhance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ideaId,
          prompt,
          ...options,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let text = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        setEnhancedText(text);
      }

      // Detect truncation sentinel from server
      const TRUNCATION_MARKER = "\n\n__TRUNCATED__";
      if (text.endsWith(TRUNCATION_MARKER)) {
        text = text.slice(0, -TRUNCATION_MARKER.length);
        setEnhancedText(text);
        setTruncated(true);
      }

      // Credit was consumed server-side in onFinish — update the badge
      onCreditUsed?.();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to enhance description"
      );
      setPhase("configure");
      setEnhancedText(null);
    } finally {
      setLoading(false);
    }
  }

  // Legacy one-shot enhance (no questions)
  async function handleEnhanceLegacy() {
    await runStreamingEnhance({ personaPrompt: getPersonaPrompt() });
  }

  // ── Phase: Questions → Result ───────────────────────────────────────

  async function handleEnhanceWithAnswers() {
    const answersPayload: Record<string, { question: string; answer: string }> = {};
    for (const q of questions) {
      const answer = (answers[q.id] ?? "").trim();
      if (answer) {
        answersPayload[q.id] = { question: q.question, answer };
      }
    }
    await runStreamingEnhance({
      personaPrompt: getPersonaPrompt(),
      answers: Object.keys(answersPayload).length > 0 ? answersPayload : undefined,
    });
  }

  async function handleSkipQuestions() {
    await runStreamingEnhance({ personaPrompt: getPersonaPrompt() });
  }

  // ── Phase: Result → Apply or Refine ─────────────────────────────────

  async function handleApply() {
    if (!enhancedText) return;
    setApplying(true);
    try {
      await applyEnhancedDescription(ideaId, enhancedText);
      toast.success("Description updated with AI enhancement");
      onOpenChange(false);
      resetState();
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to apply enhancement"
      );
    } finally {
      setApplying(false);
    }
  }

  // ── Continue from truncation ────────────────────────────────────────

  async function handleContinue() {
    if (!enhancedText) return;
    await runStreamingEnhance({
      personaPrompt: getPersonaPrompt(),
      previousEnhanced: enhancedText,
      refinementFeedback:
        "The previous output was cut off before it could finish. Continue writing from exactly where you stopped. Do NOT repeat any content that was already written — pick up mid-sentence or mid-section if needed.",
    });
  }

  // ── Phase: Refine → Result ──────────────────────────────────────────

  async function handleRefine() {
    if (!enhancedText || !refinementInput.trim()) return;
    const feedback = refinementInput.trim();
    const previous = enhancedText;
    setRefinementInput("");
    await runStreamingEnhance({
      personaPrompt: getPersonaPrompt(),
      previousEnhanced: previous,
      refinementFeedback: feedback,
    });
  }

  // ── Reset & Navigation ──────────────────────────────────────────────

  function resetState() {
    setPhase("configure");
    setPrompt(DEFAULT_PROMPT);
    setSelectedBotId("default");
    setAskQuestions(true);
    setQuestions([]);
    setAnswers({});
    setEnhancedText(null);
    setTruncated(false);
    setRefinementInput("");
    setOriginalExpanded(true);
  }

  function handleOpenChange(value: boolean) {
    if (busy) return;
    if (!value) resetState();
    onOpenChange(value);
  }

  // ── Phase descriptions ──────────────────────────────────────────────

  const phaseDescriptions: Record<DialogPhase, string> = {
    configure: "Configure how AI should enhance your idea description.",
    questions: "Answer a few questions to help AI understand your vision better.",
    result: loading
      ? "Generating enhanced description..."
      : "Compare the original and enhanced descriptions.",
    refine: "Tell the AI how to improve the enhancement.",
  };

  // Wider dialog for result/refine phases
  const isWidePhase = phase === "result" || phase === "refine";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={`flex max-h-[90vh] flex-col overflow-hidden p-0 transition-[max-width] duration-200 ${
          isWidePhase ? "sm:max-w-4xl" : "sm:max-w-2xl"
        }`}
        onInteractOutside={(e) => busy && e.preventDefault()}
        onEscapeKeyDown={(e) => busy && e.preventDefault()}
      >
        {/* ── Header ──────────────────────────────────────────────── */}
        <DialogHeader className="shrink-0 border-b border-border px-5 py-4 sm:px-6">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-[18px] w-[18px] text-violet-400" />
            Enhance with AI
          </DialogTitle>
          <DialogDescription>{phaseDescriptions[phase]}</DialogDescription>
        </DialogHeader>

        {/* ── Scrollable Body ─────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {/* ── Configure Phase ──────────────────────────────────── */}
          {phase === "configure" && (
            <div className="space-y-4">
              <div className="grid">
                <div className={`col-start-1 row-start-1 ${generatingQuestions || loading ? "pointer-events-none opacity-40 blur-[1px]" : ""} transition-all`}>
                  {/* Persona selector */}
                  {activeBots.length > 0 && (
                    <div className="space-y-2 mb-4">
                      <Label>AI Persona</Label>
                      <Select
                        value={selectedBotId}
                        onValueChange={setSelectedBotId}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select persona" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="default">
                            Default (Product Manager)
                          </SelectItem>
                          {activeBots.map((bot) => (
                            <SelectItem key={bot.id} value={bot.id}>
                              {bot.name}
                              {bot.role ? ` (${bot.role})` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {/* Prompt */}
                  <div className="space-y-2 mb-4">
                    <div className="flex items-center justify-between">
                      <Label>Prompt</Label>
                      <PromptTemplateSelector
                        type="enhance"
                        currentPrompt={prompt}
                        onSelectTemplate={setPrompt}
                        disabled={busy}
                      />
                    </div>
                    <Textarea
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      rows={4}
                      placeholder="Tell the AI how to enhance this description..."
                      disabled={busy}
                    />
                  </div>

                  {/* Ask questions checkbox */}
                  <div className="mb-4 flex items-center gap-2">
                    <Checkbox
                      id="ask-questions"
                      checked={askQuestions}
                      onCheckedChange={(checked) =>
                        setAskQuestions(checked === true)
                      }
                      disabled={busy}
                    />
                    <Label
                      htmlFor="ask-questions"
                      className="cursor-pointer text-sm font-normal"
                    >
                      Ask clarifying questions first (recommended)
                    </Label>
                  </div>

                  {/* Current description preview */}
                  <div className="min-w-0 space-y-2">
                    <Label className="text-muted-foreground">
                      Current Description
                    </Label>
                    <div className="max-h-40 overflow-y-auto overflow-x-hidden rounded-md border border-border bg-muted/30 p-3 text-sm break-words">
                      <Markdown>{currentDescription}</Markdown>
                    </div>
                  </div>
                </div>

                {(generatingQuestions || loading) && (
                  <div className="col-start-1 row-start-1 z-10 flex items-center justify-center">
                    <AiProgressSteps
                      steps={generatingQuestions ? questionSteps : enhanceSteps}
                      advanceAt={generatingQuestions ? [8, 20] : [10, 30]}
                      active={generatingQuestions || loading}
                    />
                  </div>
                )}
              </div>

              {!generatingQuestions && !loading && (
                <Button
                  onClick={handleNext}
                  disabled={!prompt.trim()}
                  className="w-full gap-2"
                >
                  {askQuestions ? (
                    <>
                      <MessageSquareMore className="h-4 w-4" />
                      Next
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" />
                      Enhance
                    </>
                  )}
                </Button>
              )}
            </div>
          )}

          {/* ── Questions Phase ──────────────────────────────────── */}
          {phase === "questions" && (
            <div className="space-y-4">
              <div className="grid">
                <div className={`col-start-1 row-start-1 ${loading ? "pointer-events-none opacity-40 blur-[1px]" : ""} transition-all`}>
                  <div className="space-y-4">
                    {questions.map((q, i) => (
                      <div key={q.id} className="space-y-1.5">
                        <Label className="text-sm">
                          {i + 1}. {q.question}
                        </Label>
                        <Textarea
                          value={answers[q.id] ?? ""}
                          onChange={(e) =>
                            setAnswers((prev) => ({
                              ...prev,
                              [q.id]: e.target.value,
                            }))
                          }
                          placeholder={q.placeholder ?? "Your answer..."}
                          rows={2}
                          disabled={busy}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {loading && (
                  <div className="col-start-1 row-start-1 z-10 flex items-center justify-center">
                    <AiProgressSteps
                      steps={enhanceSteps}
                      advanceAt={[10, 30]}
                      active={loading}
                    />
                  </div>
                )}
              </div>

              {!loading && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={handleEnhanceWithAnswers}
                    disabled={busy}
                    className="min-w-[140px] flex-1 gap-2"
                  >
                    <Sparkles className="h-4 w-4" />
                    Enhance with Answers
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleSkipQuestions}
                    disabled={busy}
                    className="gap-2"
                  >
                    Skip
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setPhase("configure")}
                    disabled={busy}
                    className="gap-2"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Back
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* ── Result Phase ─────────────────────────────────────── */}
          {phase === "result" && enhancedText !== null && (
            <div className="space-y-4">
              {truncated && !loading && (
                <div className="flex items-center justify-between gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                  <span>The output was truncated due to length limits.</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleContinue}
                    disabled={busy}
                    className="h-6 shrink-0 border-amber-500/30 text-xs hover:bg-amber-500/10"
                  >
                    Continue
                  </Button>
                </div>
              )}

              {/* Change summary chips (top-level sections only, capped) */}
              {sectionHeadings.length > 0 && !loading && (
                <div className="flex flex-wrap gap-1.5">
                  {sectionHeadings.slice(0, MAX_CHIPS).map((heading) => (
                    <span
                      key={heading}
                      className="inline-flex items-center gap-1 rounded-full border border-violet-500/20 bg-violet-500/[0.06] px-2.5 py-0.5 text-[11px] font-medium text-violet-400"
                    >
                      <Plus className="h-2.5 w-2.5" />
                      {heading}
                    </span>
                  ))}
                  {sectionHeadings.length > MAX_CHIPS && (
                    <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] text-muted-foreground">
                      +{sectionHeadings.length - MAX_CHIPS} more
                    </span>
                  )}
                </div>
              )}

              {/* Asymmetric comparison: original sidebar + enhanced main */}
              <div className="grid gap-4 sm:grid-cols-[260px_1fr]">
                {/* Original (compact sidebar) */}
                <div className="min-w-0 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
                    <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      Original
                    </span>
                    {/* Mobile toggle */}
                    <button
                      type="button"
                      onClick={() => setOriginalExpanded((v) => !v)}
                      className="ml-auto text-muted-foreground hover:text-foreground sm:hidden"
                    >
                      {originalExpanded ? (
                        <ChevronUp className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                  <div
                    className={`overflow-y-auto overflow-x-hidden rounded-md border border-border bg-muted/20 p-3 text-sm leading-relaxed text-muted-foreground break-words sm:max-h-[50vh] ${
                      originalExpanded ? "max-h-40" : "hidden sm:block"
                    }`}
                  >
                    <Markdown>{currentDescription}</Markdown>
                  </div>
                </div>

                {/* Enhanced (main focus, larger) */}
                <div className="min-w-0 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-1.5 w-1.5 rounded-full bg-violet-400 ${
                        loading ? "enhance-label-dot-pulse" : ""
                      }`}
                    />
                    <span className="text-[11px] font-medium uppercase tracking-wider text-violet-400">
                      Enhanced
                    </span>
                    {loading && (
                      <Loader2 className="h-3 w-3 animate-spin text-violet-400" />
                    )}
                  </div>
                  <div
                    ref={enhancedBoxRef}
                    className="max-h-[50vh] overflow-y-auto overflow-x-hidden rounded-md border border-violet-500/25 bg-gradient-to-br from-violet-500/[0.06] to-transparent p-3 text-sm leading-relaxed break-words sm:p-4"
                  >
                    {enhancedText ? (
                      <>
                        <Markdown>{enhancedText}</Markdown>
                        {loading && (
                          <>
                            <span className="enhance-streaming-cursor" />
                            <div className="mt-3 space-y-2 opacity-50">
                              <div className="enhance-skeleton-line w-full" />
                              <div className="enhance-skeleton-line w-[88%]" />
                              <div className="enhance-skeleton-line w-[72%]" />
                            </div>
                          </>
                        )}
                      </>
                    ) : (
                      <span className="text-muted-foreground italic">
                        Generating...
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Refine Phase ─────────────────────────────────────── */}
          {phase === "refine" && enhancedText && (
            <div className="space-y-4">
              <div className="grid">
                <div className={`col-start-1 row-start-1 ${loading ? "pointer-events-none opacity-40 blur-[1px]" : ""} transition-all`}>
                  {/* Current enhanced preview */}
                  <div className="min-w-0 space-y-2">
                    <Label className="text-muted-foreground">
                      Current Enhancement
                    </Label>
                    <div className="max-h-[40vh] overflow-y-auto overflow-x-hidden rounded-md border border-border bg-muted/30 p-3 text-sm break-words">
                      <Markdown>{enhancedText}</Markdown>
                    </div>
                  </div>

                  {/* Refinement feedback */}
                  <div className="space-y-2 mt-4">
                    <Label>What should be changed?</Label>
                    <Textarea
                      value={refinementInput}
                      onChange={(e) => setRefinementInput(e.target.value)}
                      placeholder='e.g. "Make it more technical", "Add a security section", "Shorten the user stories"'
                      rows={3}
                      disabled={busy}
                    />
                  </div>
                </div>

                {loading && (
                  <div className="col-start-1 row-start-1 z-10 flex items-center justify-center">
                    <AiProgressSteps
                      steps={refineSteps}
                      advanceAt={[8, 25]}
                      active={loading}
                    />
                  </div>
                )}
              </div>

              {!loading && (
                <div className="flex gap-2">
                  <Button
                    onClick={handleRefine}
                    disabled={busy || !refinementInput.trim()}
                    className="flex-1 gap-2"
                  >
                    <PenLine className="h-4 w-4" />
                    Refine
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setPhase("result")}
                    disabled={busy}
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Sticky Footer (result & refine phases) ──────────────── */}
        {phase === "result" && enhancedText !== null && (
          <div className="shrink-0 border-t border-border bg-background px-4 py-3 sm:px-6">
            {loading ? (
              /* Streaming state footer */
              <div className="flex items-center gap-3">
                <div className="enhance-dot-indicator flex gap-[3px]">
                  <span />
                  <span />
                  <span />
                </div>
                <span className="text-[13px] text-muted-foreground">
                  Writing enhanced description...
                </span>
              </div>
            ) : (
              /* Completed state footer */
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setEnhancedText(null);
                    setPhase("configure");
                  }}
                  disabled={busy}
                  className="gap-1.5 text-muted-foreground"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Regenerate
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleOpenChange(false)}
                  disabled={busy}
                  className="text-muted-foreground"
                >
                  Cancel
                </Button>
                <div className="flex-1" />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setRefinementInput("");
                    setPhase("refine");
                  }}
                  disabled={busy}
                  className="gap-1.5"
                >
                  <PenLine className="h-3.5 w-3.5" />
                  Refine
                </Button>
                <Button
                  onClick={handleApply}
                  disabled={busy}
                  size="sm"
                  className="gap-1.5 font-semibold"
                >
                  {applying ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Applying...
                    </>
                  ) : (
                    "Apply Enhancement"
                  )}
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
