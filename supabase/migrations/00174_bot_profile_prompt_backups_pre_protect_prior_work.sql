-- Snapshot every bot_profiles system_prompt before the "protect prior work"
-- rollout (task 7d1ca3c1: a spawned engineer subagent reverted a prior step's
-- approved, uncommitted work on 7 Sep 2026). Follows the 00148 pattern:
-- snapshot ALL rows, not just the ones about to change. Idempotent on re-run.
--
-- Restore a single agent from this snapshot:
--   UPDATE bot_profiles b SET system_prompt = k.system_prompt, updated_at = now()
--   FROM bot_profile_prompt_backups k
--   WHERE b.id = k.bot_id AND k.reason = 'pre-protect-prior-work-00175';
--   -- add: AND b.id = '<agent id>'   to restore just one

INSERT INTO public.bot_profile_prompt_backups (bot_id, name, role, system_prompt, reason)
SELECT b.id, b.name, b.role, b.system_prompt, 'pre-protect-prior-work-00175'
FROM public.bot_profiles b
WHERE NOT EXISTS (
  SELECT 1 FROM public.bot_profile_prompt_backups k
  WHERE k.bot_id = b.id AND k.reason = 'pre-protect-prior-work-00175'
);
