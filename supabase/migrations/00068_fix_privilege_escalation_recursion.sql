-- Fix: prevent_privilege_escalation trigger causes stack depth recursion.
--
-- Root cause: When auth.users is updated (login/token refresh), handle_user_updated
-- cascades into UPDATE public.users, firing prevent_privilege_escalation.
-- That trigger does SELECT FROM public.users which triggers RLS policy evaluation,
-- and the admin policy itself queries public.users — causing infinite recursion
-- that hits the Postgres stack depth limit and crashes the database.
--
-- Fix: Check if sensitive columns actually changed BEFORE doing any SELECT on
-- public.users. The handle_user_updated trigger only updates full_name and
-- avatar_url (never sensitive columns), so it exits early without recursion.
-- Also restores the app.trusted_bot_operation bypass needed for create_bot_user.

CREATE OR REPLACE FUNCTION public.prevent_privilege_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_is_admin boolean;
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
     AND NEW.is_bot IS NOT DISTINCT FROM OLD.is_bot
     AND NEW.ai_enabled IS NOT DISTINCT FROM OLD.ai_enabled
     AND NEW.ai_daily_limit IS NOT DISTINCT FROM OLD.ai_daily_limit
     AND NEW.ai_starter_credits IS NOT DISTINCT FROM OLD.ai_starter_credits
  THEN
    RETURN NEW;
  END IF;

  -- Sensitive columns DID change — check if caller is admin
  SELECT COALESCE(u.is_admin, false) INTO caller_is_admin
  FROM public.users u
  WHERE u.id = auth.uid();

  -- Non-admins cannot modify sensitive columns — reset them
  IF NOT COALESCE(caller_is_admin, false) THEN
    NEW.is_admin := OLD.is_admin;
    NEW.is_bot := OLD.is_bot;
    NEW.ai_enabled := OLD.ai_enabled;
    NEW.ai_daily_limit := OLD.ai_daily_limit;
    NEW.ai_starter_credits := OLD.ai_starter_credits;
  END IF;

  RETURN NEW;
END;
$$;
