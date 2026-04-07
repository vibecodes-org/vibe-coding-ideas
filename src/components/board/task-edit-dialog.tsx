"use client";

import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { X, Image as ImageIcon, Sparkles, Loader2, Eye, Pencil, Tag } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { AssigneeSelect } from "./assignee-select";
import { Markdown } from "@/components/ui/markdown";
import { getLabelColorConfig } from "@/lib/utils";
import { createBoardTask, addLabelsToTask } from "@/actions/board";
import { useBoardOps } from "./board-context";
import { createClient } from "@/lib/supabase/client";
import { logger } from "@/lib/logger";
import { logTaskActivity } from "@/lib/activity";
import { enhanceTaskDescription } from "@/actions/ai";
import { POSITION_GAP } from "@/lib/constants";
import type { User, BoardLabel, BoardTaskWithAssignee } from "@/types";

interface TaskEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ideaId: string;
  columnId: string;
  teamMembers: User[];
  boardLabels: BoardLabel[];
  currentUserId: string;
  ideaAgents?: User[];
  canUseAi?: boolean;
  hasByokKey?: boolean;
  starterCredits?: number;
  ideaDescription?: string;
}

export function TaskEditDialog({
  open,
  onOpenChange,
  ideaId,
  columnId,
  teamMembers,
  boardLabels,
  currentUserId,
  ideaAgents = [],
  canUseAi = false,
  hasByokKey = false,
  starterCredits = 0,
  ideaDescription = "",
}: TaskEditDialogProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [selectedLabelIds, setSelectedLabelIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [pendingImages, setPendingImages] = useState<{ file: File; previewUrl: string }[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [previewDesc, setPreviewDesc] = useState(false);
  const dragCounterRef = useRef(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const ops = useBoardOps();

  const showAiEnhance = canUseAi && description.trim().length > 10;

  async function handleEnhanceDescription() {
    if (!title.trim() || !description.trim()) return;
    setEnhancing(true);
    try {
      const result = await enhanceTaskDescription(ideaId, title.trim(), description.trim());
      setDescription(result.enhanced);
      toast.success("Description enhanced");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to enhance");
    } finally {
      setEnhancing(false);
    }
  }

  // Scoped paste handler — only active when this dialog is open
  useEffect(() => {
    if (!open) return;

    function handlePaste(e: ClipboardEvent) {
      // Only handle if the paste target is within our dialog
      const dialog = dialogRef.current;
      if (!dialog || !dialog.contains(e.target as Node)) return;

      const items = e.clipboardData?.items;
      if (!items) return;

      const imageFiles: File[] = [];
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }

      if (imageFiles.length > 0) {
        e.preventDefault();
        addImages(imageFiles);
      }
    }

    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [open]);

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes("Files")) {
      setIsDragging(true);
    }
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounterRef.current = 0;

    const files = e.dataTransfer.files;
    if (!files?.length) return;

    const imageFiles: File[] = [];
    for (const file of files) {
      if (file.type.startsWith("image/")) {
        imageFiles.push(file);
      }
    }

    if (imageFiles.length > 0) {
      addImages(imageFiles);
    }
  }

  function addImages(files: File[]) {
    const entries = files.map((file) => ({
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    setPendingImages((prev) => [...prev, ...entries]);
  }

  function removeImage(index: number) {
    setPendingImages((prev) => {
      const removed = prev[index];
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  }

  function resetState() {
    // Revoke all preview URLs
    pendingImages.forEach((entry) => URL.revokeObjectURL(entry.previewUrl));
    setTitle("");
    setDescription("");
    setAssigneeId("");
    setSelectedLabelIds(new Set());
    setPendingImages([]);
    setIsDragging(false);
    dragCounterRef.current = 0;
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      resetState();
    }
    onOpenChange(nextOpen);
  }

  function toggleLabel(labelId: string) {
    setSelectedLabelIds((prev) => {
      const next = new Set(prev);
      if (next.has(labelId)) {
        next.delete(labelId);
      } else {
        next.add(labelId);
      }
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    // Build optimistic task
    const tempId = `temp-${crypto.randomUUID()}`;
    const assignee = assigneeId
      ? [...teamMembers, ...ideaAgents].find((m) => m.id === assigneeId) ?? null
      : null;
    const selectedLabels = boardLabels.filter((l) => selectedLabelIds.has(l.id));
    const tempTask: BoardTaskWithAssignee = {
      id: tempId,
      idea_id: ideaId,
      column_id: columnId,
      title: title.trim(),
      description: description.trim() || null,
      assignee_id: assigneeId || null,
      assignee,
      labels: selectedLabels,
      position: Date.now(), // high value to sort at end
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      due_date: null,
      archived: false,
      workflow_step_total: 0,
      workflow_step_completed: 0,
      workflow_step_in_progress: 0,
      workflow_step_failed: 0,
      workflow_step_awaiting_approval: 0,
      workflow_step_started_at: null,
      workflow_active_step_title: null,
      workflow_active_agent_name: null,
      attachment_count: 0,
      cover_image_path: null,
      comment_count: 0,
      discussion_id: null,
      working_started_at: null,
    };

    // Optimistically insert & close immediately
    const rollback = ops.createTask(columnId, tempTask);
    ops.incrementPendingOps();
    const filesToUpload = pendingImages.map((entry) => entry.file);
    handleOpenChange(false);

    // Background: server call
    try {
      const taskId = await createBoardTask(
        ideaId,
        columnId,
        title.trim(),
        description.trim() || undefined,
        assigneeId || undefined
      );
      if (selectedLabelIds.size > 0) {
        await addLabelsToTask(taskId, Array.from(selectedLabelIds), ideaId);
      }
      logTaskActivity(taskId, ideaId, currentUserId, "created");

      if (filesToUpload.length > 0) {
        await uploadImages(taskId, filesToUpload);
      }
    } catch {
      rollback();
      toast.error("Failed to create task");
    } finally {
      ops.decrementPendingOps();
    }
  }

  async function uploadImages(taskId: string, images: File[]) {
    const supabase = createClient();
    let isFirstImage = true;

    for (const file of images) {
      if (file.size > 10 * 1024 * 1024) {
        toast.error(`${file.name} exceeds 10MB limit`);
        continue;
      }

      try {
        const ext = file.name.split(".").pop() ?? "png";
        const uniqueName = `${crypto.randomUUID()}.${ext}`;
        const storagePath = `${ideaId}/${taskId}/${uniqueName}`;

        const { error: uploadError } = await supabase.storage
          .from("task-attachments")
          .upload(storagePath, file);

        if (uploadError) {
          logger.error("Upload failed", { error: uploadError.message });
          toast.error(`Failed to upload ${file.name}`);
          continue;
        }

        const { error: dbError } = await supabase
          .from("board_task_attachments")
          .insert({
            task_id: taskId,
            idea_id: ideaId,
            uploaded_by: currentUserId,
            file_name: file.name || `pasted-image.${ext}`,
            file_size: file.size,
            content_type: file.type,
            storage_path: storagePath,
          });

        if (!dbError) {
          logTaskActivity(taskId, ideaId, currentUserId, "attachment_added", {
            file_name: file.name || `pasted-image.${ext}`,
          });

          if (isFirstImage) {
            await supabase
              .from("board_tasks")
              .update({ cover_image_path: storagePath })
              .eq("id", taskId);
            isFirstImage = false;
          }
        }
      } catch {
        toast.error(`Failed to upload ${file.name}`);
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        ref={dialogRef}
        className={`sm:max-w-md max-h-[85vh] overflow-y-auto ${isDragging ? "ring-2 ring-primary ring-offset-2" : ""}`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <DialogHeader>
          <DialogTitle>New Task</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="task-title">Title</Label>
            <Input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Task title"
              required
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="task-description">Description</Label>
              <div className="flex items-center gap-1">
                {showAiEnhance && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 rounded-full bg-violet-500/[0.06] px-3 text-xs text-violet-400 hover:bg-violet-500/[0.12]"
                    onClick={handleEnhanceDescription}
                    disabled={enhancing}
                    title={hasByokKey ? "Enhance with AI — using your API key" : `Enhance with AI — ${starterCredits} free credit${starterCredits !== 1 ? "s" : ""} remaining`}
                  >
                    {enhancing ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Sparkles className="h-3 w-3" />
                    )}
                    {enhancing ? "Enhancing..." : "Enhance"}
                  </Button>
                )}
                {description.trim() && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 px-2 text-xs text-muted-foreground"
                    onClick={() => setPreviewDesc((v) => !v)}
                  >
                    {previewDesc ? (
                      <><Pencil className="h-3 w-3" /> Write</>
                    ) : (
                      <><Eye className="h-3 w-3" /> Preview</>
                    )}
                  </Button>
                )}
              </div>
            </div>
            {previewDesc ? (
              <div className="min-h-[78px] max-h-[40vh] overflow-y-auto rounded-md border border-input px-3 py-2 text-sm">
                <Markdown>{description}</Markdown>
              </div>
            ) : (
              <Textarea
                id="task-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description... (supports markdown)"
                className="max-h-[40vh]"
                rows={3}
              />
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="task-assignee">Assignee</Label>
            <AssigneeSelect
              value={assigneeId}
              onValueChange={setAssigneeId}
              teamMembers={teamMembers}
              ideaAgents={ideaAgents}
            />
          </div>
          {boardLabels.length > 0 && (
            <div className="space-y-2">
              <Label>Labels</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 w-full justify-start gap-2 text-xs font-normal">
                    <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                    {selectedLabelIds.size > 0 ? (
                      <span className="flex flex-1 flex-wrap gap-1">
                        {boardLabels
                          .filter((l) => selectedLabelIds.has(l.id))
                          .map((l) => {
                            const config = getLabelColorConfig(l.color);
                            return (
                              <span key={l.id} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${config.badgeClass}`}>
                                <span className={`h-1.5 w-1.5 rounded-full ${config.swatchColor}`} />
                                {l.name}
                              </span>
                            );
                          })}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Select labels…</span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[220px] p-2" align="start">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">Labels</p>
                  <div className="max-h-[200px] space-y-1 overflow-y-auto">
                    {boardLabels.map((label) => {
                      const config = getLabelColorConfig(label.color);
                      return (
                        <div
                          key={label.id}
                          className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 hover:bg-muted/50"
                          onClick={() => toggleLabel(label.id)}
                        >
                          <Checkbox checked={selectedLabelIds.has(label.id)} onCheckedChange={() => toggleLabel(label.id)} />
                          <span className={`h-3 w-3 shrink-0 rounded-sm ${config.swatchColor}`} />
                          <span className="text-xs font-medium">{label.name}</span>
                        </div>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          )}

          {/* Pending image previews */}
          {pendingImages.length > 0 && (
            <div className="space-y-2">
              <Label>Images ({pendingImages.length})</Label>
              <div className="flex flex-wrap gap-2">
                {pendingImages.map(({ file, previewUrl }, index) => (
                  <div
                    key={`${file.name}-${file.size}-${index}`}
                    className="group relative h-16 w-16 shrink-0 overflow-hidden rounded-md border border-border"
                  >
                    <img
                      src={previewUrl}
                      alt={file.name}
                      className="h-full w-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removeImage(index)}
                      className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-sm transition-opacity"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Drop zone hint */}
          {isDragging && (
            <div className="flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-primary bg-primary/5 p-4">
              <ImageIcon className="h-4 w-4 text-primary" />
              <p className="text-sm text-primary">Drop images here</p>
            </div>
          )}

          {/* Paste hint when no images yet */}
          {pendingImages.length === 0 && !isDragging && (
            <p className="text-[10px] text-muted-foreground">
              Paste or drop images to attach them
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !title.trim()}>
              {loading ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
