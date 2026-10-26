-- Lean Build step in the platform library (board task 5e654dd1, stage 8).
--
-- WHY: on Feature Development and Web Application Feature (about 470 runs since
-- March across 11 boards), Build is the largest cost of a feature job, about
-- 7.30 of about 20 dollars. The owner decided on 26 Oct 2026 that Plan and Code
-- review stay on the top model and Test is unchanged; Build gets the same lean
-- working habits that cut the Bug Fix cost. All 11 board copies were updated the
-- same day. This brings the library (what new boards copy) into line.
--
-- Appends one paragraph to the Build step's description in both templates.
-- Tiers, roles, deliverables and step count are unchanged. Idempotent: a Build
-- step that already has the paragraph is left alone.
--
-- Data only, no schema change. Pinned by src/lib/workflow-library-lean-build.test.ts.
-- Tables and columns used: workflow_library_templates (steps, updated_at, name),
-- the same ones 00201 updates.

UPDATE public.workflow_library_templates t
SET steps = (
      SELECT jsonb_agg(
               CASE
                 WHEN e.s->>'title' = 'Build'
                  AND position('Keep the build lean.' in e.s->>'description') = 0
                 THEN jsonb_set(
                        e.s,
                        '{description}',
                        to_jsonb((e.s->>'description') || E'\n\n' || $para$Keep the build lean. The plan, the card and the working-notes file are in your brief; read the card again only if something you need is missing. Search narrowly (file paths, line numbers) and read only the lines you need, at most about 150 at a time; don't print whole large files. Do all searching yourself: don't start helper agents (they can run on the top model and cost more). Batch independent look-ups into one turn. Run the tests for the area you're changing while you work, and the full suite once at the end. Take a screenshot only to check something visual, one per check. If you're past about 80 actions on one stage, stop and check you're still building the plan rather than exploring, and say so in your output.$para$)
                      )
                 ELSE e.s
               END
               ORDER BY e.ord
             )
      FROM jsonb_array_elements(t.steps) WITH ORDINALITY AS e(s, ord)
    ),
    updated_at = now()
WHERE t.name IN ('Feature Development', 'Web Application Feature');
