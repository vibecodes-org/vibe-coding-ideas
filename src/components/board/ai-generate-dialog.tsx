"use client";

import { useState, useRef, useCallback, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  Sparkles,
  AlertTriangle,
  Check,
  ArrowRight,
  CircleAlert,
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
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ImportPreviewTable } from "./import-preview-table";
import {
  autoMapColumns,
  getUniqueColumnNames,
  insertTasksSequentially,
} from "@/lib/import";
import type {
  ImportTask,
  ColumnMapping,
  SequentialInsertResult,
} from "@/lib/import";
import type {
  BoardColumnWithTasks,
  BoardLabel,
  User,
  BotProfile,
} from "@/types";
import { PromptTemplateSelector } from "@/components/ai/prompt-template-selector";
import { createClient } from "@/lib/supabase/client";

const DEFAULT_PROMPT =
  "Create a comprehensive task board for this idea. Break it into logical columns and tasks with labels, checklists, and due dates where appropriate. Focus on actionable, well-scoped tasks.";

const LOADING_TIMEOUT_MS = 15_000;

type DialogPhase =
  | "configure"
  | "preview"
  | "inserting"
  | "complete"
  | "loading-board";

interface TaskInsertStatus {
  title: string;
  status: "pending" | "creating" | "done" | "error";
  error?: string;
}

interface AiGenerateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ideaId: string;
  ideaDescription: string;
  currentUserId: string;
  columns: BoardColumnWithTasks[];
  boardLabels: BoardLabel[];
  teamMembers: User[];
  bots: BotProfile[];
}

