-- Stage 5 (card 472d5672, also closes c1a3ca51): agent tags are gone.
--
-- The tag labels (bot_profiles.skills, a text[]) were never read by a running
-- agent, often contradicted what the agent does, and the real skills now live in
-- agent_skills. No function, view or index references the column (checked
-- read-only against the live schema, 14 Oct 2026). skills_used on workflow steps
-- is a different column and stays.
--
-- No backup is taken: these were labels only and can be rebuilt from the kit and
-- migration history.
--
-- APPLY ONLY AFTER the deploy that stops reading and writing the column is READY.
-- Until then the old code still writes it when creating agents and applying kits.

ALTER TABLE public.bot_profiles DROP COLUMN IF EXISTS skills;

-- Kits carried a per-role "skills" (tags) list inside agent_roles (jsonb).
UPDATE public.project_kits k
   SET agent_roles = (
         SELECT coalesce(jsonb_agg(e - 'skills' ORDER BY ord), '[]'::jsonb)
           FROM jsonb_array_elements(k.agent_roles) WITH ORDINALITY t(e, ord)
       )
 WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(k.agent_roles) e WHERE e ? 'skills');
