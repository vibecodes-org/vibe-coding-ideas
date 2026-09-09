# Codex workflow handoff

Fix for board task `cadf403c-1b34-477d-973d-555f548fe1e9`.

## Findings

The original Codex claim instructed the parent to switch with `/model`, then
instructed it to spawn a fresh persona subagent. These target different sessions.
The smoke-test task also assumed that Codex had no subagent tool, while this
client exposes `collaboration.spawn_agent` with explicit model and effort controls.

The earlier run did submit different model/effort parameters on its three child
launches. Its incomplete telemetry came from asking the children to identify their
runtime. A child saying it cannot see its model does not establish that its launch
parameters were dropped. Conversely, a child repeating a model name from its
prompt does not verify execution. The original run therefore did not prove either
success or failure of model routing.

## Execution contract

For `agent: "codex"`, `claim_next_step` now returns an `execution` object with
the freshly resolved `model`, `reasoning_effort`, `fallback_model`, and
`fork_turns: "none"`. Auto steps have null model/effort/fallback values and do not
fetch tier settings. These are requested settings until a launch accepts them.

The parent checks its actual tool schema, passes explicit launch parameters,
and keeps the accepted configuration with the child ID. Full-history forks must
not override the requested model. A client without the necessary launch controls
reports that limitation before attempting the step; it must not simulate a
model change by writing `/model` in a message.

The child receives the full persona as instructions (in its message when there
is no system-prompt field), task requirements, step description and identifiers,
prior outputs, approval notes, rework feedback, expected deliverables, relevant
skill instructions, work token and actual working directory. The completion
token stays with the parent. Children return deliverables and loaded skill names;
the parent owns completion, failure, cascade resets and approval boundaries.

The parent records the accepted model/effort in `complete_step` or `fail_step`,
including a fallback only if it was actually launched. A runtime-reported override
takes precedence. These fields remain **orchestrator-reported configuration**,
not server-verified provider execution; this patch does not change that existing
trust boundary or the database schema. If the launch configuration is genuinely
unavailable, it remains unknown.

Claude's omitted-agent and explicit `agent: "claude"` paths retain their existing
instructions and response fields. Tests pin the complete pre-fix Claude instruction
hashes for all four tier modes, with both embedded and missing personas.

## Verification

- Unit coverage exercises Codex tier resolution, overrides, Auto, persona lookup,
  prior context, approval boundaries and launch-based completion reporting for
  primary and fallback models. These tests mock Supabase, not model inference.
- Existing Claude workflow and launch tests remain applicable, including the
  byte-compatibility checks captured before the change.
- Compact Codex launch prompts explicitly authorize per-step delegation and
  preserve the existing folder/URL-budget checks.

After deployment, repeat the three-step no-op smoke workflow with corrected
instructions: delegate each step with its freshly claimed execution settings,
return a small deliverable that uses a value from the prior step, and record the
accepted launch configuration and child ID separately from that deliverable.
Compare the launch calls with the database fields. The parent's `/model` marker
is expected to stay unchanged; the child is the step executor. Run one ordinary
Claude workflow as the live regression check. Keep the original smoke results as
historical evidence rather than rewriting them into a passing run.

Official reference: [OpenAI subagent configuration](https://learn.chatgpt.com/docs/agent-configuration/subagents)
describes explicit model/effort selection, inheritance and custom-agent overrides.
The actual client tool schema is authoritative for its supported argument names.
