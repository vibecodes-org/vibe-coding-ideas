-- Fix: decrement_starter_credit RPC silently fails because the
-- prevent_privilege_escalation trigger resets ai_starter_credits for non-admin callers.
--
-- Root cause: The RPC is SECURITY DEFINER but auth.uid() inside the trigger still
-- resolves to the calling user. When a non-admin user calls the RPC, the trigger
-- sees ai_starter_credits changed, checks is_admin (false), and resets the value
-- back to OLD.ai_starter_credits — undoing the decrement before commit.
--
-- Fix: Set app.trusted_bot_operation = 'true' inside the RPC to bypass the trigger,
-- same pattern used by create_bot_user.

CREATE OR REPLACE FUNCTION public.decrement_starter_credit(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  remaining integer;
BEGIN
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
$$;
