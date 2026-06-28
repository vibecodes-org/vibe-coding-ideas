"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  Plus,
  ArrowRight,
  UserPlus,
  UserMinus,
  CalendarDays,
  CalendarX,
  Tag,
  Archive,
  ArchiveRestore,
  Pencil,
  FileText,
  ListPlus,
  CheckSquare,
  MessageSquare,
  Paperclip,
  Trash2,
  Upload,
  Sparkles,
  Activity,
  ExternalLink,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { createClient } from "@/lib/supabase/client";
import { formatRelativeTime } from "@/lib/utils";
import { formatActivityDetails, groupIntoSessions } from "@/lib/activity-format";
import { ACTIVITY_ACTIONS } from "@/lib/constants";
import type { DashboardBot } from "@/types";

const ICON_MAP: Record<string, React.ElementType> = {
  Plus,
  ArrowRight,
  UserPlus,
  UserMinus,
  CalendarDays,
  CalendarX,
  Tag,
  TagX: Tag,
  Archive,
  ArchiveRestore,
  Pencil,
  FileText,
  ListPlus,
  CheckSquare,
  MessageSquare,
  Paperclip,
  Trash2,
  Upload,
  Sparkles,
};

type BotActivityEntry = {
  id: string;
  action: string;
  details: Record<string, unknown> | null;
  created_at: string;
  task: { id: string; title: string } | null;
  idea: { id: string; title: string } | null;
};

type BotCommentEntry = {
  id: string;
  content: string;
  created_at: string;
  task: { id: string; title: string } | null;
  idea: { id: string; title: string } | null;
};

/** Unified feed entry — either an activity or a comment. */
type FeedEntry = {
  id: string;
  kind: "activity" | "comment";
  created_at: string;
  task: { id: string; title: string } | null;
  idea: { id: string; title: string } | null;
  // Activity-specific
  action?: string;
  details?: Record<string, unknown> | null;
  // Comment-specific
  content?: string;
};

type BotAssignedTask = {
  id: string;
  title: string;
  column: { title: string; is_done_column: boolean };
  idea: { id: string; title: string };
};

const PAGE_SIZE = 30;

interface BotActivityDialogProps {
  bot: DashboardBot | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function mergeAndSort(
  activities: BotActivityEntry[],
  comments: BotCommentEntry[]
): FeedEntry[] {
  const feed: FeedEntry[] = [];

  for (const a of activities) {
    // Skip comment_added activities — the actual comment is shown from board_task_comments
    if (a.action === "comment_added" && comments.length > 0) continue;

    feed.push({
      id: a.id,
      kind: "activity",
      created_at: a.created_at,
      task: a.task,
      idea: a.idea,
      action: a.action,
      details: a.details,
    });
  }

  for (const c of comments) {
    feed.push({
      id: `comment-${c.id}`,
      kind: "comment",
      created_at: c.created_at,
      task: c.task,
      idea: c.idea,
      content: c.content,
    });
  }

  // Newest first
  feed.sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  return feed;
}

/** A run of consecutive entries about the same task (or no task). */
type TaskGroup = {
  taskId: string | null;
  taskTitle: string | null;
  ideaId: string | null;
  ideaTitle: string | null;
  entries: FeedEntry[];
};

/** Groups consecutive session entries by task — avoids repeating the task title on every line. */
function groupByTask(entries: FeedEntry[]): TaskGroup[] {
  if (entries.length === 0) return [];

  const groups: TaskGroup[] = [];
  let current: TaskGroup = {
    taskId: entries[0].task?.id ?? null,
    taskTitle: entries[0].task?.title ?? null,
    ideaId: entries[0].idea?.id ?? null,
    ideaTitle: entries[0].idea?.title ?? null,
    entries: [entries[0]],
  };

  for (let i = 1; i < entries.length; i++) {
    const entryTaskId = entries[i].task?.id ?? null;
    if (entryTaskId === current.taskId) {
      current.entries.push(entries[i]);
    } else {
      groups.push(current);
      current = {
        taskId: entryTaskId,
        taskTitle: entries[i].task?.title ?? null,
        ideaId: entries[i].idea?.id ?? null,
        ideaTitle: entries[i].idea?.title ?? null,
        entries: [entries[i]],
      };
    }
  }
  groups.push(current);
  return groups;
}

function formatSessionTime(entries: FeedEntry[]): string {
  if (entries.length === 0) return "";
  // Entries are newest-first; last entry is the earliest
  const earliest = entries[entries.length - 1].created_at;
  const latest = entries[0].created_at;

  const start = new Date(earliest);
  const end = new Date(latest);

  const dateStr = start.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const startTime = start.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  const endTime = end.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  if (startTime === endTime) return `${dateStr} at ${startTime}`;
  return `${dateStr}, ${startTime} – ${endTime}`;
}

function formatEntryTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function BotActivityDialog({
  bot,
  open,
  onOpenChange,
}: BotActivityDialogProps) {
  const [activities, setActivities] = useState<BotActivityEntry[]>([]);
  const [comments, setComments] = useState<BotCommentEntry[]>([]);
  const [assignedTasks, setAssignedTasks] = useState<BotAssignedTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);

