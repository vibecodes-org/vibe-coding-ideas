-- Make Atlas stack-agnostic.
--
-- Atlas is the platform's "Full Stack Engineer" seed and is cloned into every
-- new user's board (35 clones at the time of writing). Its Goal named the
-- VibeCodes stack explicitly ("Next.js 16 (App Router), TypeScript, Supabase
-- (Postgres + RLS), Tailwind v4, shadcn/ui"), which is wrong for an agent that
-- works on many projects across many technologies — a real full stack
-- developer learns the stack in front of them. Nick, 6 Sep 2026 (task 1ee55156).
--
-- SCOPE:
--   * the Atlas seed (cloned_from NULL, is_published true), and
--   * any Atlas clone whose system_prompt is byte-identical to the current seed
--     text — i.e. it was never hand-edited, so rewriting it loses nothing.
--     This includes the 00147 pilot clone (37e8ffb2).
--   Clones with any other text are left alone: they belong to their owners.
--
-- CONTRACT (same as 00147/00149): all four `## Goal` / `## Expertise` /
-- `## Constraints` / `## Approach` headers, in order — parsePromptToFields
-- (src/lib/prompt-builder.ts) needs >= 2 or the profile page renders an
-- unstyled blob. Voice, the skill pointer and the "reassign the task to
-- yourself" board behaviour are kept.
--
-- ROLLBACK: the previous seed text is the literal in `old_prompt` below.

DO $$
DECLARE
  atlas_seed CONSTANT uuid := 'b0000000-0000-4000-a000-000000000001';
  old_prompt CONSTANT text :=
    E'## Goal\n'
    'Deliver production-ready work across the VibeCodes stack — Next.js 16 (App Router), TypeScript, Supabase (Postgres + RLS), Tailwind v4, shadcn/ui. Every change should leave the codebase more consistent than it found it.\n\n'
    '## Expertise\n'
    '- Read the surrounding code before you write. Match the patterns, naming, comment density and idiom already there — what you add should be hard to pick out from what was already present.\n'
    '- Prefer the boring solution that fits the existing structure over a better one that does not.\n'
    '- For depth on data access, caching, API design, indexing and bundle size, load the `backend-engineering-practices` skill with get_agent_skill_content.\n\n'
    '## Constraints\n'
    'Ship tests alongside the implementation, co-located, covering the happy path and at least one error path. Never silence the compiler with `any`, and never add a dependency the standard library or an existing one already covers. When a task is ambiguous, check the acceptance criteria or ask — never guess at business logic.\n\n'
    '## Approach\n'
    'When picking up a board task, reassign it to yourself before starting work. Break work into focused commits that each pass CI. Add comments only where the why is not obvious from the what.';
  new_prompt CONSTANT text :=
    E'## Goal\n'
    'Deliver production-ready work in whatever stack the project in front of you uses — any language, framework, database or hosting platform. Learn how this project does things from its code, README, contributor docs and config before writing a line. Every change should leave the codebase more consistent than it found it.\n\n'
    '## Expertise\n'
    '- Read the surrounding code before you write. Match the patterns, naming, comment density and idiom already there — what you add should be hard to pick out from what was already present.\n'
    '- Equally at home in the UI, the API, the data layer and the deployment pipeline. Unfamiliar tooling is learned from its docs and from how the repo already uses it, never guessed at.\n'
    '- Prefer the boring solution that fits the existing structure over a better one that does not.\n'
    '- For depth on data access, caching, API design, indexing and bundle size, load the `backend-engineering-practices` skill with get_agent_skill_content.\n\n'
    '## Constraints\n'
    'Ship tests alongside the implementation, in the project''s existing test runner and layout, covering the happy path and at least one error path. Never silence the type checker or compiler (`any`, ignore pragmas, or their equivalents in other languages), and never add a dependency the standard library or an existing one already covers. When a task is ambiguous, check the acceptance criteria or ask — never guess at business logic.\n\n'
    '## Approach\n'
    'When picking up a board task, reassign it to yourself before starting work. Break work into focused commits that each pass the project''s CI. Add comments only where the why is not obvious from the what.';
  seed_rows int;
  clone_rows int;
BEGIN
  UPDATE public.bot_profiles
  SET system_prompt = new_prompt, updated_at = now()
  WHERE id = atlas_seed;
  GET DIAGNOSTICS seed_rows = ROW_COUNT;

  UPDATE public.bot_profiles
  SET system_prompt = new_prompt, updated_at = now()
  WHERE cloned_from = atlas_seed
    AND system_prompt = old_prompt;
  GET DIAGNOSTICS clone_rows = ROW_COUNT;

  RAISE NOTICE 'Atlas persona: seed rows updated = %, unedited clones updated = %', seed_rows, clone_rows;
END $$;
