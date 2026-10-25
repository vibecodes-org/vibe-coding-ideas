---
paths:
  - "package.json"
  - "tsconfig.json"
  - "next.config.*"
  - "src/types/index.ts"
---

# Reference: full project tree (moved from CLAUDE.md)

## Project Structure

```
src/
├── actions/       # Server actions ("use server"), one file per area
├── app/           # Next.js App Router
│   ├── (auth)/    # Login, signup, password reset, callback
│   ├── (main)/    # Admin, agents, dashboard, feed, ideas, members, profile
│   ├── api/       # AI, health, MCP, notifications, OAuth, terminal
│   ├── guide/     # Help/guide pages (incl. launching-claude-code, project-kits)
│   ├── changelog/ # Public changelog
│   └── ...        # Privacy, terms, feed.xml, .well-known
├── components/    # One directory per area; board/ is by far the largest
│   ├── ui/        # shadcn/ui primitives (don't edit except markdown.tsx)
│   └── ...        # admin, agents, ai, auth, board, comments, dashboard,
│                  # discussions, guide, ideas, kits, landing, layout,
│                  # members, onboarding, posthog, profile, pwa, shared
├── data/          # Static data (changelog entries)
├── hooks/         # Client hooks (use-user, use-realtime, use-mentions,
│                  # use-viewer-* / use-platform-* model + terminal defaults, …)
├── lib/           # Shared modules + supabase/ client setup
│                  # + terminal/ (see In-App Terminal above)
├── test/          # Test utilities
└── types/         # database.ts (manual), index.ts
mcp-server/src/    # MCP server (tools in tools/, registered in register-tools.ts)
terminal/          # bridge / relay / helper / shared / test — see In-App Terminal
middleware.ts      # at the REPO ROOT, not in src/
```
