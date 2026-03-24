-- Add mcp_connected_at column to track when a user first connects via MCP
-- This enables the UI to show real MCP connection status instead of hardcoded false
ALTER TABLE public.users ADD COLUMN mcp_connected_at TIMESTAMPTZ DEFAULT NULL;

-- Allow service role to update this column (already covered by existing RLS)
COMMENT ON COLUMN public.users.mcp_connected_at IS 'Timestamp of first MCP tool invocation by this user. Set automatically by instrument.ts on first successful tool call.';
