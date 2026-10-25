---
paths:
  - "docs/release-process.md"
  - ".github/**"
  - "supabase/migrations/**"
---

# Area rules: deployment and batching merges (moved from CLAUDE.md)

## Deployment

See `docs/release-process.md` for full details.

| Environment | URL | Branch | Database |
|---|---|---|---|
| Local | http://localhost:3000 | any | Docker Supabase |
| Production | https://vibecodes.co.uk | `master` | Production Supabase project |

**Branch from `master`, PR to `master`. There is no intermediate branch.**

`develop` IS DEAD — do not target it, do not merge to it, do not "promote" through
it. Its last commit was 18 March 2026; it sits hundreds of commits behind `master`
with 4 orphaned commits of its own. Every PR since March has gone feature branch
→ `master` directly. `docs/release-process.md` still documents the old two-branch
flow and is stale on this point (it half-admits it: "features are tested via PRs
to master instead"). CI workflow files still *list* `develop` as a trigger — that
is vestigial, not a signal that it's live.

Staging (`staging.vibecodes.co.uk`) is not part of the flow either; its database
is known-broken — see the board card "Recreate staging database properly (via
Supabase Branching off prod)".

### Batching Merges

Every merge to `master` triggers one paid production build — cost scales with
merge *count*, not diff size. Batch same-area fixes (same conventional-commit
scope) when nobody is waiting: if you're about to open a second PR in the same
scope within about an hour of the first, and neither is urgent, put them in
one PR as separate commits instead.

Ship immediately, no batching, when: Nick is waiting to test it live; it fixes
something broken for users right now or reverts a regression; it's
release-coupled (helper version bump, relay deploy, migration); or it's a
different scope from the fix you're already holding. Never sit on a finished
fix more than an hour waiting for a batch-mate — when in doubt, ship it.

- Migrations: manual production trigger with approval gate (the develop→staging
  auto-apply path in `migrations.yml` no longer fires, since nothing lands on
  `develop`)
- Migrations cannot be rolled back — only corrective forward migrations
- Migrations deliberately kept off prod are listed in `supabase/migrations/.held` —
  check it before applying any "Apply migrations" card and never apply a held one
  (docs/release-process.md → "Holding a migration on purpose")
- Monitoring: Sentry (source maps), Vercel Analytics + Speed Insights, PostHog (reverse-proxied via `/ingest`)
