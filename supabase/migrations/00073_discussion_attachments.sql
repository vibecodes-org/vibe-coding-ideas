-- Discussion attachments: file attachments on discussions (mirrors idea_attachments pattern)

CREATE TABLE discussion_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discussion_id uuid NOT NULL REFERENCES idea_discussions(id) ON DELETE CASCADE,
  idea_id uuid NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  uploaded_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_size integer NOT NULL,
  content_type text NOT NULL,
  storage_path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_discussion_attachments_discussion ON discussion_attachments(discussion_id);

-- Denormalized attachment count on discussions
ALTER TABLE idea_discussions ADD COLUMN attachment_count integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION update_discussion_attachment_count() RETURNS trigger AS $$
BEGIN
  UPDATE idea_discussions SET attachment_count = (
    SELECT count(*) FROM discussion_attachments
    WHERE discussion_id = COALESCE(NEW.discussion_id, OLD.discussion_id)
  ) WHERE id = COALESCE(NEW.discussion_id, OLD.discussion_id);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER discussion_attachment_count_trigger
  AFTER INSERT OR DELETE ON discussion_attachments
  FOR EACH ROW EXECUTE FUNCTION update_discussion_attachment_count();

-- RLS
ALTER TABLE discussion_attachments ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can view attachments on public ideas; team members can view on private ideas
CREATE POLICY "Authenticated users can view discussion attachments for public ideas or team members"
  ON discussion_attachments FOR SELECT USING (
    is_idea_team_member(idea_id, auth.uid())
    OR (auth.uid() IS NOT NULL AND is_idea_public(idea_id))
  );

-- Only team members can upload
CREATE POLICY "Team members can insert discussion attachments"
  ON discussion_attachments FOR INSERT
  WITH CHECK (is_idea_team_member(idea_id, auth.uid()));

-- Uploader or idea author can delete
CREATE POLICY "Uploader or idea author can delete discussion attachments"
  ON discussion_attachments FOR DELETE USING (
    uploaded_by = auth.uid()
    OR EXISTS (SELECT 1 FROM ideas WHERE id = idea_id AND author_id = auth.uid())
  );

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE discussion_attachments;
ALTER TABLE discussion_attachments REPLICA IDENTITY FULL;

-- Storage bucket (private — use signed URLs for access)
INSERT INTO storage.buckets (id, name, public)
VALUES ('discussion-attachments', 'discussion-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for the discussion-attachments bucket
-- Path convention: {ideaId}/{discussionId}/{uuid}.{ext}

-- Team members can upload attachments
CREATE POLICY "Team members can upload discussion attachments"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'discussion-attachments'
  AND auth.uid() IS NOT NULL
  AND is_idea_team_member((storage.foldername(name))[1]::uuid, auth.uid())
);

-- Authenticated users can read attachments (needed for signed URL generation)
CREATE POLICY "Authenticated users can read discussion attachments"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'discussion-attachments'
  AND auth.uid() IS NOT NULL
);

-- Team members can delete attachments from their ideas
CREATE POLICY "Team members can delete discussion attachments"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'discussion-attachments'
  AND auth.uid() IS NOT NULL
  AND is_idea_team_member((storage.foldername(name))[1]::uuid, auth.uid())
);
