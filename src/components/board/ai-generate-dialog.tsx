"use client";

import { useState, useRef, useCallback, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  Sparkles,
  AlertTriangle,
  Check,
  ArrowRight,
  Circle,
  CircleAlert,
  RotateCcw,
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
  SelectGroup,
  SelectItem,
  SelectLabel,
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
  "Create a comprehensive task board for this idea. Break it into logical columns and tasks with labels, workflow steps, and due dates where appropriate. Focus on actionable, well-scoped tasks.";

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
  userBotProfiles?: BotProfile[];
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
  userBotProfiles = [],
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
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());

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

  // User's own active bots (already filtered to is_active at query level)
  const myAgents = userBotProfiles;
  const myAgentIds = new Set(myAgents.map((b) => b.id));
  // Pool bots not owned by current user (deduplicates bots that are in both lists)
  const ideaAgentBots = bots.filter((b) => b.is_active && !myAgentIds.has(b.id));
  const allBots = [...myAgents, ...ideaAgentBots];

  // When generation completes, select all tasks
  useEffect(() => {
    if (!generating && generatedTasks && generatedTasks.length > 0 && phase === "preview") {
      setSelectedIndices(new Set(generatedTasks.map((_, i) => i)));
    }
  }, [generating, generatedTasks, phase]);

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
    setSelectedIndices(new Set());
    setPhase("preview");
    try {
      const selectedBot =
        selectedBotId !== "default"
          ? allBots.find((b) => b.id === selectedBotId)
          : null;

      const res = await fetch("/api/ai/generate-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ideaId,
          prompt,
          personaPrompt: selectedBot?.system_prompt ?? null,
          agentRole: selectedBot?.role ?? null,
          agentSkills: selectedBot?.skills ?? null,
          agentBio: selectedBot?.bio ?? null,
        }),
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

  function handleApplySelected() {
    if (!generatedTasks) return;
    const filtered = generatedTasks.filter((_, i) => selectedIndices.has(i));
    handleApply(filtered);
  }

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
    setSelectedIndices(new Set());
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

  const isWidePhase = phase === "preview" || phase === "inserting";

  const phaseDescriptions: Record<DialogPhase, string> = {
    configure: "AI will create tasks, columns, and labels based on the idea description.",
    preview: generating ? "AI is generating tasks..." : "Review generated tasks and select which to apply.",
    inserting: "Creating tasks on the board...",
    "loading-board": "Preparing your board view...",
    complete: "Task generation complete.",
  };

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
            AI Generate Board
          </DialogTitle>
          <DialogDescription>{phaseDescriptions[phase]}</DialogDescription>
        </DialogHeader>

        {/* ── Scrollable Body ─────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {/* ── Configure Phase ─────────────────────────────────── */}
          {phase === "configure" && (
            <div className="space-y-4">
              {allBots.length > 0 && (
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
                      {myAgents.length > 0 && (
                        <SelectGroup>
                          <SelectLabel>My Agents</SelectLabel>
                          {myAgents.map((bot) => (
                            <SelectItem key={bot.id} value={bot.id}>
                              {bot.name}
                              {bot.role ? ` (${bot.role})` : ""}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      )}
                      {ideaAgentBots.length > 0 && (
                        <SelectGroup>
                          <SelectLabel>Idea Agents</SelectLabel>
                          {ideaAgentBots.map((bot) => (
                            <SelectItem key={bot.id} value={bot.id}>
                              {bot.name}
                              {bot.role ? ` (${bot.role})` : ""}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      )}
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
            </div>
          )}

          {/* ── Preview Phase ──────────────────────────────────── */}
          {phase === "preview" && generatedTasks && (
            <ImportPreviewTable
              tasks={generatedTasks}
              columns={columns}
              columnMapping={columnMapping}
              defaultColumnId={columns[0]?.id ?? ""}
              streaming={generating}
              boardLabels={boardLabels}
              selectedIndices={generating ? undefined : selectedIndices}
              onSelectionChange={generating ? undefined : setSelectedIndices}
            />
          )}

          {/* ── Inserting Phase ────────────────────────────────── */}
          {phase === "inserting" && (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground" aria-live="polite">
                    Creating task{" "}
                    <span className="font-semibold text-foreground">
                      {insertProgress.current}
                    </span>{" "}
                    of{" "}
                    <span className="font-semibold text-foreground">
                      {insertProgress.total}
                    </span>
                    ...
                  </span>
                  <span className="font-semibold text-violet-400">
                    {progressPercent}%
                  </span>
                </div>
                <Progress
                  value={progressPercent}
                  className="h-1.5 [&>div]:bg-gradient-to-r [&>div]:from-violet-600 [&>div]:to-violet-400"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progressPercent}
                />
              </div>

              <div className="max-h-[400px] overflow-y-auto rounded-lg border">
                <div className="divide-y divide-border">
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
                      className={`flex items-center gap-2.5 px-3.5 py-2 text-sm ${
                        task.status === "pending"
                          ? "opacity-35"
                          : task.status === "creating"
                            ? "bg-violet-500/10"
                            : task.status === "error"
                              ? "text-destructive"
                              : "text-muted-foreground"
                      }`}
                    >
                      {task.status === "done" && (
                        <Check className="h-4 w-4 shrink-0 text-green-400" />
                      )}
                      {task.status === "creating" && (
                        <ArrowRight className="h-4 w-4 shrink-0 animate-pulse text-violet-400" />
                      )}
                      {task.status === "error" && (
                        <CircleAlert className="h-4 w-4 shrink-0" />
                      )}
                      {task.status === "pending" && (
                        <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <span
                        className={`min-w-0 truncate ${
                          task.status === "creating"
                            ? "font-semibold text-foreground"
                            : ""
                        }`}
                      >
                        {task.title}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
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
            </div>
          )}
        </div>

        {/* ── Sticky Footer ───────────────────────────────────────── */}
        {/* Configure phase footer */}
        {phase === "configure" && (
          <div className="shrink-0 border-t border-border bg-background px-4 py-3 sm:px-6">
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

        {/* Preview phase footer */}
        {phase === "preview" && generatedTasks && (
          <div className="shrink-0 border-t border-border bg-background px-4 py-3 sm:px-6">
            {generating ? (
              <div className="flex items-center gap-3">
                <div className="enhance-dot-indicator flex gap-[3px]">
                  <span />
                  <span />
                  <span />
                </div>
                <span className="text-[13px] text-muted-foreground">
                  Generating tasks...
                </span>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setPhase("configure");
                      handleGenerate();
                    }}
                    className="gap-1.5"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Regenerate
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleOpenChange(false)}
                  >
                    Cancel
                  </Button>
                </div>
                <Button
                  onClick={handleApplySelected}
                  disabled={selectedIndices.size === 0}
                  className="gap-2"
                >
                  <Sparkles className="h-4 w-4" />
                  Apply {selectedIndices.size} Task{selectedIndices.size !== 1 ? "s" : ""}
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Inserting phase footer */}
        {phase === "inserting" && (
          <div className="shrink-0 border-t border-border bg-background px-4 py-3 sm:px-6">
            <Button
              variant="outline"
              onClick={handleCancel}
              className="w-full"
            >
              Cancel
            </Button>
          </div>
        )}

        {/* Complete phase footer */}
        {phase === "complete" && insertResult && (
          <div className="shrink-0 border-t border-border bg-background px-4 py-3 sm:px-6">
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
