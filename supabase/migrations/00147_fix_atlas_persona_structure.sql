-- Corrective forward migration for two defects in 00145.
--
-- DEFECT 1 — broke the structured-prompt contract.
-- 00145 rewrote Atlas's system_prompt as flowing prose. But system_prompt is not
-- just model input: parsePromptToFields (src/lib/prompt-builder.ts:104) parses
-- `## Goal` / `## Expertise` / `## Constraints` / `## Approach` and needs at
-- least TWO of them to treat a prompt as structured. The agent profile page and
-- the edit form both render from that parse. With zero headers the parse returns
-- null, so Atlas rendered as an unstyled text blob while every other agent
-- rendered as titled cards — visible, user-facing inconsistency.
--
-- Progressive disclosure should shorten what is INSIDE the sections. It should
-- not delete the schema the UI depends on. This migration keeps the ~2,300 →
-- ~1,200 char reduction and the skill pointer, in the four-section format.
--
-- DEFECT 2 — wrong row.
-- 00145's comment claimed it touched "the Atlas SEED row only". It did not.
-- 37e8ffb2 has cloned_from = b0000000-0000-4000-a000-000000000001, i.e. it is a
-- CLONE; the true seed is b0000000-… (cloned_from NULL, is_published true).
-- So 00145 edited a user-owned clone — the exact thing it said it would avoid —
-- and left the seed untouched, meaning future clones would still inherit the old
-- prompt. This migration does not silently "fix" that by editing the seed too:
-- the pilot is deliberately confined to the one row already changed, so its
-- output can be judged before the change propagates to anything new.
-- The seed is left exactly as it is, pending that evaluation.

DO $$
DECLARE
  atlas_clone CONSTANT uuid := '37e8ffb2-3f88-49e5-9ab4-a516c1088f77';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.bot_profiles WHERE id = atlas_clone) THEN
    RAISE NOTICE 'Atlas % not present — skipping', atlas_clone;
    RETURN;
  END IF;

  UPDATE public.bot_profiles
  SET system_prompt =
        E'## Goal\n'
        'Deliver production-ready work across the VibeCodes stack — Next.js 16 (App Router), TypeScript, Supabase (Postgres + RLS), Tailwind v4, shadcn/ui. Every change should leave the codebase more consistent than it found it.\n\n'
        '## Expertise\n'
        '- Read the surrounding code before you write. Match the patterns, naming, comment density and idiom already there — what you add should be hard to pick out from what was already present.\n'
        '- Prefer the boring solution that fits the existing structure over a better one that does not.\n'
        '- For depth on data access, caching, API design, indexing and bundle size, load the `backend-engineering-practices` skill with get_agent_skill_content.\n\n'
        '## Constraints\n'
        'Ship tests alongside the implementation, co-located, covering the happy path and at least one error path. Never silence the compiler with `any`, and never add a dependency the standard library or an existing one already covers. When a task is ambiguous, check the acceptance criteria or ask — never guess at business logic.\n\n'
        '## Approach\n'
        'When picking up a board task, reassign it to yourself before starting work. Break work into focused commits that each pass CI. Add comments only where the why is not obvious from the what.',
      updated_at = now()
  WHERE id = atlas_clone;
END $$;
