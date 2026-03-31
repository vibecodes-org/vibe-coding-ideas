"use client";

import { useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";

const DEBOUNCE_MS = 500;
const FOLLOW_UP_DELAY_MS = 1500;

interface BoardRealtimeProps {
  ideaId: string;
  /** Task IDs on this board — used to filter unscoped table events */
  taskIds: string[];
}

export function BoardRealtime({ ideaId, taskIds }: BoardRealtimeProps) {
  const router = useRouter();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const followUpRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

    const channel = supabase
      .channel(`board-${ideaId}`)
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
      .subscribe();

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (followUpRef.current) clearTimeout(followUpRef.current);
      channel.unsubscribe();
    };
  }, [ideaId, debouncedRefresh, debouncedRefreshWithFollowUp, handleTaskLabelChange]);

  return null;
}