  const feed = useMemo(
    () => mergeAndSort(activities, comments),
    [activities, comments]
  );
  const sessions = useMemo(() => groupIntoSessions(feed), [feed]);

  const fetchData = useCallback(
    async (offset = 0) => {
      if (!bot) return;
      const supabase = createClient();

      if (offset === 0) {
        // Fetch activity, comments, and assigned tasks on initial load
        const [activityResult, commentsResult, tasksResult] = await Promise.all([
          supabase
            .from("board_task_activity")
            .select(
              "id, action, details, created_at, task:board_tasks!board_task_activity_task_id_fkey(id, title), idea:ideas!board_task_activity_idea_id_fkey(id, title)"
            )
            .eq("actor_id", bot.id)
            .order("created_at", { ascending: false })
            .range(0, PAGE_SIZE - 1),
          supabase
            .from("board_task_comments")
            .select(
              "id, content, created_at, task:board_tasks!board_task_comments_task_id_fkey(id, title), idea:ideas!board_task_comments_idea_id_fkey(id, title)"
            )
            .eq("author_id", bot.id)
            .order("created_at", { ascending: false })
            .range(0, PAGE_SIZE - 1),
          supabase
            .from("board_tasks")
            .select(
              "id, title, column:board_columns!board_tasks_column_id_fkey(title, is_done_column), idea:ideas!board_tasks_idea_id_fkey(id, title)"
            )
            .eq("assignee_id", bot.id)
            .eq("archived", false)
            .order("updated_at", { ascending: false }),
        ]);

        const actItems = (activityResult.data ??
          []) as unknown as BotActivityEntry[];
        setActivities(actItems);
        setHasMore(actItems.length === PAGE_SIZE);

        const commentItems = (commentsResult.data ??
          []) as unknown as BotCommentEntry[];
        setComments(commentItems);

        const taskItems = (
          (tasksResult.data ?? []) as unknown as BotAssignedTask[]
        ).filter((t) => !t.column.is_done_column);
        setAssignedTasks(taskItems);
      } else {
        // Paginate activity only (comments are limited to first page)
        const { data } = await supabase
          .from("board_task_activity")
          .select(
            "id, action, details, created_at, task:board_tasks!board_task_activity_task_id_fkey(id, title), idea:ideas!board_task_activity_idea_id_fkey(id, title)"
          )
          .eq("actor_id", bot.id)
          .order("created_at", { ascending: false })
          .range(offset, offset + PAGE_SIZE - 1);

        const items = (data ?? []) as unknown as BotActivityEntry[];
        setActivities((prev) => [...prev, ...items]);
        setHasMore(items.length === PAGE_SIZE);
      }

      setLoading(false);
    },
    [bot]
  );

  useEffect(() => {
    if (open && bot) {
      /* eslint-disable react-hooks/set-state-in-effect -- reset panel state and fetch when the dialog opens for a bot */
      setLoading(true);
      setActivities([]);
      setComments([]);
      setAssignedTasks([]);
      /* eslint-enable react-hooks/set-state-in-effect */
      fetchData();
    }
  }, [open, bot, fetchData]);

  if (!bot) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto overflow-x-hidden [&>button]:shrink-0">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <Avatar className="h-9 w-9 shrink-0">
              {bot.avatar_url && (
                <AvatarImage src={bot.avatar_url} alt={bot.name} />
              )}
              <AvatarFallback className="text-xs">
                {bot.name.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="truncate">{bot.name}</span>
                {bot.role && (
                  <Badge variant="outline" className="text-[10px] font-normal">
                    {bot.role}
                  </Badge>
                )}
                {bot.isActiveMcpBot && (
                  <Badge className="text-[10px] font-normal bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30">
                    MCP Active
                  </Badge>
                )}
              </div>
              {!loading && feed.length > 0 && (
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Last active {formatRelativeTime(feed[0].created_at)}
                </p>
              )}
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 min-w-0">
          {/* Assigned Tasks Section */}
          <section>
            <h3 className="text-sm font-medium mb-2 flex items-center gap-1.5">
              <CheckSquare className="h-4 w-4" />
              Assigned Tasks
              {assignedTasks.length > 0 && (
                <Badge
                  variant="secondary"
                  className="text-[10px] font-normal"
                >
                  {assignedTasks.length}
                </Badge>
              )}
            </h3>
            {loading ? (
              <p className="text-xs text-muted-foreground">Loading...</p>
            ) : assignedTasks.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No tasks currently assigned
              </p>
            ) : (
              <div className="space-y-1.5">
                {assignedTasks.map((task) => (
                  <Link
                    key={task.id}
                    href={`/ideas/${task.idea.id}/board?taskId=${task.id}`}
                    className="flex items-center gap-2 rounded-md border border-border p-2 text-xs hover:bg-muted/50 transition-colors group"
                    onClick={() => onOpenChange(false)}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="truncate font-medium">{task.title}</p>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {task.idea.title}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className="text-[10px] shrink-0"
                    >
                      {task.column.title}
                    </Badge>
                    <ExternalLink className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground" />
                  </Link>
                ))}
              </div>
            )}
          </section>

