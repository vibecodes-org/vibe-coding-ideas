-- Per-user opt-in: start FRESH in-app terminal sessions with Claude Code's
-- `--permission-mode acceptEdits` instead of the default ask-before-each-edit
-- behaviour (task d3de150c "Terminal mode"). Mirrors users.terminal_model's
-- storage/precedence MECHANISM (task c4ca2d95) but deliberately NOT its
-- vocabulary or its admin surface:
--
--   - A plain boolean, not a nullable free-text column — the only two legal
--     states are "append --permission-mode acceptEdits" or "don't", and a
--     boolean makes any other value structurally impossible to store. There
--     is no equivalent of the model column's "__machine_default__" sentinel
--     or "custom string" case: this feature has exactly one valid non-empty
--     value (the literal "acceptEdits"), enforced in code
--     (src/lib/terminal/auto-accept-mode.ts), not offered as free text here.
--   - No platform-wide default: unlike terminal_model, there is deliberately
--     NO platform_settings key for this — an admin flipping every user's
--     machine into auto-accepting file edits is an unacceptable blast
--     radius for a safety-relevant toggle. Per-user only, default false.
--
-- FALSE (default)         -> fresh sessions launch exactly as today (ask
--                             before each edit).
-- TRUE                    -> the NEXT fresh session (never a resumed one)
--                             launches with `claude --permission-mode
--                             acceptEdits` appended (bridge branch 4 only —
--                             see terminal/bridge/src/resume-cmd.js).
ALTER TABLE users
  ADD COLUMN terminal_auto_accept boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN users.terminal_auto_accept IS
  'Per-user opt-in: fresh in-app terminal sessions launch with claude --permission-mode acceptEdits when true. Default false. Never applies to a resumed/continued session. No platform-wide default exists for this column by design (safety-relevant, per-user only) — see src/lib/terminal/auto-accept-mode.ts.';
