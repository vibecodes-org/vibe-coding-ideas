-- The admin "User Credits & Platform Costs" table fetched ALL platform
-- ai_usage_log rows (unfiltered, .limit(5000)) and reduced them per-user
-- CLIENT-side to get platformCalls / input+output tokens / creditsUsed.
-- Past 5000 rows this silently truncates and produces wrong all-time totals,
-- and it ships thousands of raw rows to the browser just to sum them.
--
-- Fix: aggregate server-side. SECURITY INVOKER (default) keeps the EXISTING
-- ai_usage_log RLS in force for this function: "ai_usage_log_select_admin"
-- lets an admin caller see (and here, aggregate) every platform row, while a
-- non-admin caller would only aggregate their own rows — no new leak surface.

create or replace function public.get_admin_platform_credit_stats()
returns table (
  user_id uuid,
  platform_calls bigint,
  platform_input_tokens bigint,
  platform_output_tokens bigint,
  credits_used bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    l.user_id,
    count(*)::bigint,
    coalesce(sum(l.input_tokens), 0)::bigint,
    coalesce(sum(l.output_tokens), 0)::bigint,
    count(*) filter (where l.charged)::bigint
  from public.ai_usage_log l
  where l.key_type = 'platform'
  group by l.user_id;
$$;

grant execute on function public.get_admin_platform_credit_stats() to authenticated;
