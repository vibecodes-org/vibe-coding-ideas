"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Paperclip, X } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MentionAutocomplete } from "@/components/board/mention-autocomplete";
import { createDiscussionReply } from "@/actions/discussions";
import { createClient } from "@/lib/supabase/client";
import { useMentionState } from "@/hooks/use-mentions";
import { sendDiscussionMentionNotifications } from "@/lib/mention-notifications";
import {
  MAX_DISCUSSION_REPLY_LENGTH,
  MAX_DISCUSSION_ATTACHMENTS,
  MAX_IDEA_ATTACHMENT_SIZE,
  ALLOWED_IDEA_ATTACHMENT_TYPES,
} from "@/lib/validation";
import { displayName, getInitials } from "@/lib/utils";
import type { User } from "@/types";

const ALLOWED_EXTENSIONS = [
  "md", "html", "htm", "pdf", "png", "jpg", "jpeg", "gif", "webp", "svg",
];

function validateFile(file: File): string | null {
  if (file.size > MAX_IDEA_ATTACHMENT_SIZE) return "File size must be under 10MB";
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const typeAllowed =
    ALLOWED_IDEA_ATTACHMENT_TYPES.includes(
      file.type as (typeof ALLOWED_IDEA_ATTACHMENT_TYPES)[number]
    ) || ALLOWED_EXTENSIONS.includes(ext);
  if (!typeAllowed) return "Unsupported file type";
  return null;
}

function normalizeContentType(file: File): string {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "md" && file.type !== "text/markdown") return "text/markdown";
  if ((ext === "html" || ext === "htm") && file.type !== "text/html") return "text/html";
  return file.type;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

interface DiscussionReplyFormProps {
  discussionId: string;
  ideaId: string;
  currentUser: User;
  parentReplyId?: string | null;
  onCancel?: () => void;
  compact?: boolean;
  teamMembers?: User[];
}

