-- Migration: Fix discussion reply notification trigger
--
-- Prevents duplicate notification when the reply author is also a previous
-- replier in the same thread. The outer `u.id != NEW.author_id` guard already
-- excludes the reply author from the result set, but the inner subquery still
-- pulls the author's own earlier replies into the IN list needlessly. Adding
-- `AND author_id != NEW.author_id` to the subquery avoids that.

CREATE OR REPLACE FUNCTION notify_on_discussion_reply()
RETURNS trigger AS $$
DECLARE
  disc RECORD;
  participant RECORD;
  prefs jsonb;
BEGIN
  SELECT id, idea_id, author_id INTO disc
  FROM idea_discussions WHERE id = NEW.discussion_id;

  -- Notify discussion author + all previous repliers (excluding the reply author)
  FOR participant IN
    SELECT DISTINCT u.id, u.notification_preferences
    FROM users u
    WHERE (
      u.id = disc.author_id
      OR u.id IN (
        SELECT author_id FROM idea_discussion_replies
        WHERE discussion_id = NEW.discussion_id
          AND author_id != NEW.author_id
      )
    )
    AND u.id != NEW.author_id
  LOOP
    prefs := participant.notification_preferences;
    IF coalesce((prefs->>'comments')::boolean, true) THEN
      INSERT INTO notifications (user_id, actor_id, type, idea_id, discussion_id)
      VALUES (participant.id, NEW.author_id, 'discussion_reply', disc.idea_id, disc.id);
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
