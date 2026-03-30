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
  const refreshCountRef = useRef(0);

  const debouncedRefresh = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      const count = ++refreshCountRef.current;
      console.log(`[BoardRealtime] router.refresh() #${count} (debounced)`);
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
      const count = ++refreshCountRef.current;
      console.log(`[BoardRealtime] router.refresh() #${count} (follow-up)`);
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
        (payload) => {
          console.log("[BoardRealtime] Event: board_columns", payload.eventType);
          debouncedRefresh();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "board_tasks",
          filter: `idea_id=eq.${ideaId}`,
        },
        (payload) => {
          console.log("[BoardRealtime] Event: board_tasks", payload.eventType, {
            id: payload.new && "id" in payload.new ? payload.new.id : "?",
            workflow_step_in_progress: payload.new && "workflow_step_in_progress" in payload.new ? payload.new.workflow_step_in_progress : "?",
            workflow_step_completed: payload.new && "workflow_step_completed" in payload.new ? payload.new.workflow_step_completed : "?",
            workflow_active_step_title: payload.new && "workflow_active_step_title" in payload.new ? payload.new.workflow_active_step_title : "?",
          });
          debouncedRefresh();
        }
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
        (payload) => {
          console.log("[BoardRealtime] Event: task_workflow_steps", payload.eventType, {
            id: payload.new && "id" in payload.new ? payload.new.id : "?",
            status: payload.new && "status" in payload.new ? payload.new.status : "?",
            title: payload.new && "title" in payload.new ? payload.new.title : "?",
          });
          debouncedRefreshWithFollowUp();
        }
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
      .subscribe((status) => {
        console.log(`[BoardRealtime] Subscription status: ${status}`);
      });

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (followUpRef.current) clearTimeout(followUpRef.current);
      channel.unsubscribe();
    };
  }, [ideaId, debouncedRefresh, debouncedRefreshWithFollowUp]);

  return null;
}
