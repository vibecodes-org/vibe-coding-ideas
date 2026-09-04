-- P0 fix: `notifications.comment_id` is FK-restricted to `public.comments(id)`
-- (see 00008_create_notifications.sql). On the notification-email-context
-- branch — caught in review, never merged — both the web task-comment
-- composer (task-comments-section.tsx) and the MCP mention pipeline
-- (mention-notify.ts, used by add_task_comment) wrote `board_task_comments.id`
-- into that column, a value that never satisfies the `comments(id)` FK.
-- Postgres would have rejected every one of those inserts, and both call
-- sites are fire-and-forget (the error is logged, never thrown), so a
-- task-comment @mention would have produced NEITHER an email NOR an in-app
-- notification — strictly worse than the missing-quote bug the feature set
-- out to fix. Production was never affected.
--
-- Fix: add a NEW column FK'd to the table these writers actually reference.
-- `comment_id` and its existing `comments(id)` constraint are left completely
-- untouched — they remain idea-comment-only (comment-form.tsx).
--
-- No dedicated index: `comment_id` itself has never had one in the 15+
-- migrations since it was created (00008) — matched here rather than guessed.
alter table public.notifications
  add column task_comment_id uuid references public.board_task_comments(id) on delete cascade;
