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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Bot, X, Image as ImageIcon, Sparkles, Loader2, Eye, Pencil } from "lucide-react";
import { Markdown } from "@/components/ui/markdown";
import { getLabelColorConfig } from "@/lib/utils";
import { createBoardTask, addLabelsToTask } from "@/actions/board";
import { useBoardOps } from "./board-context";
import { createClient } from "@/lib/supabase/client";
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
  hasApiKey?: boolean;
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
  hasApiKey = false,
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

  const showAiEnhance = hasApiKey && description.trim().length > 10;

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
      checklist_total: 0,
      checklist_done: 0,
      attachment_count: 0,
      cover_image_path: null,
      comment_count: 0,
      discussion_id: null,
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
          console.error("Upload failed:", uploadError.message);
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
        className={`sm:max-w-md ${isDragging ? "ring-2 ring-primary ring-offset-2" : ""}`}
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
                    className="h-6 gap-1 px-2 text-xs text-muted-foreground"
                    onClick={handleEnhanceDescription}
                    disabled={enhancing}
                    title="Enhance with AI"
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
              <div className="min-h-[78px] rounded-md border border-input px-3 py-2 text-sm">
                <Markdown>{description}</Markdown>
              </div>
            ) : (
              <Textarea
                id="task-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description... (supports markdown)"
                rows={3}
              />
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="task-assignee">Assignee</Label>
            <Select value={assigneeId} onValueChange={setAssigneeId}>
              <SelectTrigger>
                <SelectValue placeholder="Unassigned" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {teamMembers.length > 0 && (
                  <div className="px-2 py-1.5 text-[10px] font-medium text-muted-foreground">
                    Collaborators
                  </div>
                )}
                {teamMembers.map((member) => (
                  <SelectItem key={member.id} value={member.id}>
                    {member.full_name ?? member.email}
                  </SelectItem>
                ))}
                {ideaAgents.filter((b) => !teamMembers.some((m) => m.id === b.id)).length > 0 && (
                  <>
                    <div className="px-2 py-1.5 text-[10px] font-medium text-muted-foreground">
                      Agents
                    </div>
                    {ideaAgents
                      .filter((b) => !teamMembers.some((m) => m.id === b.id))
                      .map((bot) => (
                        <SelectItem key={bot.id} value={bot.id}>
                          <span className="inline-flex items-center gap-1">
                            <Bot className="h-3 w-3" />
                            {bot.full_name ?? bot.email}
                          </span>
                        </SelectItem>
                      ))}
                  </>
                )}
              </SelectContent>
            </Select>
          </div>
          {boardLabels.length > 0 && (
            <div className="space-y-2">
              <Label>Labels</Label>
              <div className="max-h-[120px] flex flex-wrap gap-2 overflow-y-auto">
                {boardLabels.map((label) => {
                  const config = getLabelColorConfig(label.color);
                  const isSelected = selectedLabelIds.has(label.id);
                  return (
                    <button
                      key={label.id}
                      type="button"
                      onClick={() => toggleLabel(label.id)}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                        isSelected
                          ? `${config.badgeClass} border-transparent`
                          : "border-border text-muted-foreground hover:border-foreground/30"
                      }`}
                    >
                      <span className={`h-2 w-2 rounded-full ${config.swatchColor}`} />
                      {label.name}
                    </button>
                  );
                })}
              </div>
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
