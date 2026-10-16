-- Starter credit RPCs check who is calling (board card 2ecca8e9; notes in
-- docs/notes/2ecca8e9.md).
--
-- decrement_starter_credit is SECURITY DEFINER, took the user to charge as an
-- argument (p_user_id) without comparing it with auth.uid(), and switches off
-- the prevent_privilege_escalation trigger (00108). EXECUTE was held by PUBLIC
-- and anon as well as authenticated, so anyone with the public anon key could
-- use up any user's starter AI credits.
--
-- It now requires p_user_id = auth.uid(), unless the caller is the service
-- role. Every app path charges the signed-in user on that user's own session
-- (server actions, the AI routes, remote MCP); the only paths that charge
-- without the user's JWT run as the service role (stdio MCP, and the
-- after-response rematch in src/actions/idea-agents.ts). The body is
-- otherwise unchanged from production (00108).
--
-- grant_starter_credits already refuses anyone who isn't a super admin; it
-- only gets a pinned search_path and the same grants (defence in depth). Its
-- body is unchanged from production (00090).
--
-- Signatures are unchanged, so callers and src/types/database.ts need no
-- change.

CREATE OR REPLACE FUNCTION public.decrement_starter_credit(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  remaining integer;
BEGIN
  -- The user charged must be the caller, except for the service role.
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
    END IF;
    IF p_user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'You can only use your own starter credits' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Bypass prevent_privilege_escalation trigger (same pattern as create_bot_user)
  PERFORM set_config('app.trusted_bot_operation', 'true', true);

  UPDATE public.users
  SET ai_starter_credits = ai_starter_credits - 1
  WHERE id = p_user_id
    AND ai_starter_credits > 0
  RETURNING ai_starter_credits INTO remaining;

  IF remaining IS NULL THEN
    -- No row was updated (credits already 0)
    RETURN 0;
  END IF;

  RETURN remaining;
END;
$function$;

CREATE OR REPLACE FUNCTION public.grant_starter_credits(p_user_id uuid, p_credits integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users WHERE id = auth.uid() AND is_super_admin = true
  ) THEN
    RAISE EXCEPTION 'Only super admins can grant starter credits';
  END IF;

  UPDATE public.users
  SET ai_starter_credits = ai_starter_credits + p_credits
  WHERE id = p_user_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.decrement_starter_credit(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.grant_starter_credits(uuid, integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.decrement_starter_credit(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.grant_starter_credits(uuid, integer) TO authenticated, service_role;
