---
paths:
  - "middleware.ts"
  - "src/lib/supabase/**"
  - "src/app/(auth)/**"
---

# Area rules: auth and middleware (moved from CLAUDE.md)

### Auth & Middleware
- `middleware.ts` lives at the **repo root**, not in `src/`; the protected-path list it calls into is in `src/lib/supabase/middleware.ts`
- Protected: `/dashboard`, `/ideas`, `/members`, `/profile`, `/admin`, `/agents` (**not** `/feed` — that is public)
- Matcher excludes `.well-known`, `api/mcp`, `api/oauth`, `api/terminal`, `oauth`, `callback`, `monitoring`, `ingest`, `sw.js`, static assets
- `useUser()` hook for client-side auth state
