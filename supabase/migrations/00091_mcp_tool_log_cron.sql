-- MCP tool log: daily rollup to mcp_tool_stats + 30-day raw log cleanup
-- Uses pg_cron for scheduling. Includes one-time backfill of existing data.

-- 1. Enable pg_cron extension
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
GRANT USAGE ON SCHEMA cron TO postgres;

-- 2. Daily rollup function: aggregates previous day's mcp_tool_log into mcp_tool_stats
-- Idempotent via upsert on (tool_name, user_id, date) unique constraint
CREATE OR REPLACE FUNCTION public.mcp_rollup_daily_stats()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_date date := (now() AT TIME ZONE 'UTC')::date - interval '1 day';
BEGIN
  INSERT INTO mcp_tool_stats (tool_name, user_id, date, call_count, error_count, avg_duration_ms, max_duration_ms, updated_at)
  SELECT
    tool_name,
    user_id,
    target_date,
    COUNT(*)::integer,
    COUNT(*) FILTER (WHERE is_error)::integer,
    COALESCE(AVG(duration_ms)::integer, 0),
    COALESCE(MAX(duration_ms), 0),
    now()
  FROM mcp_tool_log
  WHERE created_at >= target_date::timestamptz
    AND created_at < (target_date + interval '1 day')::timestamptz
  GROUP BY tool_name, user_id
  ON CONFLICT (tool_name, user_id, date) DO UPDATE SET
    call_count = EXCLUDED.call_count,
    error_count = EXCLUDED.error_count,
    avg_duration_ms = EXCLUDED.avg_duration_ms,
    max_duration_ms = EXCLUDED.max_duration_ms,
    updated_at = now();
END;
$$;

-- 3. Cleanup function: deletes mcp_tool_log rows older than 30 days
-- Uses batch deletion (10,000 per run) to avoid long locks
CREATE OR REPLACE FUNCTION public.mcp_cleanup_old_logs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM mcp_tool_log
  WHERE id IN (
    SELECT id FROM mcp_tool_log
    WHERE created_at < now() - interval '30 days'
    LIMIT 10000
  );
END;
$$;

-- 4. Backfill function: aggregates ALL existing mcp_tool_log data into mcp_tool_stats
-- Run once during migration, then not needed again
CREATE OR REPLACE FUNCTION public.mcp_backfill_stats()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO mcp_tool_stats (tool_name, user_id, date, call_count, error_count, avg_duration_ms, max_duration_ms, updated_at)
  SELECT
    tool_name,
    user_id,
    (created_at AT TIME ZONE 'UTC')::date,
    COUNT(*)::integer,
    COUNT(*) FILTER (WHERE is_error)::integer,
    COALESCE(AVG(duration_ms)::integer, 0),
    COALESCE(MAX(duration_ms), 0),
    now()
  FROM mcp_tool_log
  GROUP BY tool_name, user_id, (created_at AT TIME ZONE 'UTC')::date
  ON CONFLICT (tool_name, user_id, date) DO UPDATE SET
    call_count = EXCLUDED.call_count,
    error_count = EXCLUDED.error_count,
    avg_duration_ms = EXCLUDED.avg_duration_ms,
    max_duration_ms = EXCLUDED.max_duration_ms,
    updated_at = now();
END;
$$;

-- 5. Run backfill immediately
SELECT public.mcp_backfill_stats();

-- 6. Schedule cron jobs
-- Rollup: daily at 02:00 UTC
SELECT cron.schedule(
  'mcp-rollup-daily-stats',
  '0 2 * * *',
  $$SELECT public.mcp_rollup_daily_stats()$$
);

-- Cleanup: daily at 03:00 UTC (1 hour after rollup)
SELECT cron.schedule(
  'mcp-cleanup-old-logs',
  '0 3 * * *',
  $$SELECT public.mcp_cleanup_old_logs()$$
);
