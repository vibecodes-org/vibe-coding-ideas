-- Admin "Credits Used" currently counts every platform ai_usage_log row as a
-- debit, but `free: true` is overloaded: it marks BOTH genuinely-free
-- onboarding calls AND the post-stream log write of the 3 streaming routes
-- (enhance, enhance-create, generate-tasks) that already decremented a
-- credit via chargeAiUpfront() before the stream started. Counting all rows
-- (or naively filtering on `free`) over- or under-counts real debits.
--
-- `charged` records whether THIS row actually corresponds to a decremented
-- starter credit, independent of the `free` flag passed to chargeAiUsage().
-- DEFAULT true preserves correctness for every existing charged row (direct
-- chargeAiUsage calls with no `free`, and the streaming routes' upfront
-- charge) without touching them.
ALTER TABLE ai_usage_log ADD COLUMN charged boolean NOT NULL DEFAULT true;

-- Backfill the one class of historical row that's unambiguously free: onboarding's
-- enhance_description call is only ever reached with idea_id = NULL (the idea
-- doesn't exist yet during onboarding), a combination no charged call site
-- produces for this action_type.
--
-- Onboarding's other free call — generate_board_tasks — is NOT backfillable:
-- it shares both action_type ('generate_board_tasks') and a non-null idea_id
-- with the charged generate-tasks streaming route, so historical rows can't be
-- told apart. Those rows are conservatively left charged=true (i.e. this
-- migration under-corrects the historical over-count for that one action type,
-- but never mints a false "free" row). The fix is fully correct for all rows
-- logged from this migration forward, once the app code sets `charged`
-- explicitly on every insert.
UPDATE ai_usage_log
SET charged = false
WHERE key_type = 'platform'
  AND action_type = 'enhance_description'
  AND idea_id IS NULL;
