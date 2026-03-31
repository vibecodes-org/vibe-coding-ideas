-- Presigned URL upload support: pending_uploads table for tracking
-- upload tokens between request_upload_url and confirm_upload MCP calls.
-- Also codifies the task-attachments storage bucket (previously manual).

-- 1. Ensure task-attachments bucket exists
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('task-attachments', 'task-attachments', false, 10485760)
ON CONFLICT (id) DO NOTHING;

-- 2. Pending uploads table for presigned URL flow
CREATE TABLE pending_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  idea_id UUID NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  task_id UUID NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pending_uploads_token ON pending_uploads(token);
CREATE INDEX idx_pending_uploads_expires_at ON pending_uploads(expires_at);

ALTER TABLE pending_uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own pending uploads"
  ON pending_uploads
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
