-- Say the feature and bug-fix templates' rules plainly (board task 3784ead1).
--
-- WHY: newer models follow instructions literally and over-trigger on
-- emphasis ("Dial back any aggressive language", Anthropic prompting
-- guidance), and a reason generalises better than a shouted rule. 00179 left
-- ~26 shouted words across these templates' steps (CRITICAL, MANDATORY, MUST,
-- do NOT improvise, FAILS). Every rule's content is unchanged: same hand-off
-- contracts, same design-fidelity check, same fail-on-mismatch.
--
-- One wording fix with substance: Technical Design said the build step is "a
-- cheaper model" that "will follow exactly". That's false for anyone who maps
-- the standard tier to Opus, so it now says the plan is followed once a human
-- has approved it — the real reason not to improvise.
--
-- SCOPE: platform library templates only, same as 00179. Board copies are
-- updated through the MCP tools, and only on boards whose owner asked for it.
-- Exact-phrase replace(), so an already-edited sentence is left alone.
-- Idempotent: a second run finds nothing to replace.
--
-- ROLLBACK: the reverse replace() of each pair below.

UPDATE public.workflow_library_templates
SET steps = (
  replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(steps::text,
    'do NOT improvise around it: call fail_step', 'don''t improvise around it, because the plan is what a human approved: call fail_step'),
    ' (a cheaper model) will follow exactly', ' will follow once a human has approved it'),
    'START your output with', 'Start your output with'),
    'Your output MUST include', 'Your output must include'),
    'Your output MUST say', 'Your output must say'),
    'You MUST state explicitly, on its own line,', 'State explicitly, on its own line,'),
    'CRITICAL: your completion output MUST state', 'Your completion output must state'),
    'do a MANDATORY design-fidelity check', 'do a design-fidelity check'),
    '(do not trust the builder''s self-check)', '(the builder''s own check doesn''t count)'),
    'FAILS the step', 'fails the step'),
    'reproduces the bug and FAILS before', 'reproduces the bug and fails before'),
    'do NOT patch the symptom', 'don''t patch the symptom'),
    'on this step AND on Design Review', 'on this step and on Design Review'),
    'on this step AND on Design Check', 'on this step and on Design Check'),
    'Your completion output MUST', 'Your completion output must'),
    'output MUST', 'output must')
  )::jsonb,
  updated_at = now()
WHERE name IN ('Feature Development', 'Web Application Feature', 'Mobile App Feature',
               'API / Backend Feature', 'AI / ML Feature', 'Game Feature / Mechanic', 'Bug Fix')
  AND steps::text ~ '(do NOT improvise|a cheaper model\) will follow exactly|START your output|output MUST|You MUST state|CRITICAL:|MANDATORY design-fidelity|FAILS|do NOT patch|AND on Design)';
