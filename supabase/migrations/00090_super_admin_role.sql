-- Add is_super_admin column to users table
-- Separates destructive user-management privileges from general admin access.
-- Only super admins can delete users, grant credits, or modify user privilege fields.

ALTER TABLE public.users ADD COLUMN is_super_admin boolean NOT NULL DEFAULT false;

-- Set Nick as super admin
UPDATE public.users SET is_super_admin = true WHERE id = 'e07e3b95-f979-4281-a088-2637b2ca97e3';

-- Replace admin_delete_user RPC to require is_super_admin instead of is_admin
CREATE OR REPLACE FUNCTION admin_delete_user(target_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id uuid;
  caller_is_super_admin boolean;
  target_is_admin boolean;
BEGIN
  -- Get the caller's ID from the JWT
  caller_id := auth.uid();

  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Check if the caller is a super admin
  SELECT is_super_admin INTO caller_is_super_admin
  FROM public.users
  WHERE id = caller_id;

  IF NOT COALESCE(caller_is_super_admin, false) THEN
    RAISE EXCEPTION 'Not authorized: only super admins can delete users';
  END IF;

  -- Prevent deleting self
  IF caller_id = target_user_id THEN
    RAISE EXCEPTION 'Cannot delete yourself';
  END IF;

  -- Prevent deleting other admins
  SELECT is_admin INTO target_is_admin
  FROM public.users
  WHERE id = target_user_id;

  IF target_is_admin IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  IF target_is_admin THEN
    RAISE EXCEPTION 'Cannot delete another admin';
  END IF;

  -- Delete from auth.users — this cascades to public.users via the trigger,
  -- which then cascades to ideas, comments, votes, collaborators, etc.
  DELETE FROM auth.users WHERE id = target_user_id;
END;
$$;

-- Replace grant_starter_credits RPC to require is_super_admin
CREATE OR REPLACE FUNCTION public.grant_starter_credits(p_user_id uuid, p_credits integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Verify caller is super admin
  IF NOT EXISTS (
    SELECT 1 FROM public.users WHERE id = auth.uid() AND is_super_admin = true
  ) THEN
    RAISE EXCEPTION 'Only super admins can grant starter credits';
  END IF;

  UPDATE public.users
  SET ai_starter_credits = ai_starter_credits + p_credits
  WHERE id = p_user_id;
END;
$$;

-- Replace the "Admins can update any user" policy
-- Super admins can update any user; regular users can only update themselves
DROP POLICY IF EXISTS "Admins can update any user" ON public.users;

CREATE POLICY "Super admins can update any user"
  ON public.users FOR UPDATE
  USING (
    auth.uid() = id
    OR EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.is_super_admin = true
    )
  )
  WITH CHECK (
    auth.uid() = id
    OR EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.is_super_admin = true
    )
  );

-- Replace prevent_privilege_escalation trigger to check is_super_admin
-- and also protect the is_super_admin column itself
CREATE OR REPLACE FUNCTION public.prevent_privilege_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_is_super_admin boolean;
BEGIN
  -- Allow trusted SECURITY DEFINER functions (e.g. create_bot_user) to bypass
  IF current_setting('app.trusted_bot_operation', true) = 'true' THEN
    RETURN NEW;
  END IF;

  -- Skip when no auth context (internal service calls like GoTrue triggers)
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- If no sensitive columns changed, allow the update immediately.
  -- This is the key fix: handle_user_updated only sets full_name/avatar_url,
  -- so this early return fires before any SELECT on public.users, preventing
  -- the recursive RLS evaluation that causes stack depth overflow.
  IF NEW.is_admin IS NOT DISTINCT FROM OLD.is_admin
     AND NEW.is_super_admin IS NOT DISTINCT FROM OLD.is_super_admin
     AND NEW.is_bot IS NOT DISTINCT FROM OLD.is_bot
     AND NEW.ai_enabled IS NOT DISTINCT FROM OLD.ai_enabled
     AND NEW.ai_daily_limit IS NOT DISTINCT FROM OLD.ai_daily_limit
     AND NEW.ai_starter_credits IS NOT DISTINCT FROM OLD.ai_starter_credits
  THEN
    RETURN NEW;
  END IF;

  -- Sensitive columns DID change — check if caller is super admin
  SELECT COALESCE(u.is_super_admin, false) INTO caller_is_super_admin
  FROM public.users u
  WHERE u.id = auth.uid();

  -- Non-super-admins cannot modify sensitive columns — reset them
  IF NOT COALESCE(caller_is_super_admin, false) THEN
    NEW.is_admin := OLD.is_admin;
    NEW.is_super_admin := OLD.is_super_admin;
    NEW.is_bot := OLD.is_bot;
    NEW.ai_enabled := OLD.ai_enabled;
    NEW.ai_daily_limit := OLD.ai_daily_limit;
    NEW.ai_starter_credits := OLD.ai_starter_credits;
  END IF;

  RETURN NEW;
END;
$$;
