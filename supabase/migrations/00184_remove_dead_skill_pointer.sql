-- Skills always arrive now (task d04408b0): claim_next_step sends the full text
-- of the step's agent's skills inside the persona, and records which ones it
-- sent. Three data changes go with that.
--
-- 1. The Atlas prompt tells the agent to "load the `backend-engineering-practices`
--    skill with get_agent_skill_content". Only Nick's Atlas owns that skill; the
--    other 13 copies (the platform seed and 12 copies on other accounts, made
--    because copying an agent used to drop its skills) cite a skill they don't
--    have, and on Nick's Atlas it is now a redundant fetch. Remove the whole
--    bullet line (not just the sentence, which would leave an empty "- ")
--    from exactly the 14 prompts that contain it. Nothing else in any prompt
--    changes; the line is always followed by "\n\n## Constraints".
--
-- 2. Atlas (Nick's, 37e8ffb2) loses the frontend-design skill: it would now be
--    read on every build step, and its "take one real aesthetic risk" pushes
--    against Atlas's own "reproduce an approved design, never reinterpret it".
--    Compass (45d76225) keeps its identical copy.
--
-- 3. task_workflow_steps.skills_used is no longer self-reported (see the new
--    column comment below).
--
-- Idempotent: the backup is inserted once per agent, the prompt edit is guarded
-- on the line still being present, the skill delete is by id, and COMMENT is
-- repeatable.
--
-- Restore the 14 prompts (all, or add: AND b.id = '<agent id>' for one):
--   UPDATE bot_profiles b SET system_prompt = k.system_prompt, updated_at = now()
--   FROM bot_profile_prompt_backups k
--   WHERE b.id = k.bot_id AND k.reason = 'pre-skill-pointer-removal-00184';
--
-- Restore Atlas's frontend-design skill from Compass's identical copy
-- (b98d8d41-3eb0-4d01-81c8-a5893381c7af, same content md5 51c6508b..., same
-- description); id and timestamps are the deleted row's own:
--   INSERT INTO agent_skills (id, bot_id, name, description, content, source_url, category, source_type, created_at, updated_at)
--   SELECT 'd9841b57-695c-4166-9c29-ae44bf759eff', '37e8ffb2-3f88-49e5-9ab4-a516c1088f77',
--          name, description, content, source_url, category, source_type,
--          '2026-07-17 06:15:24.615926+00', '2026-07-17 06:15:24.615926+00'
--   FROM agent_skills WHERE id = 'b98d8d41-3eb0-4d01-81c8-a5893381c7af'
--   ON CONFLICT (bot_id, name) DO NOTHING;

-- 1a. Back up only the prompts about to change.
INSERT INTO public.bot_profile_prompt_backups (bot_id, name, role, system_prompt, reason)
SELECT b.id, b.name, b.role, b.system_prompt, 'pre-skill-pointer-removal-00184'
FROM public.bot_profiles b
WHERE position(
        E'\n- For depth on data access, caching, API design, indexing and bundle size, load the `backend-engineering-practices` skill with get_agent_skill_content.'
        IN b.system_prompt
      ) > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.bot_profile_prompt_backups k
    WHERE k.bot_id = b.id AND k.reason = 'pre-skill-pointer-removal-00184'
  );

-- 1b. Remove the bullet line, newline included.
UPDATE public.bot_profiles
SET system_prompt = replace(
      system_prompt,
      E'\n- For depth on data access, caching, API design, indexing and bundle size, load the `backend-engineering-practices` skill with get_agent_skill_content.',
      ''
    )
WHERE position(
        E'\n- For depth on data access, caching, API design, indexing and bundle size, load the `backend-engineering-practices` skill with get_agent_skill_content.'
        IN system_prompt
      ) > 0;

-- 2. Atlas drops frontend-design (by id, scoped to the agent and name).
DELETE FROM public.agent_skills
WHERE id = 'd9841b57-695c-4166-9c29-ae44bf759eff'
  AND bot_id = '37e8ffb2-3f88-49e5-9ab4-a516c1088f77'
  AND name = 'frontend-design';

-- 3. skills_used is now VibeCodes' own record.
COMMENT ON COLUMN public.task_workflow_steps.skills_used IS
  'Names of the skills whose full text claim_next_step sent with this step, recorded by VibeCodes at claim time (a re-claim refreshes it; complete_step/fail_step no longer write it). Empty array = the agent had no skills. NULL = never claimed since 00184. Rows from before 00184 hold what the agent reported about itself and were never verified.';
