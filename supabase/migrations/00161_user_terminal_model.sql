-- Per-user override for the in-app terminal's starting model (task c4ca2d95
-- "Terminal starting model" — Nick's report: sessions were starting on Opus
-- 4.8 because VibeCodes never passed a model anywhere in the launch chain).
-- Mirrors users.model_tier_map's additive/nullable posture (00134) but
-- stores a single free-text value, not a tier map, and needs a THIRD state
-- that a single nullable column can still represent (Radix Select can't
-- hold "" as an item value, so the UI needs a real sentinel string, not an
-- empty one):
--
--   NULL                    -> no override; resolve to the platform default
--                              (platform_settings key terminal_model_default
--                              -- see src/lib/terminal/platform-terminal-model.ts).
--                              If the platform default is ALSO unset, no
--                              --model flag is passed at all (Nick's binding
--                              approval-gate note: no seed value here, unlike
--                              model_tier_defaults' "opus" seed).
--   '__machine_default__'   -> explicit opt-out (AC-5): never pass --model,
--                              the user's local Claude Code config decides.
--                              Distinct from NULL so "no override" and
--                              "deliberately no model" can't collapse into
--                              the same stored value (AC-5 vs AC-6).
--   any other string        -> passed verbatim as `claude --model <value>`
--                              on the user's next FRESH terminal session
--                              (resumed sessions never receive it).
--
-- No DB-level CHECK on content — free-text family aliases/model ids by
-- design (a new model family needs no schema change), validated at the
-- server-action boundary (src/lib/terminal/model-resolution.ts,
-- validateTerminalModelValue — shared with the admin platform-default save
-- path), not here.
ALTER TABLE users
  ADD COLUMN terminal_model text;

COMMENT ON COLUMN users.terminal_model IS
  'Per-user override for the in-app terminal''s starting model. NULL = no override, use the platform default (see platform_settings.terminal_model_default); ''__machine_default__'' = explicit opt-out, never pass --model (local Claude Code config wins); any other string = passed verbatim as claude --model <value> on fresh sessions only. Validated by src/lib/terminal/model-resolution.ts, not a DB constraint.';
