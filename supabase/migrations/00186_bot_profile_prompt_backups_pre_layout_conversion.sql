-- Snapshot every bot_profiles system_prompt before the one-go move of all
-- old-layout agents into the new instructions layout (task 472d5672, Nick's
-- change 1). Follows the 00148/00174 pattern: snapshot ALL rows, not just the
-- ones about to change. Idempotent on re-run.
--
-- The conversion itself is NOT in a migration. This repository is public, and
-- a migration with literal UPDATEs would publish every other user's agent
-- prompts. It runs as the "Agent layout conversion" GitHub Actions workflow
-- (scripts/convert-agent-layouts.ts) against production, and prints ids,
-- lengths and counts only. Before it rewrites a row whose text has changed
-- since this snapshot, the script takes a fresh backup under the same reason.
--
-- Put one agent back, last resort (the workflow's "restore" mode is the
-- normal route: it only restores agents still exactly as the conversion left
-- them, and uses the latest backup per agent):
--   UPDATE bot_profiles b SET system_prompt = k.system_prompt, updated_at = now()
--   FROM bot_profile_prompt_backups k
--   WHERE b.id = k.bot_id AND k.reason = 'pre-layout-conversion-00186'
--     AND b.id = '<agent id>';
-- Without the last line it restores every agent, and discards any edit made
-- since the conversion. Use it only for a deliberate full rollback.

INSERT INTO public.bot_profile_prompt_backups (bot_id, name, role, system_prompt, reason)
SELECT b.id, b.name, b.role, b.system_prompt, 'pre-layout-conversion-00186'
FROM public.bot_profiles b
WHERE NOT EXISTS (
  SELECT 1 FROM public.bot_profile_prompt_backups k
  WHERE k.bot_id = b.id AND k.reason = 'pre-layout-conversion-00186'
);