          {/* Activity Feed Section (sessions) */}
          <section>
            <h3 className="text-sm font-medium mb-2 flex items-center gap-1.5">
              <Activity className="h-4 w-4" />
              Activity
              {feed.length > 0 && (
                <Badge
                  variant="secondary"
                  className="text-[10px] font-normal"
                >
                  {feed.length}
                  {hasMore ? "+" : ""}
                </Badge>
              )}
            </h3>
            {loading ? (
              <p className="text-xs text-muted-foreground">Loading...</p>
            ) : feed.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No activity recorded yet
              </p>
            ) : (
              <>
                <ScrollArea type="always" className="max-h-96 [&_[data-slot=scroll-area-viewport]>div]:!block [&_[data-slot=scroll-area-viewport]>div]:!min-w-0">
                  <div className="space-y-4 pr-3">
                    {sessions.map((session, sessionIdx) => {
                      const taskGroups = groupByTask(session);

                      return (
                        <div key={sessionIdx}>
                          {/* Session header */}
                          <div className="flex items-center gap-2 mb-2">
                            <div className="h-px flex-1 bg-border" />
                            <span className="text-[10px] text-muted-foreground shrink-0">
                              {formatSessionTime(session)}
                            </span>
                            <div className="h-px flex-1 bg-border" />
                          </div>

                          {/* Task groups within session */}
                          <div className="space-y-3">
                            {taskGroups.map((group, groupIdx) => (
                              <div key={groupIdx}>
                                {/* Task title header (shown once per group) */}
                                {group.taskTitle && (
                                  <div className="mb-1.5 min-w-0 overflow-hidden">
                                    <Link
                                      href={`/ideas/${group.ideaId}/board?taskId=${group.taskId}`}
                                      className="text-xs font-medium text-primary hover:underline truncate block"
                                      onClick={() => onOpenChange(false)}
                                      title={group.taskTitle}
                                    >
                                      {group.taskTitle}
                                    </Link>
                                    {group.ideaTitle && (
                                      <p className="text-[10px] text-muted-foreground truncate">
                                        {group.ideaTitle}
                                      </p>
                                    )}
                                  </div>
                                )}

                                {/* Compact entries */}
                                <div className="space-y-1.5 pl-2 border-l-2 border-border">
                                  {group.entries.map((entry) => {
                                    if (entry.kind === "comment") {
                                      return (
                                        <div key={entry.id} className="flex items-start gap-1.5">
                                          <MessageSquare className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground" />
                                          <div className="min-w-0 flex-1">
                                            <div className="rounded-md border border-border bg-muted/30 px-2 py-1 text-xs max-h-12 overflow-hidden relative">
                                              <p className="line-clamp-2 break-words whitespace-pre-wrap text-muted-foreground">{(entry.content ?? "").replace(/[`#*_~\[\]]/g, "").replace(/\n+/g, " ").slice(0, 200)}</p>
                                            </div>
                                            <p className="text-[10px] text-muted-foreground mt-0.5">
                                              {formatEntryTime(entry.created_at)}
                                            </p>
                                          </div>
                                        </div>
                                      );
                                    }

                                    const config = entry.action
                                      ? ACTIVITY_ACTIONS[entry.action]
                                      : undefined;
                                    const IconComponent = config
                                      ? (ICON_MAP[config.icon] ?? Activity)
                                      : Activity;
                                    const label = config?.label ?? entry.action ?? "unknown action";
                                    const detailText = formatActivityDetails(
                                      entry.action ?? "",
                                      entry.details ?? null
                                    );

                                    return (
                                      <div key={entry.id} className="flex items-center gap-1.5 min-w-0">
                                        <IconComponent className="h-3 w-3 shrink-0 text-muted-foreground" />
                                        <span className="text-xs truncate min-w-0 flex-1">
                                          {label}
                                          {detailText && (
                                            <span className="text-muted-foreground"> {detailText}</span>
                                          )}
                                        </span>
                                        <span className="text-[10px] text-muted-foreground shrink-0 ml-auto">
                                          {formatEntryTime(entry.created_at)}
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
                {hasMore && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full text-xs text-muted-foreground mt-2"
                    onClick={() => fetchData(activities.length)}
                  >
                    Load more
                  </Button>
                )}
              </>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
