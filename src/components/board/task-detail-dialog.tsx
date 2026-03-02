"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Tag, Trash2, Archive, ArchiveRestore, Pencil, X, Bot, Link2, Sparkles, Loader2, Eye, MessageSquare } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { TaskLabelBadges } from "./task-label-badges";
import { LabelPicker } from "./label-picker";
import { DueDatePicker } from "./due-date-picker";
import { ChecklistSection } from "./checklist-section";
import { ActivityTimeline } from "./activity-timeline";
import { TaskCommentsSection } from "./task-comments-section";
import { TaskAttachmentsSection } from "./task-attachments-section";
import { Markdown } from "@/components/ui/markdown";
import { MentionAutocomplete } from "./mention-autocomplete";
import { updateBoardTask, deleteBoardTask } from "@/actions/board";
import { enhanceTaskDescription } from "@/actions/ai";
import { useBoardOps } from "./board-context";
import { createClient } from "@/lib/supabase/client";
import { logTaskActivity } from "@/lib/activity";
import type { BoardTaskWithAssignee, BoardLabel, BoardChecklistItem, User, IdeaAgentUser } from "@/types";

interface TaskDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: BoardTaskWithAssignee;
  ideaId: string;
  boardLabels: BoardLabel[];
  checklistItems: BoardChecklistItem[];
  teamMembers: User[];
  currentUserId: string;
  initialTab?: string;
  ideaAgents?: User[];
  isReadOnly?: boolean;
  hasApiKey?: boolean;
}

