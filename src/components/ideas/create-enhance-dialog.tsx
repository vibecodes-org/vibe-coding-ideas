"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sparkles, Loader2, ArrowRight, ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import { generateCreateClarifyingQuestions } from "@/actions/ai";
import type { ClarifyingQuestion } from "@/actions/ai";

type DialogPhase = "configure" | "questions" | "result";

interface SimpleBotProfile {
  id: string;
  full_name: string | null;
  role: string | null;
  system_prompt: string | null;
  is_active: boolean;
}

interface CreateEnhanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  kitType?: string;
  bots: SimpleBotProfile[];
  onApply: (enhanced: string) => void;
  onCreditUsed?: () => void;
}

const DEFAULT_PROMPT =
  "Improve this idea description. Add more detail, user stories, technical scope, and a clear product vision. Keep the original voice and intent.";

export function CreateEnhanceDialog({
  open,
  onOpenChange,
  title,
  description,
  kitType,
  bots,
  onApply,
  onCreditUsed,
}: CreateEnhanceDialogProps) {
  const [phase, setPhase] = useState<DialogPhase>("configure");
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [selectedBotId, setSelectedBotId] = useState<string>("default");
  const [askQuestions, setAskQuestions] = useState(true);

  // Questions phase
  const [questions, setQuestions] = useState<ClarifyingQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [loadingQuestions, setLoadingQuestions] = useState(false);

  // Result phase
  const [enhancedText, setEnhancedText] = useState("");
  const [streaming, setStreaming] = useState(false);

  const activeBots = bots.filter((b) => b.is_active);

  const getPersonaPrompt = useCallback(() => {
    if (selectedBotId === "default") return null;
    return activeBots.find((b) => b.id === selectedBotId)?.system_prompt ?? null;
  }, [selectedBotId, activeBots]);

  const handleReset = useCallback(() => {
    setPhase("configure");
    setQuestions([]);
    setAnswers({});
    setEnhancedText("");
    setStreaming(false);
  }, []);

  const handleClose = useCallback(
    (open: boolean) => {
      if (!open) handleReset();
      onOpenChange(open);
    },
    [onOpenChange, handleReset]
  );

  // ── Configure → Questions ──
  const handleGenerateQuestions = useCallback(async () => {
    if (!title.trim()) {
      toast.error("Add a title first");
      return;
    }
    setLoadingQuestions(true);
    try {
      const { questions: qs } = await generateCreateClarifyingQuestions({
        title,
        description,
        kitType,
        prompt,
        personaPrompt: getPersonaPrompt(),
      });
      setQuestions(qs);
      setAnswers({});
      setPhase("questions");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate questions");
    } finally {
      setLoadingQuestions(false);
    }
  }, [title, description, kitType, prompt, getPersonaPrompt]);

  // ── Stream enhance ──
  const runStreamingEnhance = useCallback(
    async (withAnswers: boolean) => {
      setStreaming(true);
      setEnhancedText("");
      setPhase("result");

      const answersPayload = withAnswers
        ? Object.fromEntries(
            questions
              .filter((q) => answers[q.id]?.trim())
              .map((q) => [q.id, { question: q.question, answer: answers[q.id] }])
          )
        : undefined;

      try {
        const res = await fetch("/api/ai/enhance-create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            description,
            kitType,
            prompt,
            personaPrompt: getPersonaPrompt(),
            answers: answersPayload,
          }),
        });

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({ error: "Enhancement failed" }));
          throw new Error(errBody.error || `HTTP ${res.status}`);
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response stream");

        const decoder = new TextDecoder();
        let accumulated = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          accumulated += decoder.decode(value, { stream: true });
          setEnhancedText(accumulated);
        }

        onCreditUsed?.();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Enhancement failed");
        if (!enhancedText) setPhase("configure");
      } finally {
        setStreaming(false);
      }
    },
    [title, description, kitType, prompt, getPersonaPrompt, questions, answers, onCreditUsed, enhancedText]
  );

  // ── Configure → Enhance directly (skip questions) ──
  const handleEnhanceDirect = useCallback(() => {
    runStreamingEnhance(false);
  }, [runStreamingEnhance]);

  // ── Questions → Enhance with answers ──
  const handleEnhanceWithAnswers = useCallback(() => {
    runStreamingEnhance(true);
  }, [runStreamingEnhance]);

  // ── Apply result ──
  const handleApply = useCallback(() => {
    onApply(enhancedText);
    handleClose(false);
    toast.success("Description enhanced with AI");
  }, [enhancedText, onApply, handleClose]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className={
          phase === "result" ? "sm:max-w-3xl max-h-[85vh] overflow-y-auto" : "sm:max-w-xl"
        }
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-400" />
            Enhance with AI
          </DialogTitle>
          <DialogDescription>
            {phase === "configure" && "Configure how AI should enhance your description"}
            {phase === "questions" && "Answer these questions for a better result"}
            {phase === "result" && (streaming ? "Enhancing your description..." : "Review the enhanced description")}
          </DialogDescription>
        </DialogHeader>

        {/* ── Configure Phase ── */}
        {phase === "configure" && (
          <div className="space-y-4">
            {/* Persona selector */}
            {activeBots.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">AI Persona</label>
                <Select value={selectedBotId} onValueChange={setSelectedBotId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Default (Product Manager)</SelectItem>
                    {activeBots.map((bot) => (
                      <SelectItem key={bot.id} value={bot.id}>
                        {bot.full_name ?? "Unnamed"}{bot.role ? ` — ${bot.role}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Choose an agent persona to influence the tone and focus
                </p>
              </div>
            )}

            {/* Prompt */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Enhancement prompt</label>
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
                placeholder="What should AI focus on?"
              />
            </div>

            {/* Kit context indicator */}
            {kitType && (
              <div className="rounded-md border border-violet-500/20 bg-violet-500/[0.06] px-3 py-2 text-xs text-violet-400">
                Tailoring for <strong>{kitType}</strong> project type
              </div>
            )}

            {/* Ask questions checkbox */}
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={askQuestions}
                onChange={(e) => setAskQuestions(e.target.checked)}
                className="h-4 w-4 rounded border-border accent-violet-500"
              />
              <span className="text-sm">
                Ask clarifying questions first{" "}
                <span className="text-muted-foreground">(recommended)</span>
              </span>
            </label>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => handleClose(false)}>
                Cancel
              </Button>
              {askQuestions ? (
                <Button onClick={handleGenerateQuestions} disabled={loadingQuestions} className="bg-violet-600 text-white hover:bg-violet-700">
                  {loadingQuestions ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      Next
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>
              ) : (
                <Button onClick={handleEnhanceDirect} className="bg-violet-600 text-white hover:bg-violet-700">
                  <Sparkles className="mr-2 h-4 w-4" />
                  Enhance
                </Button>
              )}
            </div>
          </div>
        )}

        {/* ── Questions Phase ── */}
        {phase === "questions" && (
          <div className="space-y-4">
            {questions.map((q) => (
              <div key={q.id} className="space-y-1.5">
                <label className="text-sm font-medium">{q.question}</label>
                <Textarea
                  value={answers[q.id] ?? ""}
                  onChange={(e) =>
                    setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))
                  }
                  placeholder={q.placeholder ?? "Your answer..."}
                  rows={2}
                />
              </div>
            ))}

            <div className="flex justify-between gap-2 pt-2">
              <Button variant="ghost" onClick={() => setPhase("configure")}>
                <ChevronLeft className="mr-1 h-4 w-4" />
                Back
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => runStreamingEnhance(false)}>
                  Skip
                </Button>
                <Button onClick={handleEnhanceWithAnswers} className="bg-violet-600 text-white hover:bg-violet-700">
                  <Sparkles className="mr-2 h-4 w-4" />
                  Enhance with Answers
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ── Result Phase ── */}
        {phase === "result" && (
          <div className="space-y-4">
            <div className="max-h-[50vh] overflow-y-auto rounded-md border border-border bg-muted/20 p-4">
              {enhancedText ? (
                <div className="prose prose-sm prose-invert max-w-none whitespace-pre-wrap">
                  {enhancedText}
                  {streaming && (
                    <span className="inline-block w-0.5 h-4 bg-violet-400 animate-pulse ml-0.5 align-text-bottom" />
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generating enhanced description...
                </div>
              )}
            </div>

            <div className="flex justify-between gap-2 pt-2">
              <Button variant="ghost" onClick={handleReset} disabled={streaming}>
                Start Over
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => handleClose(false)} disabled={streaming}>
                  Cancel
                </Button>
                <Button onClick={handleApply} disabled={streaming || !enhancedText} className="bg-violet-600 text-white hover:bg-violet-700">
                  Apply Enhancement
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