export function DiscussionReplyForm({
  discussionId,
  ideaId,
  currentUser,
  parentReplyId,
  onCancel,
  compact = false,
  teamMembers = [],
}: DiscussionReplyFormProps) {
  const router = useRouter();
  const [content, setContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const mention = useMentionState(teamMembers);

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setContent(value);
    mention.detectMention(value, e.target.selectionStart);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files?.length) return;

    const newFiles: File[] = [];
    for (const file of files) {
      if (pendingFiles.length + newFiles.length >= MAX_DISCUSSION_ATTACHMENTS) {
        toast.error(`Maximum ${MAX_DISCUSSION_ATTACHMENTS} attachments`);
        break;
      }
      const error = validateFile(file);
      if (error) {
        toast.error(`${file.name}: ${error}`);
        continue;
      }
      newFiles.push(file);
    }

    if (newFiles.length > 0) {
      setPendingFiles((prev) => [...prev, ...newFiles]);
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removePendingFile(index: number) {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function uploadFiles(replyId: string) {
    const supabase = createClient();

    for (const file of pendingFiles) {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      const uniqueName = `${crypto.randomUUID()}.${ext}`;
      const storagePath = `${ideaId}/${discussionId}/${uniqueName}`;
      const contentType = normalizeContentType(file);

      const { error: uploadError } = await supabase.storage
        .from("discussion-attachments")
        .upload(storagePath, file);

      if (uploadError) {
        toast.error(`Failed to upload ${file.name}`);
        continue;
      }

      const { error: dbError } = await supabase
        .from("discussion_attachments")
        .insert({
          discussion_id: discussionId,
          idea_id: ideaId,
          reply_id: replyId,
          uploaded_by: currentUser.id,
          file_name: file.name,
          file_size: file.size,
          content_type: contentType,
          storage_path: storagePath,
        });

      if (dbError) {
        toast.error(`Failed to save ${file.name}`);
        await supabase.storage
          .from("discussion-attachments")
          .remove([storagePath]);
      }
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;

    const savedMentionedUserIds = new Set(mention.mentionedUserIds);
    setIsSubmitting(true);
    try {
      const replyId = await createDiscussionReply(discussionId, ideaId, content, parentReplyId);

      // Upload pending files to the new reply (fire-and-forget style — don't block success)
      if (pendingFiles.length > 0) {
        await uploadFiles(replyId);
      }

      // Send mention notifications (fire-and-forget)
      if (savedMentionedUserIds.size > 0 && currentUser.id) {
        sendDiscussionMentionNotifications(
          savedMentionedUserIds,
          currentUser.id,
          teamMembers,
          ideaId,
          discussionId,
          replyId
        );
      }

      setContent("");
      setPendingFiles([]);
      mention.setMentionedUserIds(new Set());
      mention.setMentionQuery(null);
      toast.success("Reply posted");
      router.refresh();
      onCancel?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to post reply");
    } finally {
      setIsSubmitting(false);
    }
  }

  const pendingFileChips = pendingFiles.length > 0 && (
    <div className="flex flex-wrap gap-1.5">
      {pendingFiles.map((file, i) => (
        <span
          key={`${file.name}-${i}`}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 py-0.5 pl-2 pr-1 text-[11px] text-foreground/80"
        >
          {file.name}
          <span className="text-[10px] text-muted-foreground">
            {formatFileSize(file.size)}
          </span>
          <button
            type="button"
            onClick={() => removePendingFile(i)}
            className="ml-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-muted-foreground/60 transition-colors hover:bg-destructive/15 hover:text-destructive"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </span>
      ))}
    </div>
  );

  const attachButton = (
    <>
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept=".md,.html,.htm,.pdf,.png,.jpg,.jpeg,.gif,.webp,.svg"
        onChange={handleFileSelect}
        multiple
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        title="Attach file"
      >
        <Paperclip className="h-3.5 w-3.5" />
      </button>
    </>
  );

  if (compact) {
    return (
      <form onSubmit={handleSubmit} className="mt-2 space-y-2">
        <div className="relative">
          {mention.mentionQuery !== null && mention.hasMentions && (
            <MentionAutocomplete
              filteredMembers={mention.filteredMembers}
              selectedIndex={mention.mentionIndex}
              onSelect={(user) => mention.handleMentionSelect(content, setContent, user)}
            />
          )}
          <Textarea
            ref={mention.textareaRef}
            placeholder={mention.hasMentions ? "Write a reply... (@ to mention)" : "Write a reply..."}
            value={content}
            onChange={handleInputChange}
            onKeyDown={(e) => mention.handleKeyDown(e, content, setContent)}
            maxLength={MAX_DISCUSSION_REPLY_LENGTH}
            rows={2}
            className="min-h-[60px] resize-y text-sm"
            autoFocus
          />
        </div>
        {pendingFileChips}
        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" disabled={isSubmitting || !content.trim()}>
            {isSubmitting ? "Replying..." : "Reply"}
          </Button>
          {attachButton}
          {onCancel && (
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          )}
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border p-4">
      <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
        <Avatar className="h-5 w-5">
          <AvatarImage src={currentUser.avatar_url ?? undefined} />
          <AvatarFallback className="text-[8px]">
            {getInitials(displayName(currentUser))}
          </AvatarFallback>
        </Avatar>
        Reply as {displayName(currentUser)}
      </div>
      <div className="relative">
        {mention.mentionQuery !== null && mention.hasMentions && (
          <MentionAutocomplete
            filteredMembers={mention.filteredMembers}
            selectedIndex={mention.mentionIndex}
            onSelect={(user) => mention.handleMentionSelect(content, setContent, user)}
          />
        )}
        <Textarea
          ref={mention.textareaRef}
          placeholder={mention.hasMentions ? "Write a reply... Tip: @ mention your agents to get their input!" : "Write a reply..."}
          value={content}
          onChange={handleInputChange}
          onKeyDown={(e) => mention.handleKeyDown(e, content, setContent)}
          maxLength={MAX_DISCUSSION_REPLY_LENGTH}
          rows={3}
          className="min-h-[80px] resize-y"
        />
      </div>
      {pendingFileChips}
      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Markdown supported</span>
          {attachButton}
        </div>
        <Button type="submit" size="sm" disabled={isSubmitting || !content.trim()}>
          {isSubmitting ? "Replying..." : "Reply"}
        </Button>
      </div>
    </form>
  );
}
