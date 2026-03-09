-- Fix: can_view_idea() recursive RLS causing production outage
--
-- Root cause: can_view_idea() was SECURITY INVOKER, so its internal
-- SELECT FROM ideas/collaborators/users triggered RLS evaluation,
-- which called can_view_idea() again → infinite recursion → stack depth exceeded.
--
-- Fix: Change to SECURITY DEFINER so internal queries bypass RLS.
-- Also fix ideas SELECT policy to use is_current_user_admin() helper
-- (from 00069) instead of inline SELECT FROM users (which evaluates users RLS).

-- 1. Fix can_view_idea() to SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.can_view_idea(p_idea_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.ideas
    WHERE id = p_idea_id
    AND (
      visibility = 'public'
      OR author_id = auth.uid()
      OR EXISTS (SELECT 1 FROM public.collaborators WHERE idea_id = p_idea_id AND user_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_admin = true)
    )
  );
$$;

-- 2. Fix ideas SELECT policy to use SECURITY DEFINER admin helper
DROP POLICY IF EXISTS "Ideas are viewable based on visibility" ON public.ideas;

CREATE POLICY "Ideas are viewable based on visibility"
  ON public.ideas FOR SELECT
  USING (
    visibility = 'public'
    OR auth.uid() = author_id
    OR EXISTS (SELECT 1 FROM collaborators WHERE idea_id = ideas.id AND user_id = auth.uid())
    OR is_current_user_admin()
  );
