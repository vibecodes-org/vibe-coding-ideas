-- Add is_sample flag to ideas table
-- Used to identify auto-created sample ideas from onboarding
ALTER TABLE ideas ADD COLUMN is_sample boolean NOT NULL DEFAULT false;

-- Prevent duplicate sample ideas per user (guards against TOCTOU race in createSampleIdea)
CREATE UNIQUE INDEX ideas_one_sample_per_user ON ideas (author_id) WHERE is_sample = true;
