-- Admin-configurable platform model-tier defaults (frontier -> Opus now).
-- Greenfield key/value settings store — one jsonb row per named setting, so a
-- new model family (or, later, an unrelated platform setting) needs zero
-- schema migrations. This ships the first key: 'model_tier_defaults', which
-- replaces the previously hard-coded MODEL_TIER_TO_SUBAGENT_MODEL /
-- MODEL_TIER_FALLBACK maps (mcp-server/src/tools/workflows.ts) as the source
-- of truth read at claim time by BOTH MCP modes (stdio service-role + remote
-- per-user RLS) via the shared getPlatformModelDefaults() helper.
--
-- Value shape: { defaults: { frontier, standard, cheap }, fallback: { <alias>: <alias>, ... } }
-- Free-text strings throughout — a novel model family needs no schema change.

CREATE TABLE public.platform_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.platform_settings IS
  'Greenfield admin-configurable platform settings store, one jsonb row per key. First consumer: model_tier_defaults (P2b platform-default tier->model map + alias fallback chain), read at claim time by claim_next_step/complete_step/fail_step in both MCP modes.';
COMMENT ON COLUMN public.platform_settings.value IS
  'jsonb payload for this setting — shape is setting-specific. For model_tier_defaults: { defaults: {frontier,standard,cheap}, fallback: {<alias>:<alias>} }.';
COMMENT ON COLUMN public.platform_settings.updated_by IS
  'Super-admin who last wrote this row (audit line in the admin UI). NULL for the seed row / if that user was since deleted.';

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

-- Read: every authenticated user/bot (both MCP modes must resolve identically
-- at claim time, regardless of whose JWT is on the connection).
CREATE POLICY "platform_settings_select_authenticated"
  ON public.platform_settings FOR SELECT
  TO authenticated
  USING (true);

-- Write: super-admins only (defence in depth — the server action independently
-- re-checks is_super_admin before ever reaching this policy).
CREATE POLICY "platform_settings_write_super_admin"
  ON public.platform_settings FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.is_super_admin = true)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.is_super_admin = true)
  );

-- Seed row — the immediate required outcome: frontier's platform default is
-- now the "opus" family alias (resolves to Opus 5 today, and to whatever Opus
-- ships next); standard/cheap unchanged. Fallback chain unchanged verbatim
-- from the code constant it replaces (fable<->opus single-hop, sonnet->opus,
-- haiku->sonnet).
INSERT INTO public.platform_settings (key, value, updated_by, updated_at)
VALUES (
  'model_tier_defaults',
  jsonb_build_object(
    'defaults', jsonb_build_object('frontier', 'opus', 'standard', 'sonnet', 'cheap', 'haiku'),
    'fallback', jsonb_build_object('fable', 'opus', 'opus', 'fable', 'sonnet', 'opus', 'haiku', 'sonnet')
  ),
  NULL,
  now()
)
ON CONFLICT (key) DO NOTHING;
