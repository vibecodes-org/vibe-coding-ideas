"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Paperclip,
  Trash2,
  Upload,
  FileText,
  Image as ImageIcon,
  FileCode,
  Download,
  X,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { createClient } from "@/lib/supabase/client";
import { formatRelativeTime } from "@/lib/utils";
import {
  MAX_DISCUSSION_ATTACHMENTS,
  MAX_IDEA_ATTACHMENT_SIZE,
  ALLOWED_IDEA_ATTACHMENT_TYPES,
} from "@/lib/validation";
import { toast } from "sonner";
import type { DiscussionAttachment } from "@/types";

interface DiscussionAttachmentsSectionProps {
  discussionId: string;
  ideaId: string;
  currentUserId: string;
  isAuthor: boolean;
  isTeamMember: boolean;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function isImageType(contentType: string): boolean {
  return contentType.startsWith("image/");
}

function getFileIcon(contentType: string) {
  if (isImageType(contentType)) return ImageIcon;
  if (contentType === "text/html") return FileCode;
  return FileText;
}

function getIconColor(contentType: string): string {
  if (isImageType(contentType)) return "text-violet-400";
  if (contentType === "application/pdf") return "text-red-400";
  if (contentType === "text/markdown") return "text-blue-400";
  if (contentType === "text/html") return "text-orange-400";
  return "text-muted-foreground";
}

export function DiscussionAttachmentsSection({
  discussionId,
  ideaId,
  currentUserId,
  isAuthor,
  isTeamMember,
}: DiscussionAttachmentsSectionProps) {
  const [attachments, setAttachments] = useState<DiscussionAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState<{ id: string; name: string; size: number }[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

  const isReadOnly = !isTeamMember;

  const fetchAttachments = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("discussion_attachments")
      .select("*")
      .eq("discussion_id", discussionId)
      .order("created_at", { ascending: false });

    setAttachments(data ?? []);
    setLoading(false);
  }, [discussionId]);

  useEffect(() => {
    fetchAttachments();
  }, [fetchAttachments]);

