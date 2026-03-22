"use client";

import { useEffect, useState, useCallback } from "react";
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
  Bot,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useBotRoles } from "@/components/bot-roles-context";
import { createClient } from "@/lib/supabase/client";
import { formatRelativeTime } from "@/lib/utils";
import { formatActivityDetails } from "@/lib/activity-format";
import { ACTIVITY_ACTIONS } from "@/lib/constants";
import type { BoardTaskActivityWithActor } from "@/types";

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

interface ActivityTimelineProps {
  taskId: string;
  ideaId: string;
}

export function ActivityTimeline({ taskId, ideaId }: ActivityTimelineProps) {
  const botRoles = useBotRoles();
  const [activities, setActivities] = useState<BoardTaskActivityWithActor[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const PAGE_SIZE = 50;

  const fetchActivities = useCallback(
    async (offset = 0) => {
      const supabase = createClient();
      const { data } = await supabase
        .from("board_task_activity")
        .select("*, actor:users!board_task_activity_actor_id_fkey(*)")
        .eq("task_id", taskId)
        .order("created_at", { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);

      const items = (data ?? []) as unknown as BoardTaskActivityWithActor[];

      if (offset === 0) {
        setActivities(items);
      } else {
        setActivities((prev) => [...prev, ...items]);
      }
      setHasMore(items.length === PAGE_SIZE);
      setLoading(false);
    },
    [taskId]
  );

  useEffect(() => {
    fetchActivities();
  }, [fetchActivities]);

  // Realtime subscription for live updates
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`activity-${taskId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "board_task_activity",
          filter: `task_id=eq.${taskId}`,
        },
        async (payload) => {
          // Fetch the full row with actor join
          const { data } = await supabase
            .from("board_task_activity")
            .select("*, actor:users!board_task_activity_actor_id_fkey(*)")
            .eq("id", payload.new.id)
            .single();

          if (data) {
            setActivities((prev) => [
              data as unknown as BoardTaskActivityWithActor,
              ...prev,
            ]);
          }
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [taskId]);

  if (loading) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4" />
          <span className="text-sm font-medium">Activity</span>
        </div>
        <p className="text-xs text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4" />
          <span className="text-sm font-medium">Activity</span>
        </div>
        <p className="text-xs text-muted-foreground">No activity yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Activity className="h-4 w-4" />
        <span className="text-sm font-medium">Activity</span>
      </div>
      <ScrollArea className="max-h-64">
        <div className="space-y-3 pr-4">
          {activities.map((activity) => {
            const config = ACTIVITY_ACTIONS[activity.action];
            const IconComponent = config
              ? ICON_MAP[config.icon] ?? Activity
              : Activity;
            const label = config?.label ?? activity.action;
            const detailText = formatActivityDetails(
              activity.action,
              activity.details as Record<string, unknown> | null
            );

            return (
              <div key={activity.id} className="flex items-start gap-2">
                <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted">
                  <IconComponent className="h-3 w-3 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs">
                    <span className="font-medium inline-flex items-center gap-1">
                      {activity.actor?.is_bot && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Bot className="h-3 w-3 text-primary cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent>
                            {activity.actor.full_name ?? "Agent"} ({botRoles?.[activity.actor.id] ?? "Agent"})
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {activity.actor?.full_name ?? "Someone"}
                    </span>{" "}
                    {label}
                    {detailText && (
                      <span className="text-muted-foreground"> {detailText}</span>
                    )}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {formatRelativeTime(activity.created_at)}
                  </p>
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
          className="w-full text-xs text-muted-foreground"
          onClick={() => fetchActivities(activities.length)}
        >
          Load more
        </Button>
      )}
    </div>
  );
}
