-- P2b: Per-user override map for model-tier -> Task-tool model resolution.
-- Additive, nullable, no backfill (NULL = no overrides, use the platform
-- defaults: frontier->fable, standard->sonnet, cheap->haiku).
--
-- No DB-level CHECK: validating the jsonb's keys/values needs a subquery
-- (jsonb_each_text over the column), and Postgres CHECK constraints cannot
-- contain subqueries. Enforcement lives in src/actions/profile.ts
-- (updateModelTierMap, Zod-validated, self-only write path).

ALTER TABLE users
  ADD COLUMN model_tier_map JSONB;

COMMENT ON COLUMN users.model_tier_map IS
  'Per-user override of the platform model-tier defaults, e.g. {"frontier":"opus"}. Keys subset of frontier|standard|cheap, values subset of fable|opus|sonnet|haiku. NULL = no overrides. Validated by src/actions/profile.ts (Zod), not a DB constraint.';
