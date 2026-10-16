-- Bot user RPCs check who is calling, not who the caller says owns the agent
-- (board card 23cecd8a; notes in docs/notes/23cecd8a.md).
--
-- create_bot_user, update_bot_user and delete_bot_user are SECURITY DEFINER
-- and took the owner as an argument (p_owner_id) without comparing it with
-- auth.uid(). EXECUTE was held by PUBLIC and anon as well as authenticated, so
-- anyone with the public anon key could create an agent in someone else's
-- name, rename or re-avatar anyone's agent, or delete anyone's agent (the
-- delete goes through auth.users and cascades to bot_profiles, agent_skills
-- and idea_agents).
--
-- Each function now requires p_owner_id = auth.uid(), unless the caller is the
-- service role (the stdio MCP server). create_bot_user also lets an admin
-- (users.is_admin, the same rule as admin_delete_bot_user and the app's
-- requireAdmin()) create agents owned by the VibeCodes platform account; that
-- is the src/actions/admin-agents.ts path. The function bodies are otherwise
-- unchanged from production (00055 / 00036 / 00038). Signatures and defaults
-- are unchanged, so callers and src/types/database.ts need no change.
--
-- Also revokes EXECUTE from PUBLIC and anon on these three and on
-- admin_delete_bot_user / admin_update_bot_user (their is_admin check already
-- holds for anon; this is defence in depth).
--
-- Production apply (16 Oct 2026) went in two parts, because the Supabase
-- connector held SQL containing a delete for a confirmation the cloud session
-- could not show: everything except delete_bot_user was recorded as
-- 00194_bot_user_rpcs_require_caller, and delete_bot_user (the same body as
-- below) as 00194b_delete_bot_user_requires_caller. The end state is this
-- whole file.

CREATE OR REPLACE FUNCTION public.create_bot_user(
  p_name text,
  p_owner_id uuid,
  p_role text DEFAULT NULL,
  p_system_prompt text DEFAULT NULL,
  p_avatar_url text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_bot_id uuid := gen_random_uuid();
  v_email text := 'bot-' || v_bot_id || '@vibecodes.local';
BEGIN
  -- The owner must be the caller, except for the service role, and for an
  -- admin creating a platform-owned (VibeCodes) agent.
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
    END IF;
    IF p_owner_id IS DISTINCT FROM auth.uid() AND NOT (
      p_owner_id = 'a0000000-0000-4000-a000-000000000001'
      AND EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_admin = true)
    ) THEN
      RAISE EXCEPTION 'You can only create agents you own' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Validate name length
  IF char_length(p_name) > 100 THEN
    RAISE EXCEPTION 'Bot name must be 100 characters or less';
  END IF;

  -- 1. Insert into auth.users (required FK for public.users)
  --    The handle_new_user() trigger auto-creates the public.users row
  INSERT INTO auth.users (
    id, instance_id, aud, role, email,
    encrypted_password, email_confirmed_at,
    raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token
  ) VALUES (
    v_bot_id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    v_email,
    '',
    now(),
    jsonb_build_object('full_name', p_name, 'avatar_url', coalesce(p_avatar_url, '')),
    now(),
    now(),
    '',
    ''
  );

  -- 2. Set bypass flag so prevent_privilege_escalation allows is_bot update.
  --    LOCAL scope = only lasts for this transaction.
  PERFORM set_config('app.trusted_bot_operation', 'true', true);

  -- 3. Update the auto-created public.users row to set bot flag
  UPDATE public.users
  SET is_bot = true, avatar_url = p_avatar_url
  WHERE id = v_bot_id;

  -- 4. Clear the bypass flag immediately
  PERFORM set_config('app.trusted_bot_operation', '', true);

  -- 5. Insert bot profile
  INSERT INTO public.bot_profiles (id, owner_id, name, role, system_prompt, avatar_url)
  VALUES (v_bot_id, p_owner_id, p_name, p_role, p_system_prompt, p_avatar_url);

  RETURN v_bot_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_bot_user(
  p_bot_id uuid,
  p_owner_id uuid,
  p_name text DEFAULT NULL,
  p_avatar_url text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  -- The owner must be the caller, except for the service role.
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
    END IF;
    IF p_owner_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Bot not found or not owned by you' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Validate the bot exists, is a bot, and is owned by the caller
  IF NOT EXISTS (
    SELECT 1 FROM public.bot_profiles
    WHERE id = p_bot_id AND owner_id = p_owner_id
  ) THEN
    RAISE EXCEPTION 'Bot not found or not owned by you';
  END IF;

  -- Update public.users to sync name and avatar
  IF p_name IS NOT NULL THEN
    UPDATE public.users SET full_name = p_name WHERE id = p_bot_id;
  END IF;

  IF p_avatar_url IS NOT NULL THEN
    UPDATE public.users SET avatar_url = p_avatar_url WHERE id = p_bot_id;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_bot_user(
  p_bot_id uuid,
  p_owner_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  -- The owner must be the caller, except for the service role.
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
    END IF;
    IF p_owner_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Bot not found or not owned by you' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Validate the bot exists and is owned by the caller
  IF NOT EXISTS (
    SELECT 1 FROM public.bot_profiles
    WHERE id = p_bot_id AND owner_id = p_owner_id
  ) THEN
    RAISE EXCEPTION 'Bot not found or not owned by you';
  END IF;

  -- Prevent deleting the default bot
  IF p_bot_id = 'a0000000-0000-4000-a000-000000000001' THEN
    RAISE EXCEPTION 'Cannot delete the default bot';
  END IF;

  -- Delete from auth.users — cascades to public.users → bot_profiles
  DELETE FROM auth.users WHERE id = p_bot_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.create_bot_user(text, uuid, text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_bot_user(uuid, uuid, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_bot_user(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_delete_bot_user(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_update_bot_user(uuid, text, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_bot_user(text, uuid, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_bot_user(uuid, uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_bot_user(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_bot_user(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_bot_user(uuid, text, text) TO authenticated, service_role;
