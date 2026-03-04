-- Add ai_starter_credits column to users table
-- Every new user gets 10 free AI credits (lifetime, not daily)
ALTER TABLE public.users
  ADD COLUMN ai_starter_credits integer NOT NULL DEFAULT 10;

-- Backfill: Users with a BYOK key don't need credits
UPDATE public.users
SET ai_starter_credits = 0
WHERE encrypted_anthropic_key IS NOT NULL;

-- Backfill: Users who already used platform AI get reduced credits
UPDATE public.users u
SET ai_starter_credits = GREATEST(0, 10 - sub.platform_count)
FROM (
  SELECT user_id, COUNT(*)::integer AS platform_count
  FROM public.ai_usage_log
  WHERE key_type = 'platform'
  GROUP BY user_id
) sub
WHERE u.id = sub.user_id
  AND u.encrypted_anthropic_key IS NULL;

-- RPC: Atomically decrement a starter credit, returns remaining count
CREATE OR REPLACE FUNCTION public.decrement_starter_credit(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  remaining integer;
BEGIN
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

-- RPC: Admin-only grant of starter credits
CREATE OR REPLACE FUNCTION public.grant_starter_credits(p_user_id uuid, p_credits integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Verify caller is admin
  IF NOT EXISTS (
    SELECT 1 FROM public.users WHERE id = auth.uid() AND is_admin = true
  ) THEN
    RAISE EXCEPTION 'Only admins can grant starter credits';
  END IF;

  UPDATE public.users
  SET ai_starter_credits = ai_starter_credits + p_credits
  WHERE id = p_user_id;
END;
$$;
