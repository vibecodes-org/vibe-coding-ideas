"use client";

import { useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";

const DEBOUNCE_MS = 500;
const FOLLOW_UP_DELAY_MS = 1500;
const RECONNECT_DELAY_MS = 2000;
const HEALTH_CHECK_INTERVAL_MS = 30_000;

interface BoardRealtimeProps {
  ideaId: string;
  /** Task IDs on this board — used to filter unscoped table events */
  taskIds: string[];
}

export function BoardRealtime({ ideaId, taskIds }: BoardRealtimeProps) {
  const router = useRouter();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const followUpRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const healthCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Memoize task ID set for O(1) lookups in realtime callbacks
  const taskIdSet = useMemo(() => new Set(taskIds), [taskIds]);
  const taskIdSetRef = useRef(taskIdSet);
  taskIdSetRef.current = taskIdSet;

  const debouncedRefresh = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      router.refresh();
      timeoutRef.current = null;
    }, DEBOUNCE_MS);
  }, [router]);

  // Workflow step changes need a follow-up refresh to catch denormalized
  // column updates on board_tasks that may not be visible on the first read
  // due to read replica lag or Next.js RSC caching.
  const debouncedRefreshWithFollowUp = useCallback(() => {
    debouncedRefresh();
    if (followUpRef.current) clearTimeout(followUpRef.current);
    followUpRef.current = setTimeout(() => {
      router.refresh();
      followUpRef.current = null;
    }, FOLLOW_UP_DELAY_MS);
  }, [debouncedRefresh, router]);

  // Client-side filter for board_task_labels — the table has no idea_id column,
  // so we check if the task_id belongs to this board before refreshing.
  const handleTaskLabelChange = useCallback(
    (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
      const record = (payload.new && typeof payload.new === "object" && "task_id" in payload.new)
        ? payload.new
        : (payload.old && typeof payload.old === "object" && "task_id" in payload.old)
          ? payload.old
          : null;
      const taskId = record?.task_id;
      if (typeof taskId === "string" && !taskIdSetRef.current.has(taskId)) return;
      debouncedRefresh();
    },
    [debouncedRefresh]
  );

  useEffect(() => {
    const supabase = createClient();
    let disposed = false;

    function createChannel(): RealtimeChannel {
      return supabase
        .channel(`board-${ideaId}`, {
          config: { presence: { key: ideaId } },
        })
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "board_columns",
            filter: `idea_id=eq.${ideaId}`,
          },
          debouncedRefresh
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "board_tasks",
            filter: `idea_id=eq.${ideaId}`,
          },
          debouncedRefresh
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "board_labels",
            filter: `idea_id=eq.${ideaId}`,
          },
          debouncedRefresh
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "board_task_labels",
          },
          handleTaskLabelChange
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "task_workflow_steps",
            filter: `idea_id=eq.${ideaId}`,
          },
          debouncedRefreshWithFollowUp
        )
        // board_task_comments and board_task_attachments are NOT subscribed here.
        // TaskCommentsSection and TaskAttachmentsSection have their own granular,
        // task-scoped realtime subscriptions. Denormalized comment_count/attachment_count
        // on board_tasks triggers the board_tasks subscription for card badge updates.
        .on("system" as never, {} as never, (payload: { extension: string; status: string; message?: string }) => {
          if (payload.status === "error") {
            logger.warn("Board realtime system error", { ideaId, message: payload.message });
          }
        });
    }

    function reconnect() {
      if (disposed) return;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      reconnectRef.current = setTimeout(() => {
        if (disposed) return;
        logger.debug("Board realtime reconnecting", { ideaId });

        // Clean up old channel
        if (channelRef.current) {
          channelRef.current.unsubscribe();
        }

        // Create fresh channel and subscribe
        const newChannel = createChannel();
        channelRef.current = newChannel;
        newChannel.subscribe((status) => {
          if (disposed) return;
          if (status === "SUBSCRIBED") {
            logger.debug("Board realtime reconnected", { ideaId });
            // Refresh to catch any events missed during disconnect
            router.refresh();
          } else if (status === "TIMED_OUT" || status === "CHANNEL_ERROR") {
            logger.warn("Board realtime reconnect failed, retrying", { ideaId, status });
            reconnect();
          }
        });
      }, RECONNECT_DELAY_MS);
    }

    // Initial subscription
    const channel = createChannel();
    channelRef.current = channel;
    channel.subscribe((status) => {
      if (disposed) return;
      if (status === "TIMED_OUT" || status === "CHANNEL_ERROR") {
        logger.warn("Board realtime subscription failed", { ideaId, status });
        reconnect();
      }
    });

    // Periodic health check — detect silently dead channels
    healthCheckRef.current = setInterval(() => {
      if (disposed) return;
      const ch = channelRef.current;
      if (!ch) return;

      const state = ch.state;
      if (state === "closed" || state === "errored") {
        logger.warn("Board realtime channel dead, reconnecting", { ideaId, state });
        reconnect();
      }
    }, HEALTH_CHECK_INTERVAL_MS);

    return () => {
      disposed = true;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (followUpRef.current) clearTimeout(followUpRef.current);
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      if (healthCheckRef.current) clearInterval(healthCheckRef.current);
      channel.unsubscribe();
    };
  }, [ideaId, debouncedRefresh, debouncedRefreshWithFollowUp, handleTaskLabelChange, router]);

  return null;
}