  // Realtime
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`discussion-attachments-${discussionId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "discussion_attachments",
          filter: `discussion_id=eq.${discussionId}`,
        },
        async (payload) => {
          const { data } = await supabase
            .from("discussion_attachments")
            .select("*")
            .eq("id", payload.new.id)
            .single();

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
          table: "discussion_attachments",
          filter: `discussion_id=eq.${discussionId}`,
        },
        (payload) => {
          setAttachments((prev) => prev.filter((a) => a.id !== payload.old.id));
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [discussionId]);

  // Paste handler for images
  useEffect(() => {
    if (isReadOnly) return;

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
  }, [discussionId, currentUserId, isReadOnly]);

  async function uploadFile(file: File) {
    if (file.size > MAX_IDEA_ATTACHMENT_SIZE) {
      toast.error("File size must be under 10MB");
      return;
    }

    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const allowedExts = ["md", "html", "htm", "pdf", "png", "jpg", "jpeg", "gif", "webp", "svg"];
    const typeAllowed =
      ALLOWED_IDEA_ATTACHMENT_TYPES.includes(file.type as (typeof ALLOWED_IDEA_ATTACHMENT_TYPES)[number]) ||
      allowedExts.includes(ext);

    if (!typeAllowed) {
      toast.error("Unsupported file type. Allowed: images, PDF, Markdown, HTML");
      return;
    }

    if (attachments.length >= MAX_DISCUSSION_ATTACHMENTS) {
      toast.error(`Maximum ${MAX_DISCUSSION_ATTACHMENTS} attachments per discussion`);
      return;
    }

    // Normalize content type — browsers often report .md as text/plain or empty
    let contentType = file.type;
    if (ext === "md" && contentType !== "text/markdown") {
      contentType = "text/markdown";
    }
    if ((ext === "html" || ext === "htm") && contentType !== "text/html") {
      contentType = "text/html";
    }

    const placeholderId = crypto.randomUUID();
    setUploadingFiles((prev) => [...prev, { id: placeholderId, name: file.name, size: file.size }]);
    setUploading(true);
    const supabase = createClient();

    const uniqueName = `${crypto.randomUUID()}.${ext}`;
    const storagePath = `${ideaId}/${discussionId}/${uniqueName}`;

    const { error: uploadError } = await supabase.storage
      .from("discussion-attachments")
      .upload(storagePath, file);

    if (uploadError) {
      toast.error(`Upload failed: ${uploadError.message}`);
      setUploadingFiles((prev) => prev.filter((f) => f.id !== placeholderId));
      setUploading(false);
      return;
    }

    const { data: inserted, error: dbError } = await supabase
      .from("discussion_attachments")
      .insert({
        discussion_id: discussionId,
        idea_id: ideaId,
        uploaded_by: currentUserId,
        file_name: file.name,
        file_size: file.size,
        content_type: contentType,
        storage_path: storagePath,
      })
      .select()
      .single();

    if (dbError || !inserted) {
      toast.error("Failed to save attachment record");
      // Clean up orphaned storage file
      await supabase.storage.from("discussion-attachments").remove([storagePath]);
    } else {
      // Optimistically add to list immediately (don't wait for Realtime)
      setAttachments((prev) => {
        if (prev.some((a) => a.id === inserted.id)) return prev;
        return [inserted, ...prev];
      });
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

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function handleDelete(attachment: DiscussionAttachment) {
    const supabase = createClient();

    // Optimistic removal
    setAttachments((prev) => prev.filter((a) => a.id !== attachment.id));

    await supabase.storage.from("discussion-attachments").remove([attachment.storage_path]);

    const { error } = await supabase
      .from("discussion_attachments")
      .delete()
      .eq("id", attachment.id);

    if (error) {
      toast.error("Failed to delete attachment");
      // Re-fetch to restore state
      fetchAttachments();
    }
  }

  async function handleDownload(attachment: DiscussionAttachment) {
    const supabase = createClient();
    const { data } = await supabase.storage
      .from("discussion-attachments")
      .createSignedUrl(attachment.storage_path, 60, {
        download: attachment.file_name,
      });

    if (data?.signedUrl) {
      window.open(data.signedUrl, "_blank");
    }
  }

  async function handlePreview(attachment: DiscussionAttachment) {
    const supabase = createClient();
    const { data } = await supabase.storage
      .from("discussion-attachments")
      .createSignedUrl(attachment.storage_path, 300);

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

  const canDelete = (attachment: DiscussionAttachment) =>
    attachment.uploaded_by === currentUserId || isAuthor;

  // Don't render anything if read-only and no attachments
  if (isReadOnly && !loading && attachments.length === 0) {
    return null;
  }

  return (
    <>
      <div className="space-y-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Paperclip className="h-4 w-4" />
          Attachments
          {attachments.length > 0 && (
            <span className="rounded-full bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">
              {attachments.length}
            </span>
          )}
        </h3>

        {loading ? (
          <p className="text-xs text-muted-foreground">Loading...</p>
        ) : attachments.length > 0 || uploadingFiles.length > 0 ? (
          <ScrollArea className={attachments.length > 6 ? "max-h-64" : undefined}>
            <div className="space-y-1.5">
              {uploadingFiles.map((file) => (
                <div
                  key={file.id}
                  className="flex items-center gap-3 rounded-md border border-dashed border-primary/40 bg-primary/5 p-2"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-muted">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] font-medium">{file.name}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {formatFileSize(file.size)} &middot; Uploading...
                    </p>
                  </div>
                </div>
              ))}
              {attachments.map((attachment) => {
                const Icon = getFileIcon(attachment.content_type);
                const iconColor = getIconColor(attachment.content_type);

                return (
                  <div
                    key={attachment.id}
                    className="group flex items-center gap-3 rounded-md border border-border p-2 transition-colors hover:border-border/80 hover:bg-muted/30"
                  >
                    {isImageType(attachment.content_type) ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded bg-muted"
                            onClick={() => handlePreview(attachment)}
                          >
                            <Icon className={`h-4 w-4 ${iconColor}`} />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>Preview</TooltipContent>
                      </Tooltip>
                    ) : (
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-muted">
                        <Icon className={`h-4 w-4 ${iconColor}`} />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] font-medium">
                        {attachment.file_name}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {formatFileSize(attachment.file_size)} &middot;{" "}
                        {formatRelativeTime(attachment.created_at)}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-0.5">
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
                      {!isReadOnly && canDelete(attachment) && (
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
                );
              })}
            </div>
          </ScrollArea>
        ) : null}

        {/* Upload zone — team members only */}
        {!isReadOnly && (
          <div
            className={`relative rounded-lg border-2 border-dashed p-4 text-center transition-colors ${
              isDragging ? "border-primary bg-primary/5" : "border-border"
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
                  id={`discussion-file-upload-${discussionId}`}
                  type="file"
                  className="hidden"
                  accept=".md,.html,.htm,.pdf,.png,.jpg,.jpeg,.gif,.webp,.svg"
                  onChange={handleFileSelect}
                  multiple
                />
                <div className="flex items-center justify-center gap-2">
                  <label
                    htmlFor={uploading ? undefined : `discussion-file-upload-${discussionId}`}
                    className={uploading ? "pointer-events-none" : undefined}
                  >
                    <Button
                      variant="outline"
                      size="sm"
                      className="pointer-events-none gap-1.5 text-xs"
                      disabled={uploading || attachments.length >= MAX_DISCUSSION_ATTACHMENTS}
                      tabIndex={-1}
                      asChild
                    >
                      <span>
                        {uploading ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Upload className="h-3.5 w-3.5" />
                        )}
                        {uploading ? "Uploading..." : "Choose file"}
                      </span>
                    </Button>
                  </label>
                </div>
                <p className="mt-2 text-[10px] text-muted-foreground">
                  Images, PDF, Markdown, HTML &middot; Max 10MB &middot;{" "}
                  {attachments.length}/{MAX_DISCUSSION_ATTACHMENTS} files
                </p>
              </>
            )}
          </div>
        )}
      </div>

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
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt="Preview"
            className="max-h-[80vh] max-w-[80vw] rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
