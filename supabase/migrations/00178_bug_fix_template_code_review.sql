-- Bug Fix platform template: root cause on frontier, test-first fix,
-- new Code Review step, "Regression Check" renamed to "Release Approval"
-- and dropped to standard (board task cb25c42a).
--
-- Platform library only. Per-board copies were updated separately through
-- the update_workflow_template MCP tool, which also propagates to active runs
-- where it can; this migration touches neither per-board templates nor runs.
-- Existing runs keep their 4-step layout (step count differs).

UPDATE workflow_library_templates
SET
  description = 'Structured bug resolution: root-cause investigation, test-first fix, code review, verification and release approval.',
  steps = $json$[
    {
      "title": "Reproduce & Investigate",
      "role": "QA Engineer",
      "model_tier": "frontier",
      "description": "This is the design step for the fix. Reproduce the bug and document exact reproduction steps. Then find the ROOT CAUSE, not just where the symptom shows up: trace it through the code, explain why it happens, and say when it started if the data shows it. Name the files/functions involved, the fix approach you recommend, and anything else that shares the same cause. If you cannot reproduce it, say so plainly and state what evidence you do have — do not guess a cause and present it as confirmed.",
      "deliverables": ["Reproduction steps", "Root cause analysis", "Recommended fix approach"],
      "requires_approval": false
    },
    {
      "title": "Implement Fix",
      "role": "Full Stack Engineer",
      "model_tier": "standard",
      "description": "Fix the root cause identified in the investigation (in `context`). Test first: write a test that reproduces the bug and FAILS before you change any code, then make it pass. If the root cause turns out to differ from the investigation, do NOT patch the symptom — call fail_step with what you found and reset back to Reproduce & Investigate. Keep the change scoped to the bug. Your output must name the failing-then-passing test and state that the full test suite passes.",
      "deliverables": ["Bug fix code", "Regression test (failed before the fix, passes after)", "Test suite passing"],
      "requires_approval": false
    },
    {
      "title": "Code Review",
      "role": "Code Reviewer",
      "model_tier": "frontier",
      "description": "Review the fix diff against the root cause analysis. Check that it fixes the cause rather than the symptom, that the regression test genuinely fails without the fix, and look for security issues, test quality, project conventions and scope creep. Blocking issues go back via fail_step (reset to Implement Fix, or to Reproduce & Investigate if the diagnosis itself is wrong) with a numbered list. Non-blocking notes go in your output.",
      "deliverables": ["Code review report (pass / blocking issues)"],
      "requires_approval": false
    },
    {
      "title": "Verify Fix",
      "role": "QA Engineer",
      "model_tier": "standard",
      "description": "Confirm the fix resolves the issue using the original reproduction steps, and check nearby behaviour for regressions.",
      "deliverables": ["Verification report"],
      "requires_approval": false
    },
    {
      "title": "Release Approval",
      "role": "Product Owner",
      "model_tier": "standard",
      "description": "Approve the fix for release. Before approving, confirm the regression test, code review and verification have all passed. Anything missing or unresolved means no approval — send it back.",
      "deliverables": ["Release approval"],
      "requires_approval": true
    }
  ]$json$::jsonb,
  updated_at = now()
WHERE name = 'Bug Fix';
