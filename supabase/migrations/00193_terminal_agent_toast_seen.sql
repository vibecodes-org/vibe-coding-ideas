-- Launch button follows your remembered agent (card c4c27987, Option A) —
-- per-account "seen" flag for the one-time Undo toast shown the first time a
-- PICKER write flips the remembered agent (docs/launch-button-remembered-
-- agent-option-a-spec.html §3). No existing per-user store fits this
-- cleanly: notification_preferences is a fixed-key jsonb scoped to
-- notification toggles (see 00046's `?` existence checks against known
-- keys), and feed_preferences is a narrow view/status/sort shape (00163) —
-- neither is a general-purpose "has this account seen X" bucket, and
-- repurposing either would conflate unrelated concerns. A single nullable
-- timestamptz, mirroring users.onboarding_completed_at's own
-- seen/not-seen-via-NULL posture, is the smallest correct shape.
--
-- NULL = never shown. Set (to the time it was shown) the first time a picker
-- write changes the remembered agent while this is still NULL — regardless
-- of whether the user then clicks Undo (§3: "It is set as soon as the toast
-- is shown"). Never cleared afterwards.
ALTER TABLE public.users
  ADD COLUMN terminal_agent_toast_seen_at timestamptz;

COMMENT ON COLUMN public.users.terminal_agent_toast_seen_at IS
  'When the one-time "your launch button now starts X" Undo toast was shown for this account (docs/launch-button-remembered-agent-option-a-spec.html §3). NULL = never shown. Set once, on the first picker write that changes users.terminal_agent while this is NULL; never cleared, including by Undo.';

-- Mirrors 00170/00172's column-scoped `authenticated` SELECT grant pattern
-- (00165 revoked table-level SELECT on public.users; every column added
-- since gets an explicit grant). UPDATE needs no grant of its own — the
-- existing table-level UPDATE privilege for `authenticated` (unrestricted by
-- 00165, which only touched SELECT) already covers it, the same way
-- updateTerminalAgent's `.update({ terminal_agent })` works today with only
-- a SELECT grant on that column.
GRANT SELECT (terminal_agent_toast_seen_at) ON public.users TO authenticated;
