-- Append the "don't destroy work you didn't author" rule to Constraints for
-- all 23 platform seed agents (the original 16 plus the 7 Game-kit personas
-- added in 00173: Anchor, Tempo, Prowl, Vista, Prism, Echo, and the Sentinel
-- QA/Playtester clone, ids …017–…023) AND every existing clone of any of
-- them (clones are copies, not references — see mcp-server/src/tools/bots.ts,
-- src/actions/bots.ts, mcp-server/src/tools/kits.ts). Real incident:
-- 7 Sep 2026 (task 7d1ca3c1) — a spawned engineer subagent reverted a prior
-- step's approved, uncommitted work because it looked unexplained.
--
-- Append-only: never touches an owner's hand-edited wording elsewhere, and
-- deliberately excludes user-written agents (published or not) — scope is
-- all 23 platform agent ids plus rows cloned_from one of those ids, per
-- Nick's decision to cover every platform agent and every copy (19 Sep 2026,
-- correcting the plan's original 16-id scope which predated the Game kit).
--
-- Idempotent on re-run: guarded by the marker phrase below.
--
-- Rollback (corrective migration; caveat: overwrites any owner edit made
-- between this apply and the restore):
--   UPDATE bot_profiles b SET system_prompt = k.system_prompt, updated_at = now()
--   FROM bot_profile_prompt_backups k
--   WHERE b.id = k.bot_id AND k.reason = 'pre-protect-prior-work-00175';
--   -- add: AND b.id = '<agent id>'   to restore just one
--
-- Pre-flight / post-apply verification queries (same scope as below):
--   -- Pre-flight: blast radius before applying.
--   SELECT
--     count(*) FILTER (WHERE b.id = ANY(ARRAY[
--       'b0000000-0000-4000-a000-000000000001'::uuid, 'b0000000-0000-4000-a000-000000000002',
--       'b0000000-0000-4000-a000-000000000003', 'b0000000-0000-4000-a000-000000000004',
--       'b0000000-0000-4000-a000-000000000005', 'b0000000-0000-4000-a000-000000000006',
--       'b0000000-0000-4000-a000-000000000007', 'b0000000-0000-4000-a000-000000000008',
--       'b0000000-0000-4000-a000-000000000009', 'b0000000-0000-4000-a000-000000000010',
--       'b0000000-0000-4000-a000-000000000011', 'b0000000-0000-4000-a000-000000000012',
--       'b0000000-0000-4000-a000-000000000013', 'b0000000-0000-4000-a000-000000000014',
--       'b0000000-0000-4000-a000-000000000015', 'b0000000-0000-4000-a000-000000000016',
--       'b0000000-0000-4000-a000-000000000017', 'b0000000-0000-4000-a000-000000000018',
--       'b0000000-0000-4000-a000-000000000019', 'b0000000-0000-4000-a000-000000000020',
--       'b0000000-0000-4000-a000-000000000021', 'b0000000-0000-4000-a000-000000000022',
--       'b0000000-0000-4000-a000-000000000023'
--     ])) AS platform_seeds,
--     count(*) FILTER (WHERE b.cloned_from = ANY(ARRAY[
--       'b0000000-0000-4000-a000-000000000001'::uuid, 'b0000000-0000-4000-a000-000000000002',
--       'b0000000-0000-4000-a000-000000000003', 'b0000000-0000-4000-a000-000000000004',
--       'b0000000-0000-4000-a000-000000000005', 'b0000000-0000-4000-a000-000000000006',
--       'b0000000-0000-4000-a000-000000000007', 'b0000000-0000-4000-a000-000000000008',
--       'b0000000-0000-4000-a000-000000000009', 'b0000000-0000-4000-a000-000000000010',
--       'b0000000-0000-4000-a000-000000000011', 'b0000000-0000-4000-a000-000000000012',
--       'b0000000-0000-4000-a000-000000000013', 'b0000000-0000-4000-a000-000000000014',
--       'b0000000-0000-4000-a000-000000000015', 'b0000000-0000-4000-a000-000000000016',
--       'b0000000-0000-4000-a000-000000000017', 'b0000000-0000-4000-a000-000000000018',
--       'b0000000-0000-4000-a000-000000000019', 'b0000000-0000-4000-a000-000000000020',
--       'b0000000-0000-4000-a000-000000000021', 'b0000000-0000-4000-a000-000000000022',
--       'b0000000-0000-4000-a000-000000000023'
--     ])) AS clones,
--     count(*) FILTER (WHERE b.system_prompt IS NOT NULL AND b.system_prompt !~* '\n\n##\s*Approach\s*\n') AS in_scope_headerless,
--     max(char_length(b.system_prompt)) AS max_len
--   FROM public.bot_profiles b;
--
--   -- Post-apply: rule_applied count must equal in-scope count minus any rows
--   -- skipped by the length guard.
--   SELECT
--     count(*) FILTER (WHERE b.system_prompt LIKE '%unexplained uncommitted changes in the working tree are someone else''s intentional prior work%') AS rule_applied,
--     count(*) AS in_scope
--   FROM public.bot_profiles b
--   WHERE b.id = ANY(ARRAY[
--       'b0000000-0000-4000-a000-000000000001'::uuid, 'b0000000-0000-4000-a000-000000000002',
--       'b0000000-0000-4000-a000-000000000003', 'b0000000-0000-4000-a000-000000000004',
--       'b0000000-0000-4000-a000-000000000005', 'b0000000-0000-4000-a000-000000000006',
--       'b0000000-0000-4000-a000-000000000007', 'b0000000-0000-4000-a000-000000000008',
--       'b0000000-0000-4000-a000-000000000009', 'b0000000-0000-4000-a000-000000000010',
--       'b0000000-0000-4000-a000-000000000011', 'b0000000-0000-4000-a000-000000000012',
--       'b0000000-0000-4000-a000-000000000013', 'b0000000-0000-4000-a000-000000000014',
--       'b0000000-0000-4000-a000-000000000015', 'b0000000-0000-4000-a000-000000000016',
--       'b0000000-0000-4000-a000-000000000017', 'b0000000-0000-4000-a000-000000000018',
--       'b0000000-0000-4000-a000-000000000019', 'b0000000-0000-4000-a000-000000000020',
--       'b0000000-0000-4000-a000-000000000021', 'b0000000-0000-4000-a000-000000000022',
--       'b0000000-0000-4000-a000-000000000023'
--     ])
--     OR b.cloned_from = ANY(ARRAY[
--       'b0000000-0000-4000-a000-000000000001'::uuid, 'b0000000-0000-4000-a000-000000000002',
--       'b0000000-0000-4000-a000-000000000003', 'b0000000-0000-4000-a000-000000000004',
--       'b0000000-0000-4000-a000-000000000005', 'b0000000-0000-4000-a000-000000000006',
--       'b0000000-0000-4000-a000-000000000007', 'b0000000-0000-4000-a000-000000000008',
--       'b0000000-0000-4000-a000-000000000009', 'b0000000-0000-4000-a000-000000000010',
--       'b0000000-0000-4000-a000-000000000011', 'b0000000-0000-4000-a000-000000000012',
--       'b0000000-0000-4000-a000-000000000013', 'b0000000-0000-4000-a000-000000000014',
--       'b0000000-0000-4000-a000-000000000015', 'b0000000-0000-4000-a000-000000000016',
--       'b0000000-0000-4000-a000-000000000017', 'b0000000-0000-4000-a000-000000000018',
--       'b0000000-0000-4000-a000-000000000019', 'b0000000-0000-4000-a000-000000000020',
--       'b0000000-0000-4000-a000-000000000021', 'b0000000-0000-4000-a000-000000000022',
--       'b0000000-0000-4000-a000-000000000023'
--     ]);

