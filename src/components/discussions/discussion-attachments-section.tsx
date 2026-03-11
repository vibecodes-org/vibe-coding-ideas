"use client";

import {
  useEffect,
  useState,
  useCallback,
  useRef,
  useImperativeHandle,
  forwardRef,
} from "react";
import {
  FileText,
  Image as ImageIcon,
  FileCode,
  X,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { createClient } from "@/lib/supabase/client";
import {
  MAX_DISCUSSION_ATTACHMENTS,
  MAX_IDEA_ATTACHMENT_SIZE,
  ALLOWED_IDEA_ATTACHMENT_TYPES,
} from "@/lib/validation";
import { toast } from "sonner";
import type { DiscussionAttachment } from "@/types";

export interface DiscussionAttachmentsHandle {
  triggerUpload: () => void;
}

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

function getIconBg(contentType: string): string {
  if (isImageType(contentType)) return "bg-violet-500/10";
  if (contentType === "application/pdf") return "bg-red-500/10";
  if (contentType === "text/markdown") return "bg-blue-500/10";
  if (contentType === "text/html") return "bg-orange-500/10";
  return "bg-muted";
}

function getIconColor(contentType: string): string {
  if (isImageType(contentType)) return "text-violet-400";
  if (contentType === "application/pdf") return "text-red-400";
  if (contentType === "text/markdown") return "text-blue-400";
  if (contentType === "text/html") return "text-orange-400";
  return "text-muted-foreground";
}

function getFileIcon(contentType: string) {
  if (isImageType(contentType)) return ImageIcon;
  if (contentType === "text/html") return FileCode;
  return FileText;
}

export const DiscussionAttachmentsSection = forwardRef<
  DiscussionAttachmentsHandle,
  DiscussionAttachmentsSectionProps
>(function DiscussionAttachmentsSection(
  { discussionId, ideaId, currentUserId, isAuthor, isTeamMember },
  ref
) {
  const [attachments, setAttachments] = useState<DiscussionAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState<
    { id: string; name: string }[]
  >([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isReadOnly = !isTeamMember;

  // Expose triggerUpload to parent
  useImperativeHandle(ref, () => ({
    triggerUpload: () => fileInputRef.current?.click(),
  }));

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
          setAttachments((prev) =>
            prev.filter((a) => a.id !== payload.old.id)
          );
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
    const allowedExts = [
      "md", "html", "htm", "pdf", "png", "jpg", "jpeg", "gif", "webp", "svg",
    ];
    const typeAllowed =
      ALLOWED_IDEA_ATTACHMENT_TYPES.includes(
        file.type as (typeof ALLOWED_IDEA_ATTACHMENT_TYPES)[number]
      ) || allowedExts.includes(ext);

    if (!typeAllowed) {
      toast.error("Unsupported file type. Allowed: images, PDF, Markdown, HTML");
      return;
    }

    if (attachments.length >= MAX_DISCUSSION_ATTACHMENTS) {
      toast.error(
        `Maximum ${MAX_DISCUSSION_ATTACHMENTS} attachments per discussion`
      );
      return;
    }

    let contentType = file.type;
    if (ext === "md" && contentType !== "text/markdown") {
      contentType = "text/markdown";
    }
    if ((ext === "html" || ext === "htm") && contentType !== "text/html") {
      contentType = "text/html";
    }

    const placeholderId = crypto.randomUUID();
    setUploadingFiles((prev) => [
      ...prev,
      { id: placeholderId, name: file.name },
    ]);
    setUploading(true);
    const supabase = createClient();

    const uniqueName = `${crypto.randomUUID()}.${ext}`;
    const storagePath = `${ideaId}/${discussionId}/${uniqueName}`;

    const { error: uploadError } = await supabase.storage
      .from("discussion-attachments")
      .upload(storagePath, file);

    if (uploadError) {
      toast.error(`Upload failed: ${uploadError.message}`);
      setUploadingFiles((prev) =>
        prev.filter((f) => f.id !== placeholderId)
      );
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
      await supabase.storage
        .from("discussion-attachments")
        .remove([storagePath]);
    } else {
      setAttachments((prev) => {
        if (prev.some((a) => a.id === inserted.id)) return prev;
        return [inserted, ...prev];
      });
    }

    setUploadingFiles((prev) =>
      prev.filter((f) => f.id !== placeholderId)
    );
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
    setAttachments((prev) => prev.filter((a) => a.id !== attachment.id));

    await supabase.storage
      .from("discussion-attachments")
      .remove([attachment.storage_path]);

    const { error } = await supabase
      .from("discussion_attachments")
      .delete()
      .eq("id", attachment.id);

    if (error) {
      toast.error("Failed to delete attachment");
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

  const canDelete = (attachment: DiscussionAttachment) =>
    attachment.uploaded_by === currentUserId || isAuthor;

  const hasContent =
    !loading && (attachments.length > 0 || uploadingFiles.length > 0);

  // Nothing to render — no attachments and nothing uploading
  if (!hasContent) {
    return (
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept=".md,.html,.htm,.pdf,.png,.jpg,.jpeg,.gif,.webp,.svg"
        onChange={handleFileSelect}
        multiple
      />
    );
  }

  return (
    <>
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept=".md,.html,.htm,.pdf,.png,.jpg,.jpeg,.gif,.webp,.svg"
        onChange={handleFileSelect}
        multiple
      />

      {/* Compact chips */}
      <div className="mt-4 flex flex-wrap gap-1.5">
        {uploadingFiles.map((file) => (
          <span
            key={file.id}
            className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-primary/40 bg-primary/5 px-2.5 py-1"
          >
            <Loader2 className="h-3 w-3 animate-spin text-primary" />
            <span className="max-w-[140px] truncate text-[11px] font-medium">
              {file.name}
            </span>
          </span>
        ))}
        {attachments.map((attachment) => {
          const Icon = getFileIcon(attachment.content_type);
          const iconColor = getIconColor(attachment.content_type);
          const iconBg = getIconBg(attachment.content_type);
          const clickable = isImageType(attachment.content_type);

          return (
            <span
              key={attachment.id}
              className="group inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 py-0.5 pl-1 pr-2 transition-colors hover:border-border/80 hover:bg-muted"
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${iconBg} ${clickable ? "cursor-pointer" : "cursor-default"}`}
                    onClick={() =>
                      clickable
                        ? handlePreview(attachment)
                        : handleDownload(attachment)
                    }
                  >
                    <Icon className={`h-2.5 w-2.5 ${iconColor}`} />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {clickable ? "Preview" : "Download"}
                </TooltipContent>
              </Tooltip>
              <button
                className="max-w-[140px] truncate text-[11px] font-medium text-foreground/80 hover:text-foreground cursor-pointer"
                onClick={() => handleDownload(attachment)}
              >
                {attachment.file_name}
              </button>
              <span className="text-[10px] text-muted-foreground">
                {formatFileSize(attachment.file_size)}
              </span>
              {!isReadOnly && canDelete(attachment) && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      className="ml-0.5 flex h-3.5 w-3.5 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground/60 transition-colors hover:bg-destructive/15 hover:text-destructive"
                      onClick={() => handleDelete(attachment)}
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Remove</TooltipContent>
                </Tooltip>
              )}
            </span>
          );
        })}
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
});
