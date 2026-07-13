"use client";

import { useEffect, useRef, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";
import { msSinceLocalBoardMutation } from "./local-mutation-signal";
import { refreshBoard } from "./board-refresh-registry";

const DEBOUNCE_MS = 500;
const FOLLOW_UP_DELAY_MS = 1500;
// While the local user is actively mutating the board (e.g. dragging cards), a
// Realtime echo of their OWN write must not trigger a refresh: the board
// already shows the change optimistically, and (historically, back when this
// refreshed via router.refresh()) the first refresh after a page load
// re-entered the force-dynamic segment's loading.tsx skeleton (the visible
// "blank flash"). Defer the refresh until the user has been idle this long so
// the self-echo is absorbed while external changes are still reconciled.
const SELF_MUTATION_WINDOW_MS = 2500;
const RECONNECT_DELAY_MS = 2000;
const HEALTH_CHECK_INTERVAL_MS = 30_000;

interface BoardRealtimeProps {
  ideaId: string;
  /** Task IDs on this board — used to filter unscoped table events */
  taskIds: string[];
}

export function BoardRealtime({ ideaId, taskIds }: BoardRealtimeProps) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const followUpRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const healthCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Memoize task ID set for O(1) lookups in realtime callbacks
  const taskIdSet = useMemo(() => new Set(taskIds), [taskIds]);
  const taskIdSetRef = useRef(taskIdSet);
  // Keep the ref in sync after render so async realtime callbacks read the
  // latest set without re-subscribing the channel. (Writing a ref during render
  // is disallowed by react-hooks/refs.)
  useEffect(() => {
    taskIdSetRef.current = taskIdSet;
  }, [taskIdSet]);

  // Client-side refetch of the LIVE board tables (board-refetch.ts), merged
  // into KanbanBoard's server-merge machinery via the board-refresh-registry
  // sibling channel. Replaces router.refresh(): a full RSC re-render always
  // re-suspends this force-dynamic segment through loading.tsx (proven not to
  // be fixable with startTransition), while a scoped client fetch + merge
  // never re-enters the Suspense boundary at all. Fire-and-forget — KanbanBoard's
  // refreshFromServer already logs and no-ops on query failure, so this can't
  // reject, but guard anyway in case KanbanBoard hasn't mounted yet.
  const runRefresh = useCallback(() => {
    refreshBoard(ideaId).catch((err) => {
      logger.warn("Board refresh callback failed", {
        ideaId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }, [ideaId]);

  const debouncedRefresh = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      // Drop the refresh if it lands within the window after a local mutation:
      // it's the Realtime echo of the user's OWN change, which the board already
      // shows optimistically (held by trusted-state). External changes arrive
      // as their own (later) events and refresh normally.
      if (msSinceLocalBoardMutation(ideaId) < SELF_MUTATION_WINDOW_MS) return;
      runRefresh();
    }, DEBOUNCE_MS);
  }, [runRefresh, ideaId]);

  // Workflow step changes need a follow-up refresh to catch denormalized
  // column updates on board_tasks that may not be visible on the first read
  // due to read replica lag or Next.js RSC caching.
  const debouncedRefreshWithFollowUp = useCallback(() => {
    debouncedRefresh();
    if (followUpRef.current) clearTimeout(followUpRef.current);
    followUpRef.current = setTimeout(() => {
      followUpRef.current = null;
      if (msSinceLocalBoardMutation(ideaId) < SELF_MUTATION_WINDOW_MS) return;
      runRefresh();
    }, FOLLOW_UP_DELAY_MS);
  }, [debouncedRefresh, runRefresh, ideaId]);

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
        // Open workflow suggestions drive the card indicator. A suggestion
        // appearing (async AI verdict over Realtime) or resolving must update
        // the card without a manual refresh. Use the follow-up variant because
        // resolving a suggestion also writes a denormalized run onto board_tasks.
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "workflow_suggestions",
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
            // Refetch to catch any events missed during disconnect — a full
            // board-refetch pulls the complete current state, so nothing is
            // "missed" the way an incremental event stream could drop one.
            runRefresh();
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
  }, [ideaId, debouncedRefresh, debouncedRefreshWithFollowUp, handleTaskLabelChange, runRefresh]);

  return null;
}
