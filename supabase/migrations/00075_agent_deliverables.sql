-- Add deliverables column to bot_profiles
-- Deliverables describe what an agent produces (e.g. "design document", "test plan")
ALTER TABLE bot_profiles
  ADD COLUMN IF NOT EXISTS deliverables text[] NOT NULL DEFAULT '{}';
