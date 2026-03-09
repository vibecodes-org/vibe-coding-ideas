-- Defense-in-depth: Replace self-referencing admin RLS policy on public.users.
--
-- The "Admins can update any user" policy uses EXISTS(SELECT FROM users WHERE ...)
-- which causes recursive RLS evaluation when an UPDATE on public.users triggers
-- policy checks that themselves query public.users. Migration 00068 fixed the
-- immediate symptom (trigger early-return), but this eliminates the anti-pattern
-- entirely by using a SECURITY DEFINER function that bypasses RLS.

-- Step 1: Create a SECURITY DEFINER helper that checks admin status without RLS
CREATE OR REPLACE FUNCTION public.is_current_user_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_admin FROM public.users WHERE id = auth.uid()),
    false
  );
$$;

-- Step 2: Replace the self-referencing policy with one that uses the helper
DROP POLICY IF EXISTS "Admins can update any user" ON public.users;

CREATE POLICY "Admins can update any user"
  ON public.users
  FOR UPDATE
  USING (is_current_user_admin())
  WITH CHECK (is_current_user_admin());