export function TaskDetailDialog({
  open,
  onOpenChange,
  task,
  ideaId,
  boardLabels,
  checklistItems,
  teamMembers,
  currentUserId,
  initialTab,
  ideaAgents = [],
  isReadOnly = false,
  hasApiKey = false,
}: TaskDetailDialogProps) {
  const ops = useBoardOps();

  // Combine humans + pooled agents for @mention autocomplete
  const allMentionable = useMemo(() => {
    const ids = new Set(teamMembers.map((m) => m.id));
    return [...teamMembers, ...ideaAgents.filter((a) => !ids.has(a.id))];
  }, [teamMembers, ideaAgents]);

  // Current user's bots from the pool (for canModify checks on bot-authored comments)
  const currentUserBotIds = useMemo(
    () =>
      ideaAgents
        .filter((a) => (a as IdeaAgentUser).ownerId === currentUserId)
        .map((a) => a.id),
    [ideaAgents, currentUserId]
  );

  const [activeTab, setActiveTab] = useState("details");
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [savingTitle, setSavingTitle] = useState(false);
  const [savingDesc, setSavingDesc] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [previewDesc, setPreviewDesc] = useState(false);
  const skipBlurRef = useRef(false);
  const descriptionTextareaRef = useRef<HTMLTextAreaElement>(null);

  // @mention state for description
  const [descMentionQuery, setDescMentionQuery] = useState<string | null>(null);
  const [descMentionIndex, setDescMentionIndex] = useState(0);
  const [descMentionedUserIds, setDescMentionedUserIds] = useState<Set<string>>(new Set());

  const filteredDescMembers = useMemo(() => {
    if (descMentionQuery === null) return [];
    return teamMembers.filter((m) => m.full_name?.toLowerCase().includes(descMentionQuery.toLowerCase()));
  }, [teamMembers, descMentionQuery]);

  const [isArchived, setIsArchived] = useState(task.archived);

  const [localAssigneeId, setLocalAssigneeId] = useState<string | null>(task.assignee_id);

  // Sync state when task prop changes (including external updates via Realtime/MCP)
  const [lastTaskId, setLastTaskId] = useState(task.id);
  const [lastTaskDesc, setLastTaskDesc] = useState(task.description);
  const [lastTaskTitle, setLastTaskTitle] = useState(task.title);
  const [lastTaskAssigneeId, setLastTaskAssigneeId] = useState(task.assignee_id);
  const [lastTaskArchived, setLastTaskArchived] = useState(task.archived);

  if (task.id !== lastTaskId) {
    // Different task — full reset
    setTitle(task.title);
    setDescription(task.description ?? "");
    setLocalAssigneeId(task.assignee_id);
    setIsArchived(task.archived);
    setEditingDescription(false);
    setLastTaskId(task.id);
    setLastTaskDesc(task.description);
    setLastTaskTitle(task.title);
    setLastTaskAssigneeId(task.assignee_id);
    setLastTaskArchived(task.archived);
  } else {
    // Same task — sync fields changed externally (only if user isn't actively editing)
    if (task.description !== lastTaskDesc && !editingDescription) {
      setDescription(task.description ?? "");
      setLastTaskDesc(task.description);
    }
    if (task.title !== lastTaskTitle && !savingTitle) {
      setTitle(task.title);
      setLastTaskTitle(task.title);
    }
    if (task.assignee_id !== lastTaskAssigneeId) {
      setLocalAssigneeId(task.assignee_id);
      setLastTaskAssigneeId(task.assignee_id);
    }
    if (task.archived !== lastTaskArchived) {
      setIsArchived(task.archived);
      setLastTaskArchived(task.archived);
    }
  }

  // Switch to initialTab when dialog opens
  const [lastOpen, setLastOpen] = useState(false);
  if (open && !lastOpen) {
    setActiveTab(initialTab ?? "details");
  }
  if (open !== lastOpen) {
    setLastOpen(open);
  }

  async function handleTitleBlur() {
    if (title.trim() === task.title) return;
    if (!title.trim()) {
      setTitle(task.title);
      return;
    }
    setSavingTitle(true);
    try {
      await updateBoardTask(task.id, ideaId, { title: title.trim() });
      logTaskActivity(task.id, ideaId, currentUserId, "title_changed", {
        from: task.title,
        to: title.trim(),
      });
    } catch {
      toast.error("Failed to update title");
      setTitle(task.title);
    } finally {
      setSavingTitle(false);
    }
  }

  function detectDescMention(value: string, cursorPos: number) {
    const textBeforeCursor = value.slice(0, cursorPos);
    const match = textBeforeCursor.match(/(?:^|[\s])@(\S*)$/);
    if (match) {
      setDescMentionQuery(match[1]);
      setDescMentionIndex(0);
    } else {
      setDescMentionQuery(null);
    }
  }

  function handleDescInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setDescription(value);
    detectDescMention(value, e.target.selectionStart);
  }

  function handleDescMentionSelect(user: User) {
    const textarea = descriptionTextareaRef.current;
    if (!textarea) return;

    const cursorPos = textarea.selectionStart;
    const textBeforeCursor = description.slice(0, cursorPos);
    const textAfterCursor = description.slice(cursorPos);

    const atIndex = textBeforeCursor.lastIndexOf("@");
    if (atIndex === -1) return;

    const name = user.full_name ?? user.email;
    const newText = textBeforeCursor.slice(0, atIndex) + `@${name} ` + textAfterCursor;
    setDescription(newText);
    setDescMentionQuery(null);
    setDescMentionedUserIds((prev) => new Set(prev).add(user.id));

    requestAnimationFrame(() => {
      textarea.focus();
      const newCursorPos = atIndex + name.length + 2;
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    });
  }

  function handleDescKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (descMentionQuery === null || filteredDescMembers.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setDescMentionIndex((prev) => (prev < filteredDescMembers.length - 1 ? prev + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setDescMentionIndex((prev) => (prev > 0 ? prev - 1 : filteredDescMembers.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      handleDescMentionSelect(filteredDescMembers[descMentionIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setDescMentionQuery(null);
    }
  }

  async function handleDescriptionBlur() {
    if (skipBlurRef.current) {
      skipBlurRef.current = false;
      return;
    }
    setEditingDescription(false);
    setPreviewDesc(false);
    setDescMentionQuery(null);
    const newDesc = description.trim() || null;
    if (newDesc === (task.description ?? null)) return;
    const savedMentionedUserIds = new Set(descMentionedUserIds);
    setDescMentionedUserIds(new Set());
    setSavingDesc(true);
    try {
      await updateBoardTask(task.id, ideaId, { description: newDesc });
      logTaskActivity(task.id, ideaId, currentUserId, "description_changed");
      // Send mention notifications (fire-and-forget)
      if (savedMentionedUserIds.size > 0) {
        const supabase = createClient();
        for (const userId of savedMentionedUserIds) {
          if (userId === currentUserId) continue;
          const member = teamMembers.find((m) => m.id === userId);
          if (!member) continue;
          if (member.notification_preferences?.task_mentions === false) continue;
          supabase
            .from("notifications")
            .insert({
              user_id: userId,
              actor_id: currentUserId,
              type: "task_mention" as const,
              idea_id: ideaId,
              task_id: task.id,
            })
            .then(({ error }) => {
              if (error) console.error("Failed to send mention notification:", error.message);
            });
        }
      }
    } catch {
      toast.error("Failed to update description");
      setDescription(task.description ?? "");
    } finally {
      setSavingDesc(false);
    }
  }

  const showAiEnhance = hasApiKey && !isReadOnly && editingDescription && description.trim().length > 10;

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

  async function handleAssigneeChange(value: string) {
    const assigneeId = value === "unassigned" ? null : value;
    setLocalAssigneeId(assigneeId);

    try {
      await updateBoardTask(task.id, ideaId, { assignee_id: assigneeId });
      if (assigneeId) {
        const member = teamMembers.find((m) => m.id === assigneeId) ?? ideaAgents.find((b) => b.id === assigneeId);
        logTaskActivity(task.id, ideaId, currentUserId, "assigned", {
          assignee_name: member?.full_name ?? "Unknown",
        });
      } else {
        logTaskActivity(task.id, ideaId, currentUserId, "unassigned");
      }
    } catch {
      toast.error("Failed to update assignee");
      setLocalAssigneeId(task.assignee_id);
    }
  }

  async function handleArchiveToggle() {
    const newArchived = !isArchived;
    // Optimistic: update immediately
    setIsArchived(newArchived);
    try {
      await updateBoardTask(task.id, ideaId, { archived: newArchived });
      logTaskActivity(task.id, ideaId, currentUserId, newArchived ? "archived" : "unarchived");
    } catch {
      // Rollback
      setIsArchived(!newArchived);
      toast.error("Failed to update archive status");
    }
  }

  const confirmTimer = useRef<ReturnType<typeof setTimeout>>(null);

  function handleDeleteClick() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      confirmTimer.current = setTimeout(() => setConfirmDelete(false), 3000);
      return;
    }
    if (confirmTimer.current) clearTimeout(confirmTimer.current);

    // Optimistic delete & close immediately
    const rollback = ops.deleteTask(task.id, task.column_id);
    ops.incrementPendingOps();
    onOpenChange(false);

    deleteBoardTask(task.id, ideaId)
      .catch(() => {
        rollback();
        toast.error("Failed to delete task");
      })
      .finally(() => {
        ops.decrementPendingOps();
      });
  }

  const localAssignee = localAssigneeId
    ? (teamMembers.find((m) => m.id === localAssigneeId) ??
      ideaAgents.find((b) => b.id === localAssigneeId) ??
      task.assignee)
    : null;
  const assigneeInitials =
    localAssignee?.full_name
      ?.split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase() ?? null;

  const commentCount = task.comment_count;
  const attachmentCount = task.attachment_count;
  const propCoverPath = task.cover_image_path ?? null;

  const [localCoverPath, setLocalCoverPath] = useState<string | null>(propCoverPath);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [coverPreviewOpen, setCoverPreviewOpen] = useState(false);

  // Sync from prop when task changes (e.g. via Realtime refresh)
  const [lastCoverProp, setLastCoverProp] = useState(propCoverPath);
  if (propCoverPath !== lastCoverProp) {
    setLocalCoverPath(propCoverPath);
    setLastCoverProp(propCoverPath);
  }

  useEffect(() => {
    if (!localCoverPath) {
      setCoverUrl(null);
      return;
    }
    let cancelled = false;
    const supabase = createClient();
    supabase.storage
      .from("task-attachments")
      .createSignedUrl(localCoverPath, 3600)
      .then(({ data }) => {
        if (!cancelled && data?.signedUrl) setCoverUrl(data.signedUrl);
      });
    return () => {
      cancelled = true;
    };
  }, [localCoverPath]);

  async function handleShare() {
    const url = new URL(window.location.href);
    url.searchParams.set("taskId", task.id);
    const shareUrl = url.toString();

    // Try native share API on mobile (if available and has share capability)
    if (navigator.share && navigator.canShare?.({ url: shareUrl })) {
      try {
        await navigator.share({
          title: task.title,
          url: shareUrl,
        });
        return;
      } catch (err) {
        // User cancelled or share failed — fall through to clipboard
        if ((err as Error).name === "AbortError") return;
      }
    }

    // Fallback to clipboard
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success("Link copied to clipboard");
    } catch {
      toast.error("Failed to copy link");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && coverPreviewOpen) {
          setCoverPreviewOpen(false);
          return;
        }
        if (!v && editingDescription) {
          // Save description when closing dialog while editing (including preview mode)
          handleDescriptionBlur();
        }
        onOpenChange(v);
      }}
    >
      <DialogContent
        className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-lg"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {/* Cover image */}
        {coverUrl && (
          <div
            className="h-40 w-full shrink-0 cursor-zoom-in overflow-hidden"
            onClick={() => setCoverPreviewOpen(true)}
          >
            <img src={coverUrl} alt="" className="h-full w-full object-cover" />
          </div>
        )}

        {/* Header — always visible */}
        <DialogHeader className={`px-6 pb-0 ${coverUrl ? "pt-4" : "pt-6"}`}>
          <DialogTitle className="sr-only">Task Details</DialogTitle>
          {isReadOnly ? (
            <div className="flex items-center gap-2">
              <p className="flex-1 text-lg font-semibold">{task.title}</p>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                    onClick={handleShare}
                  >
                    <Link2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Copy link</TooltipContent>
              </Tooltip>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={handleTitleBlur}
                className="flex-1 border-none p-0 text-lg font-semibold shadow-none focus-visible:ring-0"
                disabled={savingTitle}
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                    onClick={handleShare}
                  >
                    <Link2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Copy link</TooltipContent>
              </Tooltip>
            </div>
          )}
        </DialogHeader>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-1 flex-col overflow-hidden">
          <TabsList variant="line" className="w-full justify-start gap-0 px-6 pt-2">
            <TabsTrigger value="details" className="text-xs">
              Details
            </TabsTrigger>
            <TabsTrigger value="comments" className="text-xs">
              Comments
              {!!commentCount && commentCount > 0 && (
                <span className="ml-1 rounded-full bg-muted px-1.5 text-[10px]">{commentCount}</span>
              )}
            </TabsTrigger>
            <TabsTrigger value="files" className="text-xs">
              Files
              {!!attachmentCount && attachmentCount > 0 && (
                <span className="ml-1 rounded-full bg-muted px-1.5 text-[10px]">{attachmentCount}</span>
              )}
            </TabsTrigger>
            <TabsTrigger value="activity" className="text-xs">
              Activity
            </TabsTrigger>
          </TabsList>

          {/* Details tab */}
          <TabsContent value="details" className="min-h-[400px] flex-1 overflow-y-auto overflow-x-hidden px-6 py-4">
            <div className="space-y-5">
              {/* Labels */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Labels</span>
                  {!isReadOnly && (
                    <LabelPicker
                      boardLabels={boardLabels}
                      taskLabels={task.labels}
                      taskId={task.id}
                      ideaId={ideaId}
                      currentUserId={currentUserId}
                      inDialog
                    >
                      <Button variant="outline" size="sm" className="h-6 gap-1 text-xs">
                        <Tag className="h-3 w-3" />
                        Edit
                      </Button>
                    </LabelPicker>
                  )}
                </div>
                {task.labels.length > 0 ? (
                  <TaskLabelBadges labels={task.labels} maxVisible={6} />
                ) : isReadOnly ? (
                  <p className="text-xs text-muted-foreground">None</p>
                ) : null}
              </div>

              {/* Assignee & Due Date row */}
              <div className="flex flex-wrap gap-4">
                <div className="space-y-1.5">
                  <span className="text-sm font-medium">Assignee</span>
                  <div className="flex items-center gap-2">
                    {localAssignee && (
                      <div className="relative">
                        <Avatar className="h-6 w-6">
                          <AvatarImage src={localAssignee.avatar_url ?? undefined} />
                          <AvatarFallback className="text-[10px]">{assigneeInitials}</AvatarFallback>
                        </Avatar>
                        {localAssignee.is_bot && (
                          <Bot className="absolute -bottom-0.5 -right-0.5 h-3 w-3 text-primary" />
                        )}
                      </div>
                    )}
                    {isReadOnly ? (
                      <span className="text-xs">
                        {localAssignee?.full_name ?? "Unassigned"}
                      </span>
                    ) : (
                      <Select
                        value={localAssigneeId ?? "unassigned"}
                        onValueChange={handleAssigneeChange}
                      >
                        <SelectTrigger className="h-8 w-40 text-xs">
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
                    )}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <span className="text-sm font-medium">Due Date</span>
                  <div className="flex items-center gap-2">
                    {isReadOnly ? (
                      <span className="text-xs">
                        {task.due_date
                          ? new Date(task.due_date).toLocaleDateString()
                          : "None"}
                      </span>
                    ) : (
                      <DueDatePicker
                        taskId={task.id}
                        ideaId={ideaId}
                        dueDate={task.due_date}
                        currentUserId={currentUserId}
                      />
                    )}
                  </div>
                </div>
              </div>

              {/* Discussion backlink */}
              {task.discussion_id && (
                <Link
                  href={`/ideas/${ideaId}/discussions/${task.discussion_id}`}
                  className="flex items-center gap-2 rounded-md border border-blue-500/20 bg-blue-500/5 px-3 py-2 text-xs text-blue-400 hover:bg-blue-500/10"
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  From discussion &mdash; View source thread
                </Link>
              )}

              <Separator />

              {/* Description */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Description</span>
                  <div className="flex items-center gap-1">
                    {showAiEnhance && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 gap-1 px-2 text-xs text-muted-foreground"
                        onMouseDown={() => { skipBlurRef.current = true; }}
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
                    {!isReadOnly && editingDescription && description.trim() && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 gap-1 px-2 text-xs text-muted-foreground"
                        onMouseDown={() => { skipBlurRef.current = true; }}
                        onClick={() => setPreviewDesc((v) => !v)}
                      >
                        {previewDesc ? (
                          <><Pencil className="h-3 w-3" /> Write</>
                        ) : (
                          <><Eye className="h-3 w-3" /> Preview</>
                        )}
                      </Button>
                    )}
                    {!isReadOnly && !editingDescription && description && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 gap-1 text-xs text-muted-foreground"
                        onClick={() => {
                          setEditingDescription(true);
                          setPreviewDesc(false);
                          requestAnimationFrame(() => {
                            descriptionTextareaRef.current?.focus();
                          });
                        }}
                      >
                        <Pencil className="h-3 w-3" />
                        Edit
                      </Button>
                    )}
                  </div>
                </div>
                {isReadOnly ? (
                  description ? (
                    <div className="rounded-md px-3 py-2 text-sm">
                      <Markdown teamMembers={teamMembers}>{description}</Markdown>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No description</p>
                  )
                ) : editingDescription ? (
                  previewDesc ? (
                    <div
                      className="min-h-[156px] rounded-md border border-input px-3 py-2 text-sm"
                      onBlur={handleDescriptionBlur}
                    >
                      <Markdown teamMembers={teamMembers}>{description}</Markdown>
                    </div>
                  ) : (
                    <div className="relative">
                      {descMentionQuery !== null && (
                        <MentionAutocomplete
                          filteredMembers={filteredDescMembers}
                          selectedIndex={descMentionIndex}
                          onSelect={handleDescMentionSelect}
                        />
                      )}
                      <Textarea
                        ref={descriptionTextareaRef}
                        value={description}
                        onChange={handleDescInputChange}
                        onKeyDown={handleDescKeyDown}
                        onBlur={handleDescriptionBlur}
                        placeholder="Add a description... (@ to mention, supports markdown)"
                        rows={6}
                        className="text-sm"
                        disabled={savingDesc}
                        autoFocus
                      />
                    </div>
                  )
                ) : description ? (
                  <div
                    className="cursor-pointer rounded-md border border-transparent px-3 py-2 text-sm transition-colors hover:border-border hover:bg-muted/50"
                    onClick={() => {
                      setEditingDescription(true);
                      requestAnimationFrame(() => {
                        descriptionTextareaRef.current?.focus();
                      });
                    }}
                  >
                    <Markdown teamMembers={teamMembers}>{description}</Markdown>
                  </div>
                ) : (
                  <div
                    className="cursor-pointer rounded-md border border-dashed border-border px-3 py-3 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:bg-muted/50"
                    onClick={() => {
                      setEditingDescription(true);
                      requestAnimationFrame(() => {
                        descriptionTextareaRef.current?.focus();
                      });
                    }}
                  >
                    Add a description...
                  </div>
                )}
              </div>

              <Separator />

              {/* Checklist */}
              <ChecklistSection
                items={checklistItems}
                taskId={task.id}
                ideaId={ideaId}
                currentUserId={currentUserId}
                isReadOnly={isReadOnly}
              />
            </div>
          </TabsContent>

          {/* Comments tab */}
          <TabsContent value="comments" className="min-h-[400px] flex-1 overflow-y-auto overflow-x-hidden px-6 py-4">
            <TaskCommentsSection
              taskId={task.id}
              ideaId={ideaId}
              currentUserId={currentUserId}
              teamMembers={allMentionable}
              userBotIds={currentUserBotIds}
              isReadOnly={isReadOnly}
            />
          </TabsContent>

          {/* Files tab */}
          <TabsContent value="files" className="min-h-[400px] flex-1 overflow-y-auto overflow-x-hidden px-6 py-4">
            <TaskAttachmentsSection
              taskId={task.id}
              ideaId={ideaId}
              currentUserId={currentUserId}
              coverImagePath={localCoverPath}
              onCoverChange={setLocalCoverPath}
              isReadOnly={isReadOnly}
            />
          </TabsContent>

          {/* Activity tab */}
          <TabsContent value="activity" className="min-h-[400px] flex-1 overflow-y-auto overflow-x-hidden px-6 py-4">
            <ActivityTimeline taskId={task.id} ideaId={ideaId} />
          </TabsContent>
        </Tabs>

        {/* Footer — hidden for read-only guests */}
        {!isReadOnly && (
          <div className="flex justify-between border-t border-border px-6 py-3">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-muted-foreground"
              onClick={handleArchiveToggle}
            >
              {isArchived ? (
                <>
                  <ArchiveRestore className="h-3.5 w-3.5" />
                  Unarchive
                </>
              ) : (
                <>
                  <Archive className="h-3.5 w-3.5" />
                  Archive
                </>
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={`gap-1.5 ${confirmDelete ? "text-destructive font-medium" : "text-muted-foreground"}`}
              onClick={handleDeleteClick}
              disabled={deleting}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {deleting ? "Deleting..." : confirmDelete ? "Are you sure?" : "Delete task"}
            </Button>
          </div>
        )}
        {/* Cover image lightbox — inside DialogContent so Radix focus trap allows clicks */}
        {coverPreviewOpen && coverUrl && (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80"
            onClick={() => setCoverPreviewOpen(false)}
          >
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-4 top-4 text-white hover:bg-white/20"
              onClick={(e) => {
                e.stopPropagation();
                setCoverPreviewOpen(false);
              }}
            >
              <X className="h-5 w-5" />
            </Button>
            <img
              src={coverUrl}
              alt=""
              className="max-h-[80vh] max-w-[90vw] rounded-lg object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
