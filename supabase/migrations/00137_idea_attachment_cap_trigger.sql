-- Enforce the idea-attachments cap server-side.
--
-- idea_attachments rows are inserted directly from the client
-- (src/components/ideas/idea-attachments-section.tsx) rather than through a
-- server action, so the client-side cap check (MAX_IDEA_ATTACHMENTS in
-- src/lib/validation.ts, currently 10) can be bypassed by a direct API call,
-- and — even honestly used — races under concurrent uploads (multiple tabs,
-- or overlapping select/drop/paste). A BEFORE INSERT trigger counting
-- existing rows is the only race-proof enforcement available given the
-- client-direct insert pattern.
--
-- The limit is hardcoded to 10 here (matching MAX_IDEA_ATTACHMENTS) since
-- Postgres can't read the TypeScript constant; keep the two in sync if the
-- cap ever changes.

CREATE OR REPLACE FUNCTION enforce_idea_attachment_cap() RETURNS trigger AS $$
BEGIN
  IF (SELECT count(*) FROM idea_attachments WHERE idea_id = NEW.idea_id) >= 10 THEN
    RAISE EXCEPTION 'Maximum 10 attachments per idea';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS idea_attachment_cap_trigger ON idea_attachments;

CREATE TRIGGER idea_attachment_cap_trigger
  BEFORE INSERT ON idea_attachments
  FOR EACH ROW EXECUTE FUNCTION enforce_idea_attachment_cap();
