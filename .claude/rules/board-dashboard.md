---
paths:
  - "src/components/board/**"
  - "src/components/dashboard/**"
  - "src/lib/setup-checklist*"
---

# Area rules: board and dashboard activation (moved from CLAUDE.md)

### Board
- `BoardOpsContext` for optimistic UI — returns rollback functions
- Columns lazy-initialized on first visit; position gap: 1000
- `is_done_column` marks complete columns; dashboard excludes these + archived tasks
- Activity logged client-side via `logTaskActivity()` fire-and-forget

### Dashboard Activation
- `computeIsActivated()` in `src/lib/dashboard-activation.ts`
- Formula: `hasTasks (>=3) && (hasAgents || hasWorkflows || hasMcpConnection) && (hasUserActivity || hasMcpConnection)`
- Prevents premature graduation after onboarding auto-creates content via kits