export function AiGenerateDialog({
  open,
  onOpenChange,
  ideaId,
  ideaDescription,
  currentUserId,
  columns,
  boardLabels,
  teamMembers,
  bots,
}: AiGenerateDialogProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<DialogPhase>("configure");
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [selectedBotId, setSelectedBotId] = useState<string>("default");
  const [mode, setMode] = useState<"add" | "replace">("add");
  const [generatedTasks, setGeneratedTasks] = useState<ImportTask[] | null>(
    null
  );
  const [columnMapping, setColumnMapping] = useState<ColumnMapping>({});
  const [generating, setGenerating] = useState(false);

  // Inserting phase state
  const [taskStatuses, setTaskStatuses] = useState<TaskInsertStatus[]>([]);
  const [insertProgress, setInsertProgress] = useState({
    current: 0,
    total: 0,
  });
  const [insertResult, setInsertResult] =
    useState<SequentialInsertResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Loading board phase
  const [isRefreshing, startTransition] = useTransition();
  const loadingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const createdCountRef = useRef(0);

  const busy = generating || phase === "inserting" || phase === "loading-board";

  const activeBots = bots.filter((b) => b.is_active);

  // Auto-close when board refresh completes
  useEffect(() => {
    if (phase === "loading-board" && !isRefreshing) {
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
        loadingTimeoutRef.current = null;
      }
      toast.success(
        `Board ready — ${createdCountRef.current} task${createdCountRef.current !== 1 ? "s" : ""} created`
      );
      resetState();
      onOpenChange(false);
    }
  }, [phase, isRefreshing, onOpenChange]);

  function startLoadingBoard(createdCount: number) {
    createdCountRef.current = createdCount;
    setPhase("loading-board");
    startTransition(() => {
      router.refresh();
    });
    // Safety timeout — close after 15s even if refresh hasn't settled
    loadingTimeoutRef.current = setTimeout(() => {
      loadingTimeoutRef.current = null;
      toast.info("Board is still loading — tasks will appear shortly.");
      resetState();
      onOpenChange(false);
    }, LOADING_TIMEOUT_MS);
  }

  async function handleGenerate() {
    setGenerating(true);
    setGeneratedTasks([]);
    setPhase("preview");
    try {
      const personaPrompt =
        selectedBotId !== "default"
          ? activeBots.find((b) => b.id === selectedBotId)?.system_prompt
          : null;

      const res = await fetch("/api/ai/generate-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ideaId, prompt, personaPrompt }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let buffer = "";
      let lastParsed: { tasks: ImportTask[] } | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete NDJSON lines
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            lastParsed = JSON.parse(line);
            const streamedTasks = (lastParsed!.tasks ?? []).slice(0, 50) as ImportTask[];
            setGeneratedTasks(streamedTasks);
          } catch {
            // Incomplete JSON line — skip
          }
        }
      }

      // Process any remaining buffer
      if (buffer.trim()) {
        try {
          lastParsed = JSON.parse(buffer);
        } catch {
          // Ignore
        }
      }

      if (!lastParsed?.tasks?.length) {
        throw new Error("AI did not generate any tasks. Try a more detailed prompt.");
      }

      // Final update with all tasks (capped at 50)
      const tasks = lastParsed.tasks.slice(0, 50) as ImportTask[];
      setGeneratedTasks(tasks);

      const uniqueColumns = getUniqueColumnNames(tasks);
      setColumnMapping(autoMapColumns(uniqueColumns, columns));
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to generate tasks"
      );
      // Go back to configure if nothing was generated
      setPhase("configure");
      setGeneratedTasks(null);
    } finally {
      setGenerating(false);
    }
  }

  const handleApply = useCallback(
    async (tasksToInsert?: ImportTask[]) => {
      const tasks = tasksToInsert ?? generatedTasks;
      if (!tasks || tasks.length === 0) return;

      // Initialize statuses
      const statuses: TaskInsertStatus[] = tasks.map((t) => ({
        title: t.title,
        status: "pending",
      }));
      setTaskStatuses(statuses);
      setInsertProgress({ current: 0, total: tasks.length });
      setInsertResult(null);
      setPhase("inserting");

      // Delete existing tasks in replace mode
      if (mode === "replace") {
        const supabase = createClient();
        const allTaskIds = columns.flatMap((c) => c.tasks.map((t) => t.id));
        if (allTaskIds.length > 0) {
          const { error } = await supabase
            .from("board_tasks")
            .delete()
            .in("id", allTaskIds);
          if (error) {
            toast.error(`Failed to clear board: ${error.message}`);
            setPhase("preview");
            return;
          }
        }
      }

      const defaultColumnId = columns[0]?.id ?? "";
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const result = await insertTasksSequentially(
          tasks,
          ideaId,
          currentUserId,
          columns,
          { ...columnMapping },
          defaultColumnId,
          boardLabels,
          teamMembers,
          {
            onTaskCreated: (index, _title) => {
              setTaskStatuses((prev) => {
                const next = [...prev];
                next[index] = { ...next[index], status: "done" };
                if (index + 1 < next.length) {
                  next[index + 1] = {
                    ...next[index + 1],
                    status: "creating",
                  };
                }
                return next;
              });
              setInsertProgress((prev) => ({
                ...prev,
                current: prev.current + 1,
              }));
            },
            onTaskError: (index, _title, error) => {
              setTaskStatuses((prev) => {
                const next = [...prev];
                next[index] = { ...next[index], status: "error", error };
                if (index + 1 < next.length) {
                  next[index + 1] = {
                    ...next[index + 1],
                    status: "creating",
                  };
                }
                return next;
              });
              setInsertProgress((prev) => ({
                ...prev,
                current: prev.current + 1,
              }));
            },
            onSetupComplete: (stats) => {
              if (statuses.length > 0) {
                setTaskStatuses((prev) => {
                  const next = [...prev];
                  next[0] = { ...next[0], status: "creating" };
                  return next;
                });
              }
              if (stats.columns > 0 || stats.labels > 0) {
                const parts: string[] = [];
                if (stats.columns > 0)
                  parts.push(
                    `${stats.columns} column${stats.columns > 1 ? "s" : ""}`
                  );
                if (stats.labels > 0)
                  parts.push(
                    `${stats.labels} label${stats.labels > 1 ? "s" : ""}`
                  );
                toast.info(`Created ${parts.join(" and ")}`);
              }
            },
          },
          controller.signal
        );

        setInsertResult(result);

        // Auto-transition to loading board if no failures
        if (result.failed.length === 0) {
          startLoadingBoard(result.created);
        } else {
          setPhase("complete");
        }
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to insert tasks"
        );
        setPhase("preview");
      } finally {
        abortRef.current = null;
      }
    },
    [
      generatedTasks,
      mode,
      columns,
      columnMapping,
      ideaId,
      currentUserId,
      boardLabels,
      teamMembers,
    ]
  );

  function handleCancel() {
    abortRef.current?.abort();
  }

  function handleRetryFailed() {
    if (!generatedTasks || !insertResult) return;
    const failedIndices = new Set(insertResult.failed.map((f) => f.index));
    const failedTasks = generatedTasks.filter((_, i) => failedIndices.has(i));
    if (failedTasks.length > 0) {
      setMode("add");
      handleApply(failedTasks);
    }
  }

  function resetState() {
    setPhase("configure");
    setGeneratedTasks(null);
    setColumnMapping({});
    setPrompt(DEFAULT_PROMPT);
    setSelectedBotId("default");
    setMode("add");
    setTaskStatuses([]);
    setInsertProgress({ current: 0, total: 0 });
    setInsertResult(null);
    if (loadingTimeoutRef.current) {
      clearTimeout(loadingTimeoutRef.current);
      loadingTimeoutRef.current = null;
    }
  }

  function handleOpenChange(value: boolean) {
    if (busy) return;
    if (!value) resetState();
    onOpenChange(value);
  }

  const progressPercent =
    insertProgress.total > 0
      ? Math.round((insertProgress.current / insertProgress.total) * 100)
      : 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
        onInteractOutside={(e) => busy && e.preventDefault()}
        onEscapeKeyDown={(e) => busy && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            AI Generate Board
          </DialogTitle>
          <DialogDescription>
            {phase === "inserting"
              ? "Creating tasks on the board..."
              : phase === "loading-board"
                ? "Preparing your board view..."
                : phase === "complete"
                  ? "Task generation complete."
                  : "AI will create tasks, columns, and labels based on the idea description."}
          </DialogDescription>
        </DialogHeader>

        {/* ── Configure Phase ─────────────────────────────────── */}
        {phase === "configure" && (
          <div className="space-y-4">
            {activeBots.length > 0 && (
              <div className="space-y-2">
                <Label>AI Persona</Label>
                <Select value={selectedBotId} onValueChange={setSelectedBotId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select persona" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">
                      Default (Project Manager)
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

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Prompt</Label>
                <PromptTemplateSelector
                  type="generate"
                  currentPrompt={prompt}
                  onSelectTemplate={setPrompt}
                  disabled={busy}
                />
              </div>
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={4}
                placeholder="Tell the AI how to structure the task board..."
              />
            </div>

            <div className="space-y-2">
              <Label>Mode</Label>
              <RadioGroup
                value={mode}
                onValueChange={(v) => setMode(v as "add" | "replace")}
                className="flex gap-4"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="add" id="mode-add" />
                  <Label htmlFor="mode-add" className="font-normal">
                    Add to existing board
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="replace" id="mode-replace" />
                  <Label
                    htmlFor="mode-replace"
                    className="font-normal text-destructive"
                  >
                    Replace existing board
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {mode === "replace" && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  This will delete all existing tasks on the board before
                  applying AI-generated tasks.
                </span>
              </div>
            )}

            {ideaDescription && (
              <div className="space-y-2">
                <Label className="text-muted-foreground">Idea Context</Label>
                <p className="line-clamp-3 rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                  {ideaDescription.substring(0, 300)}
                  {ideaDescription.length > 300 ? "..." : ""}
                </p>
              </div>
            )}

            <Button
              onClick={handleGenerate}
              disabled={!prompt.trim()}
              className="w-full gap-2"
            >
              <Sparkles className="h-4 w-4" />
              Generate
            </Button>
          </div>
        )}

        {/* ── Preview Phase ──────────────────────────────────── */}
        {phase === "preview" && generatedTasks && (
          <div className="space-y-4">
            <ImportPreviewTable
              tasks={generatedTasks}
              columns={columns}
              columnMapping={columnMapping}
              defaultColumnId={columns[0]?.id ?? ""}
              streaming={generating}
            />

            <div className="flex gap-2">
              <Button
                onClick={() => handleApply()}
                disabled={busy || generatedTasks.length === 0}
                className="flex-1 gap-2"
              >
                {generating
                  ? "Generating..."
                  : `Apply All (${generatedTasks.length} tasks)`}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setPhase("configure");
                  handleGenerate();
                }}
                disabled={busy}
                className="gap-2"
              >
                Regenerate
              </Button>
              <Button
                variant="ghost"
                onClick={() => handleOpenChange(false)}
                disabled={busy}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* ── Inserting Phase ────────────────────────────────── */}
        {phase === "inserting" && (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium" aria-live="polite">
                  Creating task {insertProgress.current} of{" "}
                  {insertProgress.total}...
                </span>
                <span className="text-muted-foreground">
                  {progressPercent}%
                </span>
              </div>
              <Progress
                value={progressPercent}
                className="h-2"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progressPercent}
              />
            </div>

            <div className="h-[240px] overflow-y-auto rounded-md border p-3">
              <div className="space-y-1.5">
                {taskStatuses.map((task, i) => (
                  <div
                    key={i}
                    ref={
                      task.status === "creating"
                        ? (el) =>
                            el?.scrollIntoView({
                              behavior: "smooth",
                              block: "nearest",
                            })
                        : undefined
                    }
                    className={`flex items-center gap-2 text-sm ${
                      task.status === "pending"
                        ? "text-muted-foreground"
                        : task.status === "error"
                          ? "text-destructive"
                          : ""
                    }`}
                  >
                    {task.status === "done" && (
                      <Check className="h-3.5 w-3.5 shrink-0 text-green-500" />
                    )}
                    {task.status === "creating" && (
                      <ArrowRight className="h-3.5 w-3.5 shrink-0 animate-pulse text-primary" />
                    )}
                    {task.status === "error" && (
                      <CircleAlert className="h-3.5 w-3.5 shrink-0" />
                    )}
                    {task.status === "pending" && (
                      <span className="inline-block h-3.5 w-3.5 shrink-0" />
                    )}
                    <span
                      className={
                        task.status === "creating" ? "font-medium" : ""
                      }
                    >
                      {task.title}
                      {task.status === "creating" && "..."}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <p className="text-center text-xs text-muted-foreground">
              Tasks appear on the board as they&apos;re created.
            </p>

            <Button
              variant="outline"
              onClick={handleCancel}
              className="w-full"
            >
              Cancel
            </Button>
          </div>
        )}

        {/* ── Loading Board Phase ────────────────────────────── */}
        {phase === "loading-board" && (
          <div className="space-y-4 py-8">
            <div className="text-center">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
              <p
                className="mt-3 text-sm font-medium"
                role="status"
                aria-live="polite"
              >
                Preparing your board view...
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {createdCountRef.current} task
                {createdCountRef.current !== 1 ? "s" : ""} created. Loading
                board data.
              </p>
            </div>
          </div>
        )}

        {/* ── Complete Phase (only shown when there are failures) ── */}
        {phase === "complete" && insertResult && (
          <div className="space-y-4">
            <div className="space-y-3">
              <div className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <div>
                  <p className="font-medium">
                    Created {insertResult.created} of{" "}
                    {insertResult.created + insertResult.failed.length} tasks
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    {insertResult.failed.length} task
                    {insertResult.failed.length !== 1 ? "s" : ""} failed to
                    create:
                  </p>
                </div>
              </div>

              <ScrollArea className="max-h-[120px]">
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {insertResult.failed.map((f, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                      <span>
                        &ldquo;{f.title}&rdquo;{" "}
                        <span className="text-xs">— {f.error}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handleRetryFailed}
                className="flex-1"
              >
                Retry Failed ({insertResult.failed.length})
              </Button>
              <Button
                onClick={() =>
                  startLoadingBoard(insertResult?.created ?? 0)
                }
                className="flex-1"
              >
                Done
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
