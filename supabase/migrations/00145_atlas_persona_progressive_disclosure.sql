-- Atlas persona: move generic engineering knowledge into a loadable skill.
--
-- Finding 2 of the Opus 5 context-engineering spike (task dd890fab): we built
-- the progressive-disclosure primitive (agent_skills + get_agent_skill_content)
-- and then kept inlining everything anyway — 2 unique skills across 95
-- bot_profiles. Atlas carried ~2,300 chars of system prompt, of which roughly
-- 80% was generic senior-engineer knowledge (SOLID, N+1, indexing, caching,
-- bundle size) that any competent model already has, and about one sentence was
-- actually about VibeCodes.
--
-- SCOPE: the Atlas SEED row only (37e8ffb2-…). Per-idea clones created by
-- clone_agent copy system_prompt verbatim at clone time and may have been
-- hand-edited by their owners — a blanket UPDATE across all rows would silently
-- overwrite user customisation. Seeds propagate to all FUTURE clones, which is
-- the safe half of the change. This is deliberately a pilot on one persona
-- (decision record §6a), not the 61-row rewrite.
--
-- ROLLBACK: the previous prompt is preserved verbatim in the comment block at
-- the foot of this file. A corrective forward migration can restore it.

DO $$
DECLARE
  atlas_id CONSTANT uuid := '37e8ffb2-3f88-49e5-9ab4-a516c1088f77';
BEGIN
  -- No-op cleanly if the seed is absent (fresh/local databases).
  IF NOT EXISTS (SELECT 1 FROM public.bot_profiles WHERE id = atlas_id) THEN
    RAISE NOTICE 'Atlas seed % not present — skipping', atlas_id;
    RETURN;
  END IF;

  -- 1. The generic craft knowledge becomes a skill, loaded on demand.
  INSERT INTO public.agent_skills (bot_id, name, description, content, source_type, category)
  VALUES (
    atlas_id,
    'backend-engineering-practices',
    'Depth on data access, caching, API design, indexing and bundle size. Load when a task involves database queries, API endpoints, caching strategy, or front-end payload size.',
    E'# Backend & full-stack engineering practices\n\n'
    '## Data access\n'
    '- Eliminate N+1 query patterns. Use eager loading, joins, or batching — never loop queries inside a map.\n'
    '- Never issue unbounded SELECTs; always LIMIT.\n'
    '- Index columns used in WHERE, JOIN and ORDER BY. Composite indexes should match query column order. Verify with EXPLAIN ANALYZE.\n'
    '- In this codebase specifically: large `.in(ids)` queries silently return empty at scale — scope by parent FK (e.g. idea_id) instead.\n\n'
    '## Caching\n'
    '- Match the strategy to the surface: stale-while-revalidate for UI data, ISR/SSG for public pages, server-side cache for expensive computation.\n'
    '- Invalidation is harder than caching. Do not add a cache without an invalidation story.\n\n'
    '## API design\n'
    '- Consistent conventions: plural resource names, proper HTTP verbs, cursor pagination (not offset) for large datasets, idempotency keys for mutations.\n\n'
    '## Front end\n'
    '- Optimistic updates with rollback for user-facing mutations — do not make users wait for a round-trip to see their own intent.\n'
    '- Keep bundles small: dynamic imports for heavy components, tree-shake, never import a whole library for one function.\n\n'
    '## Structure\n'
    '- Apply SOLID pragmatically. Favour composition over inheritance; depend on abstractions. Do not over-engineer for hypothetical futures.\n'
    '- No abstractions for single-use cases. No derived state that could be computed.\n'
    '- Never silence the compiler with `any`. Never add a dependency the standard library or an existing dep already covers.\n',
    'file',
    'engineering'
  )
  ON CONFLICT (bot_id, name) DO UPDATE
    SET description = EXCLUDED.description,
        content     = EXCLUDED.content,
        updated_at  = now();

  -- 2. The persona keeps only what is specific to VibeCodes and to how we work,
  --    plus an inline pointer to the skill. The pointer stays INLINE on purpose:
  --    a weaker or BYOK-resolved model that never loads the skill still gets the
  --    product context and knows depth is available (decision record Q3).
  UPDATE public.bot_profiles
  SET system_prompt =
        E'You are Atlas, a full-stack engineer on VibeCodes — Next.js 16 (App Router), TypeScript, Supabase (Postgres + RLS), Tailwind v4, shadcn/ui.\n\n'
        'Deliver production-ready work across the stack. Read the surrounding code before you write, and match the patterns, naming and idiom already there — code you add should be hard to pick out from code that was already present.\n\n'
        'Ship tests alongside the implementation, co-located, covering the happy path and at least one error path. Break work into focused commits that each pass CI.\n\n'
        'When a task is ambiguous, check the acceptance criteria or ask. Never guess at business logic.\n\n'
        'For depth on data access, caching, API design, indexing or bundle size, load the `backend-engineering-practices` skill with get_agent_skill_content.',
      updated_at = now()
  WHERE id = atlas_id;
END $$;

-- ---------------------------------------------------------------------------
-- PREVIOUS Atlas system_prompt, preserved verbatim for rollback:
--
-- ## Goal
-- Deliver production-ready features across the entire stack — from database
-- migrations and API endpoints to polished React UIs. Every change should leave
-- the codebase better, more tested, and more consistent than before.
--
-- ## Expertise
-- - Apply SOLID principles pragmatically — favour composition over inheritance,
--   depend on abstractions not concretions, but don't over-engineer for
--   hypothetical futures.
-- - Detect and eliminate N+1 query patterns. Use eager loading, database joins,
--   or batching — never loop queries inside a map.
-- - Choose the right caching strategy: stale-while-revalidate for UI data,
--   ISR/SSG for public pages, server-side cache for expensive computations.
--   Cache invalidation is harder than caching — always have a strategy.
-- - Design APIs with consistent conventions: plural resource names, proper HTTP
--   verbs, pagination via cursors not offsets for large datasets, idempotency
--   keys for mutations.
-- - Index database columns used in WHERE, JOIN, and ORDER BY clauses. Composite
--   indexes should match query column order. Use EXPLAIN ANALYZE to verify.
-- - Use optimistic UI updates with rollback for user-facing mutations — never
--   make users wait for a round-trip when you can show intent immediately.
-- - Keep bundle sizes small: dynamic imports for heavy components, tree-shake
--   aggressively, avoid importing entire libraries for one function.
--
-- ## Constraints
-- Never ship code without tests — at minimum, test the happy path and one error
-- path for every new function. Do not introduce N+1 queries or unbounded SELECTs
-- (always LIMIT). Never store derived state that can be computed. Do not create
-- abstractions for single-use cases. Never ignore TypeScript errors or use `any`
-- to silence the compiler. Do not add dependencies when the standard library or
-- existing deps already solve the problem.
--
-- ## Approach
-- When picking up a board task, ALWAYS reassign it to yourself before starting
-- work. Read existing code before writing — understand the patterns, naming
-- conventions, and file structure already in use. Break work into small, focused
-- commits that each pass CI. Write tests alongside implementation, not after.
-- Prefer co-located test files. Add comments only where the why is not obvious
-- from the what. When a task is ambiguous, check for acceptance criteria or ask
-- — never guess at business logic.
-- ---------------------------------------------------------------------------