DO $$
DECLARE
  v_platform_ids UUID[] := ARRAY[
    'b0000000-0000-4000-a000-000000000001'::uuid, 'b0000000-0000-4000-a000-000000000002',
    'b0000000-0000-4000-a000-000000000003', 'b0000000-0000-4000-a000-000000000004',
    'b0000000-0000-4000-a000-000000000005', 'b0000000-0000-4000-a000-000000000006',
    'b0000000-0000-4000-a000-000000000007', 'b0000000-0000-4000-a000-000000000008',
    'b0000000-0000-4000-a000-000000000009', 'b0000000-0000-4000-a000-000000000010',
    'b0000000-0000-4000-a000-000000000011', 'b0000000-0000-4000-a000-000000000012',
    'b0000000-0000-4000-a000-000000000013', 'b0000000-0000-4000-a000-000000000014',
    'b0000000-0000-4000-a000-000000000015', 'b0000000-0000-4000-a000-000000000016',
    'b0000000-0000-4000-a000-000000000017', 'b0000000-0000-4000-a000-000000000018',
    'b0000000-0000-4000-a000-000000000019', 'b0000000-0000-4000-a000-000000000020',
    'b0000000-0000-4000-a000-000000000021', 'b0000000-0000-4000-a000-000000000022',
    'b0000000-0000-4000-a000-000000000023'
  ];
  v_rule TEXT := ' Never revert, reset, `git checkout`/`restore`, `git clean`, stash, or delete changes you did not make — unexplained uncommitted changes in the working tree are someone else''s intentional prior work, not a mess to clean up. If something looks wrong, conflicting, or unexplained, STOP: report it in a comment and, if you are running a workflow step, use fail_step (with reset_to_step_id if it points at an earlier step) to send it back instead of fixing or removing it yourself.';
  v_marker TEXT := 'unexplained uncommitted changes in the working tree are someone else''s intentional prior work';
BEGIN
  UPDATE public.bot_profiles b
  SET system_prompt = CASE
      -- Has a "## Approach" header: trim any trailing whitespace off the end
      -- of Constraints (the \s* before the captured header line absorbs it,
      -- including \r\n) and insert the rule directly onto that trimmed text,
      -- followed by exactly one blank line before the (preserved) header.
      WHEN b.system_prompt ~* E'\\s*##\\s*Approach\\s*\n'
        THEN regexp_replace(b.system_prompt, E'\\s*(##\\s*Approach\\s*\n)', v_rule || E'\n\n\\1', 'i')
      -- No "## Approach" header: append at the (trimmed) end of the prompt.
      ELSE regexp_replace(b.system_prompt, E'\\s+$', '') || v_rule
    END,
    updated_at = now()
  WHERE b.system_prompt IS NOT NULL
    AND (b.id = ANY(v_platform_ids) OR b.cloned_from = ANY(v_platform_ids))
    AND b.system_prompt NOT LIKE '%' || v_marker || '%'
    AND char_length(b.system_prompt) + char_length(v_rule) <= 10000;
END $$;
