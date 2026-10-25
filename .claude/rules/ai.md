---
paths:
  - "src/lib/ai-*"
  - "src/app/api/ai/**"
  - "src/actions/ai*"
  - "docs/skills/**"
---

# Area rules: AI access and model changes (moved from CLAUDE.md)

### AI Access Resolution
- `resolveAiProvider()` in `src/lib/ai-helpers.ts`: BYOK key → platform key with credits → error
- `requireAiAccess()` for server actions (throws on failure), `getAiAccess()` for UI gating
- AI API routes use `maxDuration = 300` for Vercel function timeout

**Model update cadence**: to change the model, set `ANTHROPIC_MODEL` (or bump the default `AI_MODEL` in `src/lib/ai-helpers.ts`, which also drives `WORKFLOW_MATCHING_MODEL`). Before flipping, verify the resolved key(s) accept the new id via a real prod call that produces an `ai_usage_log` row — on the platform key AND a BYOK key (we were burned by a Haiku swap the account key rejected).

When the agents' model changes, re-check the skills listed in `docs/skills/README.md` and the gotchas in this file: run one past step of each kind without them on the new model, and remove any line it no longer needs.
