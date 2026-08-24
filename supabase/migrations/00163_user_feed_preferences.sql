-- Per-user, cross-device persistence for the Ideas feed filters (view/status/
-- sort). Previously these lived only in the URL search params, so every
-- fresh visit reset to defaults. Mirrors the users.notification_preferences
-- jsonb pattern (migration 00014): a small settings blob on the user row,
-- read/written via a server action (src/actions/ideas.ts) rather than a
-- dedicated preferences table, since this is a single narrow feature.
--
-- Keys are all optional — an empty object means "no saved preference, use
-- the app defaults" (all/newest/no status). See IdeaFeedPreferences in
-- src/types/index.ts.
ALTER TABLE users
  ADD COLUMN feed_preferences jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN users.feed_preferences IS
  'Saved Ideas feed filter defaults (view/status/sort) — synced across devices. Empty object = no saved preference. See IdeaFeedPreferences in src/types/index.ts.';
