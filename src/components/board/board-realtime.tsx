"use client";

import { useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const DEBOUNCE_MS = 500;

// Workflow step events need multiple follow-up refreshes because:
// 1. The DB trigger that denormalizes counts to board_tasks may not have
//    committed by the time the first refresh reads the data
// 2. Supabase read replicas add additional lag
// 3. Rapid-fire events (complete + claim + set_identity) cause debounce
//    resets that swallow intermediate refreshes
const WORKFLOW_REFRESH_DELAYS = [500, 2000, 5000];

export function BoardRealtime({ ideaId }: { ideaId: string }) {
  const router = useRouter();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const workflowTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const debouncedRefresh = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      router.refresh();
      timeoutRef.current = null;
    }, DEBOUNCE_MS);
  }, [router]);

  // Workflow step changes fire a cascade of refreshes at increasing delays.
  // Each refresh is independent (not debounced) so rapid events can't
  // cancel later retries. Previous cascade timers are cleared when a new
  // workflow event arrives to avoid stacking.
  const workflowRefresh = useCallback(() => {
    // Clear any previous cascade timers
    for (const t of workflowTimersRef.current) clearTimeout(t);
    workflowTimersRef.current = [];

    for (const delay of WORKFLOW_REFRESH_DELAYS) {
      const timer = setTimeout(() => {
        router.refresh();
      }, delay);
      workflowTimersRef.current.push(timer);
    }
  }, [router]);

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
        debouncedRefresh
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "task_workflow_steps",
          filter: `idea_id=eq.${ideaId}`,
        },
        workflowRefresh
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "board_task_comments",
          filter: `idea_id=eq.${ideaId}`,
        },
        debouncedRefresh
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "board_task_attachments",
          filter: `idea_id=eq.${ideaId}`,
        },
        debouncedRefresh
      )
      .subscribe();

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      for (const t of workflowTimersRef.current) clearTimeout(t);
      channel.unsubscribe();
    };
  }, [ideaId, debouncedRefresh, workflowRefresh]);

  return null;
}
