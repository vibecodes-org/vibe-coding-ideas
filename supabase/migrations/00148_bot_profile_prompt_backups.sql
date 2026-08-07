-- Durable backup of every agent system_prompt before the persona-slimming rollout.
--
-- Context: the Opus 5 context-engineering spike (dd890fab) established that the
-- generic professional knowledge in our persona prompts is redundant with what
-- the model already knows — tested head-to-head on Atlas, no quality loss
-- (see task 616f7582). Rolling that reduction out to the published platform
-- seeds. Prompts are user-visible and hand-tuned, so snapshot first.
--
-- Snapshots ALL bot_profiles rows, not just the ones about to change: a full
-- point-in-time copy is cheap and makes any future prompt change restorable,
-- rather than only this one.
--
-- Restore a single agent:
--   UPDATE bot_profiles b SET system_prompt = k.system_prompt, updated_at = now()
--   FROM bot_profile_prompt_backups k
--   WHERE b.id = k.bot_id AND k.reason = 'pre-slim-rollout-00149';
--   -- add: AND b.id = '<agent id>'   to restore just one

CREATE TABLE IF NOT EXISTS public.bot_profile_prompt_backups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id UUID NOT NULL REFERENCES public.bot_profiles(id) ON DELETE CASCADE,
  name TEXT,
  role TEXT,
  system_prompt TEXT,
  reason TEXT NOT NULL,
  backed_up_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bot_prompt_backups_bot
  ON public.bot_profile_prompt_backups (bot_id, backed_up_at DESC);

CREATE INDEX IF NOT EXISTS idx_bot_prompt_backups_reason
  ON public.bot_profile_prompt_backups (reason);

COMMENT ON TABLE public.bot_profile_prompt_backups IS
  'Point-in-time snapshots of bot_profiles.system_prompt taken before bulk prompt changes. Restore by UPDATE ... FROM this table filtered on reason. Not user-facing.';

-- Admin-only: prompt text can contain owner-authored content, so this is not
-- readable by ordinary users. Service-role access only (no permissive policy).
ALTER TABLE public.bot_profile_prompt_backups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "super admins read prompt backups" ON public.bot_profile_prompt_backups;
CREATE POLICY "super admins read prompt backups"
  ON public.bot_profile_prompt_backups
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.is_super_admin = true
    )
  );

-- Take the snapshot. Idempotent on re-run: this reason is inserted once only.
INSERT INTO public.bot_profile_prompt_backups (bot_id, name, role, system_prompt, reason)
SELECT b.id, b.name, b.role, b.system_prompt, 'pre-slim-rollout-00149'
FROM public.bot_profiles b
WHERE NOT EXISTS (
  SELECT 1 FROM public.bot_profile_prompt_backups k
  WHERE k.bot_id = b.id AND k.reason = 'pre-slim-rollout-00149'
);
