"use client";

import { useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const DEBOUNCE_MS = 500;
const FOLLOW_UP_DELAY_MS = 1500;

export function BoardRealtime({ ideaId }: { ideaId: string }) {
  const router = useRouter();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const followUpRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        debouncedRefreshWithFollowUp
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
      if (followUpRef.current) clearTimeout(followUpRef.current);
      channel.unsubscribe();
    };
  }, [ideaId, debouncedRefresh, debouncedRefreshWithFollowUp]);

  return null;
}
