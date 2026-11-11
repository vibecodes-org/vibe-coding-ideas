-- The main window's own usage, per hour and model (card f2a563ca, stage 1).
--
-- The in-app terminal helper totals each Claude conversation's main-window
-- model calls that no workflow step already took, and sends the totals here
-- (POST /api/terminal/session/usage, service role). get_cost_report reads them
-- next to the step figures. Numbers, model names, times and ids only: never
-- prompts, outputs, folder names or card text.
--
-- Figures are kept per user: every key starts with user_id, so nobody can claim
-- another user's conversation id by sending first.
--
-- Tables/columns/functions used (checked against the live schema):
--   users.id, ideas.id, is_idea_team_member(uuid, uuid), auth.uid().

CREATE TABLE session_main_usage_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idea_id uuid NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  hour timestamptz NOT NULL,
  model text NOT NULL CHECK (length(model) <= 80),
  calls numeric NOT NULL DEFAULT 0 CHECK (calls >= 0),
  input_tokens bigint NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens bigint NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  cache_read_tokens bigint NOT NULL DEFAULT 0 CHECK (cache_read_tokens >= 0),
  cache_write_5m_tokens bigint NOT NULL DEFAULT 0 CHECK (cache_write_5m_tokens >= 0),
  cache_write_1h_tokens bigint NOT NULL DEFAULT 0 CHECK (cache_write_1h_tokens >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, conversation_id, hour, model)
);

CREATE INDEX session_main_usage_hours_idea_hour_idx ON session_main_usage_hours (idea_id, hour);

CREATE TABLE session_main_usage (
  conversation_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idea_id uuid NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  machine_label text,
  first_call_at timestamptz,
  last_call_at timestamptz,
  step_ids uuid[] NOT NULL DEFAULT '{}',
  reported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, conversation_id)
);

CREATE INDEX session_main_usage_idea_idx ON session_main_usage (idea_id);

ALTER TABLE session_main_usage_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_main_usage ENABLE ROW LEVEL SECURITY;

-- Read like the step figures: the owner, or a member of the board. No insert,
-- update or delete policies: only the route writes, as the service role.
CREATE POLICY "Owner and board members can read main-window usage hours"
  ON session_main_usage_hours FOR SELECT
  USING (user_id = auth.uid() OR is_idea_team_member(idea_id, auth.uid()));

CREATE POLICY "Owner and board members can read main-window usage"
  ON session_main_usage FOR SELECT
  USING (user_id = auth.uid() OR is_idea_team_member(idea_id, auth.uid()));

COMMENT ON TABLE session_main_usage_hours IS
  'Main-window model usage per Claude conversation, hour and model, net of what workflow steps already counted (card f2a563ca). Sent by the in-app terminal helper; priced at read time.';
COMMENT ON TABLE session_main_usage IS
  'One row per Claude conversation the helper has reported main-window usage for: its board, first and last call, and the step ids it ran (card f2a563ca).';
