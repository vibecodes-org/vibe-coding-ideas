-- Make the Pixel (Front End Engineer) and Forge (Backend Engineer) platform
-- seeds stack-agnostic (board task fedbfc19).
--
-- WHY: any user can clone these seeds onto any project, but both still named
-- the VibeCodes house stack — Pixel: "React", "Next.js App Router",
-- "shadcn/ui + Tailwind v4"; Forge: ".eq("status", expected) + .maybeSingle()
-- — the house pattern", "RLS", "the Supabase client". Atlas got the same
-- treatment in 00168; these two were missed.
--
-- SCOPE: the two platform seed rows only (ids …002 and …003). Existing clones
-- are deliberately NOT touched — they are copies their owners may have edited,
-- and a clone on a Next.js/Supabase project is right to keep the specifics.
-- The change reaches future clones, the same as 00149.
--
-- METHOD: replace() of exact sentences, so only the stack-specific wording
-- changes and the rest of each prompt (including the protect-prior-work rule
-- appended by 00175) is left byte-for-byte. If a sentence has already been
-- edited, its replace() is a no-op. Idempotent on re-run.
--
-- ROLLBACK:
--   UPDATE bot_profiles b SET system_prompt = k.system_prompt, updated_at = now()
--   FROM bot_profile_prompt_backups k
--   WHERE b.id = k.bot_id AND k.reason = 'pre-stack-agnostic-00181';

INSERT INTO public.bot_profile_prompt_backups (bot_id, name, role, system_prompt, reason)
SELECT b.id, b.name, b.role, b.system_prompt, 'pre-stack-agnostic-00181'
FROM public.bot_profiles b
WHERE b.id IN ('b0000000-0000-4000-a000-000000000002', 'b0000000-0000-4000-a000-000000000003')
  AND NOT EXISTS (
    SELECT 1 FROM public.bot_profile_prompt_backups k
    WHERE k.bot_id = b.id AND k.reason = 'pre-stack-agnostic-00181'
  );

-- Pixel — Front End Engineer
UPDATE public.bot_profiles
SET system_prompt =
  replace(replace(replace(system_prompt,
    $o$Craft polished, accessible, performant React UIs consistent with the design system.$o$,
    $n$Craft polished, accessible, performant UIs in whatever front-end stack the project uses, consistent with its design system.$n$),
    $o$- Default to Server Components in the Next.js App Router; add "use client" only where interactivity lives — never promote a parent to client for one interactive child.$o$,
    $n$- Keep rendering on the server or in static markup where the framework allows; add client-side code only where interactivity lives — never move a whole parent to the client for one interactive child.$n$),
    $o$- Respect the shadcn/ui + Tailwind v4 design tokens: no hardcoded pixel values or hex colours.$o$,
    $n$- Respect the project's design tokens: no hardcoded pixel values or hex colours.$n$),
  updated_at = now()
WHERE id = 'b0000000-0000-4000-a000-000000000002'
  AND (system_prompt LIKE '%React UIs%'
    OR system_prompt LIKE '%Next.js App Router%'
    OR system_prompt LIKE '%shadcn/ui + Tailwind v4%');

-- Forge — Backend Engineer
UPDATE public.bot_profiles
SET system_prompt =
  replace(replace(replace(system_prompt,
    $o$- Design idempotent mutations: use conditional updates (.eq("status", expected) + .maybeSingle()) for state machines instead of locks — the house pattern for concurrency guards.$o$,
    $n$- Design idempotent mutations: guard state transitions with conditional updates (change the row only while it is still in the expected state) instead of locks or read-then-write.$n$),
    $o$Never create a table without RLS policies, even for "admin only" data.$o$,
    $n$Never create a table without access-control rules (row-level security or the project's equivalent), even for "admin only" data.$n$),
    $o$Never string-interpolate SQL — use the Supabase client or prepared statements.$o$,
    $n$Never string-interpolate SQL — use the project's query client or prepared statements.$n$),
  updated_at = now()
WHERE id = 'b0000000-0000-4000-a000-000000000003'
  AND (system_prompt LIKE '%maybeSingle%'
    OR system_prompt LIKE '%RLS policies%'
    OR system_prompt LIKE '%Supabase client%');
