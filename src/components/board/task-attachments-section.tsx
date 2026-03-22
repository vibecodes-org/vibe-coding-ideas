"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Paperclip,
  Trash2,
  Upload,
  FileText,
  Image as ImageIcon,
  Download,
  X,
  ImagePlus,
  ImageOff,
  Camera,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { createClient } from "@/lib/supabase/client";
import { logger } from "@/lib/logger";
import { formatRelativeTime } from "@/lib/utils";
import { logTaskActivity } from "@/lib/activity";
import type { BoardTaskAttachment } from "@/types";

interface TaskAttachmentsSectionProps {
  taskId: string;
  ideaId: string;
  currentUserId: string;
  coverImagePath?: string | null;
  onCoverChange?: (path: string | null) => void;
  isReadOnly?: boolean;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function isImageType(contentType: string): boolean {
  return contentType.startsWith("image/");
}

export function TaskAttachmentsSection({
  taskId,
  ideaId,
  currentUserId,
  coverImagePath: initialCoverPath,
  onCoverChange,
  isReadOnly = false,
}: TaskAttachmentsSectionProps) {
  const [attachments, setAttachments] = useState<BoardTaskAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState<{ id: string; name: string; size: number }[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [localCoverPath, setLocalCoverPath] = useState<string | null>(initialCoverPath ?? null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

  // Sync from prop when task changes
  const [lastTaskId, setLastTaskId] = useState(taskId);
  if (taskId !== lastTaskId) {
    setLocalCoverPath(initialCoverPath ?? null);
    setLastTaskId(taskId);
  }

  const fetchAttachments = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("board_task_attachments")
      .select("*")
      .eq("task_id", taskId)
      .order("created_at", { ascending: false });

    setAttachments(data ?? []);
    setLoading(false);
  }, [taskId]);

  useEffect(() => {
    fetchAttachments();
  }, [fetchAttachments]);

  // Realtime
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`task-attachments-${taskId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "board_task_attachments",
          filter: `task_id=eq.${taskId}`,
        },
        async (payload) => {
          const { data } = await supabase.from("board_task_attachments").select("*").eq("id", payload.new.id).single();

          if (data) {
            setAttachments((prev) => {
              if (prev.some((a) => a.id === data.id)) return prev;
              return [data, ...prev];
            });
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "board_task_attachments",
          filter: `task_id=eq.${taskId}`,
        },
        (payload) => {
          setAttachments((prev) => prev.filter((a) => a.id !== payload.old.id));
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [taskId]);

  // Paste handler for images
  useEffect(() => {
    function handlePaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of items) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) uploadFile(file);
          break;
        }
      }
    }

    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, ideaId, currentUserId]);

  async function uploadFile(file: File) {
    if (file.size > 10 * 1024 * 1024) {
      alert("File size must be under 10MB");
      return;
    }

    const placeholderId = crypto.randomUUID();
    setUploadingFiles((prev) => [...prev, { id: placeholderId, name: file.name, size: file.size }]);
    setUploading(true);
    const supabase = createClient();

    const ext = file.name.split(".").pop() ?? "";
    const uniqueName = `${crypto.randomUUID()}.${ext}`;
    const storagePath = `${ideaId}/${taskId}/${uniqueName}`;

    const { error: uploadError } = await supabase.storage.from("task-attachments").upload(storagePath, file);

    if (uploadError) {
      logger.error("Upload failed", { error: uploadError.message, taskId, fileName: file.name });
      setUploadingFiles((prev) => prev.filter((f) => f.id !== placeholderId));
      setUploading(false);
      return;
    }

    const { error: dbError } = await supabase.from("board_task_attachments").insert({
      task_id: taskId,
      idea_id: ideaId,
      uploaded_by: currentUserId,
      file_name: file.name,
      file_size: file.size,
      content_type: file.type,
      storage_path: storagePath,
    });

    if (!dbError) {
      logTaskActivity(taskId, ideaId, currentUserId, "attachment_added", {
        file_name: file.name,
      });

      // Auto-set as cover if it's an image and no cover exists
      if (isImageType(file.type) && !localCoverPath) {
        await supabase.from("board_tasks").update({ cover_image_path: storagePath }).eq("id", taskId);
        updateCover(storagePath);
      }
    }
    setUploadingFiles((prev) => prev.filter((f) => f.id !== placeholderId));
    setUploading(false);
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files?.length || uploading) return;

    for (const file of files) {
      await uploadFile(file);
    }

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function handleDelete(attachment: BoardTaskAttachment) {
    const supabase = createClient();

    // If deleting the cover image, clear the cover
    if (attachment.storage_path === localCoverPath) {
      await supabase.from("board_tasks").update({ cover_image_path: null }).eq("id", taskId);
      updateCover(null);
    }

    // Delete from storage
    await supabase.storage.from("task-attachments").remove([attachment.storage_path]);

    // Delete from DB
    const { error } = await supabase.from("board_task_attachments").delete().eq("id", attachment.id);

    if (!error) {
      logTaskActivity(taskId, ideaId, currentUserId, "attachment_removed", {
        file_name: attachment.file_name,
      });
    }
  }

  function updateCover(path: string | null) {
    setLocalCoverPath(path);
    onCoverChange?.(path);
  }

  async function handleSetCover(storagePath: string) {
    updateCover(storagePath);
    const supabase = createClient();
    await supabase.from("board_tasks").update({ cover_image_path: storagePath }).eq("id", taskId);
  }

  async function handleRemoveCover() {
    updateCover(null);
    const supabase = createClient();
    await supabase.from("board_tasks").update({ cover_image_path: null }).eq("id", taskId);
  }

  async function handleDownload(attachment: BoardTaskAttachment) {
    const supabase = createClient();
    const { data } = await supabase.storage.from("task-attachments").createSignedUrl(attachment.storage_path, 60, {
      download: attachment.file_name,
    });

    if (data?.signedUrl) {
      window.open(data.signedUrl, "_blank");
    }
  }

  async function handlePreview(attachment: BoardTaskAttachment) {
    const supabase = createClient();
    const { data } = await supabase.storage.from("task-attachments").createSignedUrl(attachment.storage_path, 300);

    if (data?.signedUrl) {
      setPreviewUrl(data.signedUrl);
    }
  }

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

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounterRef.current = 0;

    const files = e.dataTransfer.files;
    if (!files?.length || uploading) return;

    for (const file of files) {
      await uploadFile(file);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Paperclip className="h-4 w-4" />
        <span className="text-sm font-medium">
          Attachments{attachments.length > 0 ? ` (${attachments.length})` : ""}
        </span>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading...</p>
      ) : attachments.length > 0 || uploadingFiles.length > 0 ? (
        <ScrollArea className="max-h-48">
          <div className="grid grid-cols-1 gap-2 pr-4 sm:grid-cols-2">
            {uploadingFiles.map((file) => (
              <div
                key={file.id}
                className="flex items-center gap-2 rounded-md border border-dashed border-primary/40 bg-primary/5 p-2"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-muted">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-medium">{file.name}</p>
                  <p className="text-[10px] text-muted-foreground">{formatFileSize(file.size)} &middot; Uploading...</p>
                </div>
              </div>
            ))}
            {attachments.map((attachment) => (
              <div
                key={attachment.id}
                className="group relative flex items-center gap-2 rounded-md border border-border p-2"
              >
                {isImageType(attachment.content_type) ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded bg-muted"
                        onClick={() => handlePreview(attachment)}
                      >
                        <ImageIcon className="h-4 w-4 text-muted-foreground" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Preview</TooltipContent>
                  </Tooltip>
                ) : (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-muted">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-medium">{attachment.file_name}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {formatFileSize(attachment.file_size)} &middot; {formatRelativeTime(attachment.created_at)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-0.5">
                  {!isReadOnly && isImageType(attachment.content_type) && (
                    attachment.storage_path === localCoverPath ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            className="cursor-pointer rounded p-1 text-primary hover:text-primary/80"
                            onClick={() => handleRemoveCover()}
                          >
                            <ImageOff className="h-3 w-3" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>Remove cover</TooltipContent>
                      </Tooltip>
                    ) : (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            className="cursor-pointer rounded p-1 text-muted-foreground hover:text-foreground"
                            onClick={() => handleSetCover(attachment.storage_path)}
                          >
                            <ImagePlus className="h-3 w-3" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>Set as cover</TooltipContent>
                      </Tooltip>
                    ))}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        className="cursor-pointer rounded p-1 text-muted-foreground hover:text-foreground"
                        onClick={() => handleDownload(attachment)}
                      >
                        <Download className="h-3 w-3" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Download</TooltipContent>
                  </Tooltip>
                  {!isReadOnly && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          className="cursor-pointer rounded p-1 text-muted-foreground hover:text-destructive"
                          onClick={() => handleDelete(attachment)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>Delete</TooltipContent>
                    </Tooltip>
                  )}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      ) : null}

      {/* Drop zone + upload buttons — hidden for read-only */}
      {!isReadOnly && (
        <div
          className={`relative rounded-lg border-2 border-dashed p-4 text-center transition-colors ${
            isDragging
              ? "border-primary bg-primary/5"
              : "border-border"
          }`}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          {isDragging ? (
            <p className="text-sm text-primary">Drop files here</p>
          ) : (
            <>
              <input
                ref={fileInputRef}
                id={`file-upload-${taskId}`}
                type="file"
                className="hidden"
                accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.zip,.md,.html"
                onChange={handleFileSelect}
                multiple
              />
              <input
                ref={cameraInputRef}
                id={`camera-upload-${taskId}`}
                type="file"
                className="hidden"
                accept="image/*"
                capture="environment"
                onChange={handleFileSelect}
              />
              <div className="flex flex-wrap items-center justify-center gap-2">
                <label htmlFor={uploading ? undefined : `file-upload-${taskId}`} className={uploading ? "pointer-events-none" : undefined}>
                  <Button
                    variant="outline"
                    size="sm"
                    className="pointer-events-none gap-1.5 text-xs"
                    disabled={uploading}
                    tabIndex={-1}
                    asChild
                  >
                    <span>
                      {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                      {uploading ? "Uploading..." : "Choose file"}
                    </span>
                  </Button>
                </label>
                <label htmlFor={uploading ? undefined : `camera-upload-${taskId}`} className={uploading ? "pointer-events-none" : undefined}>
                  <Button
                    variant="outline"
                    size="sm"
                    className="pointer-events-none gap-1.5 text-xs"
                    disabled={uploading}
                    tabIndex={-1}
                    asChild
                  >
                    <span>
                      <Camera className="h-3.5 w-3.5" />
                      Camera
                    </span>
                  </Button>
                </label>
              </div>
              <p className="mt-2 text-[10px] text-muted-foreground">
                Max 10MB. Drag &amp; drop, paste, or pick from gallery / files.
              </p>
            </>
          )}
        </div>
      )}
      {isReadOnly && attachments.length === 0 && !loading && (
        <p className="text-xs text-muted-foreground">No attachments</p>
      )}

      {/* Image preview overlay */}
      {previewUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={() => setPreviewUrl(null)}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-4 top-4 text-white hover:bg-white/20"
                onClick={() => setPreviewUrl(null)}
              >
                <X className="h-5 w-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Close preview</TooltipContent>
          </Tooltip>
          <img
            src={previewUrl}
            alt="Preview"
            className="max-h-[80vh] max-w-[80vw] rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
