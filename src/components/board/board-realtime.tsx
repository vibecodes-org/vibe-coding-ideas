"use client";

import { useEffect, useRef, useCallback } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const DEBOUNCE_MS = 500;

// Workflow step events need a delayed hard refresh because:
// 1. The DB trigger that denormalizes counts to board_tasks may not have
//    committed by the time router.refresh() reads the data
// 2. router.refresh() can deduplicate/cache repeated calls
// 3. Supabase read replicas add additional lag
const WORKFLOW_HARD_REFRESH_DELAY = 2000;

export function BoardRealtime({ ideaId }: { ideaId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const workflowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debouncedRefresh = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      router.refresh();
      timeoutRef.current = null;
    }, DEBOUNCE_MS);
  }, [router]);

  // For workflow step changes, do an immediate router.refresh() plus a
  // delayed cache-busting navigation to guarantee the board re-renders
  // with fresh data even if router.refresh() returns stale RSC payload.
  const workflowRefresh = useCallback(() => {
    // Immediate soft refresh — may catch it if the trigger is fast
    router.refresh();

    // Delayed hard refresh — navigates to the same page with a cache-bust
    // param, forcing Next.js to fetch a completely fresh RSC payload
    if (workflowTimerRef.current) clearTimeout(workflowTimerRef.current);
    workflowTimerRef.current = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("_t", Date.now().toString());
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      workflowTimerRef.current = null;
    }, WORKFLOW_HARD_REFRESH_DELAY);
  }, [router, pathname, searchParams]);

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
      if (workflowTimerRef.current) clearTimeout(workflowTimerRef.current);
      channel.unsubscribe();
    };
  }, [ideaId, debouncedRefresh, workflowRefresh]);

  return null;
}
