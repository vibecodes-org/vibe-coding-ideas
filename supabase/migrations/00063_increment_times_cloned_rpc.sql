-- Atomic increment of times_cloned to avoid read-modify-write race conditions
CREATE OR REPLACE FUNCTION public.increment_times_cloned(p_bot_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE public.bot_profiles
  SET times_cloned = COALESCE(times_cloned, 0) + 1
  WHERE id = p_bot_id;
$$;
