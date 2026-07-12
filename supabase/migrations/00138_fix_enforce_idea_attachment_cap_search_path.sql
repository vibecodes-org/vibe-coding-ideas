-- Supabase's linter flags SECURITY DEFINER functions without a pinned
-- search_path (mutable search_path lets a caller shadow `idea_attachments`
-- via a schema earlier in their session's search_path). Pin it to `public`
-- for the function created in 00137_idea_attachment_cap_trigger.sql.

ALTER FUNCTION enforce_idea_attachment_cap() SET search_path = public;
