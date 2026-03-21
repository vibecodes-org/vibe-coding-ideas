-- MCP tool invocation logging tables
-- Raw logs kept for 30 days, daily rollups kept forever

-- Raw invocation log
CREATE TABLE mcp_tool_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_name text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id),
  owner_user_id uuid REFERENCES users(id),
  duration_ms integer NOT NULL DEFAULT 0,
  is_error boolean NOT NULL DEFAULT false,
  mode text NOT NULL DEFAULT 'stdio' CHECK (mode IN ('stdio', 'remote')),
  idea_id uuid REFERENCES ideas(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_mcp_tool_log_created ON mcp_tool_log (created_at DESC);
CREATE INDEX idx_mcp_tool_log_tool_created ON mcp_tool_log (tool_name, created_at DESC);

-- Daily rollup stats (kept forever for long-term trends)
CREATE TABLE mcp_tool_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_name text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id),
  date date NOT NULL,
  call_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  avg_duration_ms integer NOT NULL DEFAULT 0,
  max_duration_ms integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tool_name, user_id, date)
);

CREATE INDEX idx_mcp_tool_stats_date ON mcp_tool_stats (date DESC);
CREATE INDEX idx_mcp_tool_stats_tool ON mcp_tool_stats (tool_name, date DESC);

-- RLS
ALTER TABLE mcp_tool_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_tool_stats ENABLE ROW LEVEL SECURITY;

-- Admin can read both tables
CREATE POLICY "admin_select_mcp_tool_log" ON mcp_tool_log
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true));

CREATE POLICY "admin_select_mcp_tool_stats" ON mcp_tool_stats
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true));

-- Service role can insert into log (bypasses RLS anyway, but explicit)
CREATE POLICY "service_insert_mcp_tool_log" ON mcp_tool_log
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- Service role can insert/update stats
CREATE POLICY "service_insert_mcp_tool_stats" ON mcp_tool_stats
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "service_update_mcp_tool_stats" ON mcp_tool_stats
  FOR UPDATE TO authenticated
  USING (true);
