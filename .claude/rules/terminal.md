---
paths:
  - "terminal/**"
  - "src/lib/terminal/**"
  - "src/components/board/terminal-*"
  - "src/components/board/use-terminal-session*"
  - "src/app/api/terminal/**"
  - "src/lib/launch-claude-code*"
  - "src/components/board/launch-claude-code*"
---

# Area rules: in-app terminal (moved from CLAUDE.md)

### In-App Terminal (largest active workstream — most current board cards)

Runs Claude Code in the browser, against the user's **own machine**. Three
processes, bytes forwarded verbatim end to end:

```
claude --[node-pty PTY]--> BRIDGE --ws--> RELAY (CF Worker + DO) --ws--> BROWSER (xterm.js)
        (user's machine)   terminal/bridge   terminal/relay              terminal-dock.tsx
```

- **`terminal/`** (outside `src/`): `bridge/` (local Node + node-pty), `relay/`
  (Cloudflare Worker, one Durable Object per session, pairs exactly one bridge
  leg to one browser leg, enforces single-attach, never parses stream content),
  `helper/` (the installable Mac app users download), `shared/`, `test/`, and
  `RUN.md` — read RUN.md before touching any of it.
- **`src/lib/terminal/`** — the pure logic lives here and is where
  tests go: `entry-decision.ts` (reconnect vs chooser vs mint), `chooser-data.ts`
  (dedupe, 48h recent window, per-task matching), `session-registry.ts`,
  `session-cap.ts`, `session-reap.ts`, `helper-version.ts` / `helper-update-flow.ts`,
  `relay-budget.ts`, `machine-identity.ts`, `deep-link.ts`.
- **`src/components/board/terminal-*.tsx`** — `terminal-dock.tsx`
  is the orchestrator (tabs, chooser, overlays, pop-out) and is by far the most
  intricate; `terminal-session-view.tsx` owns one xterm instance.
- **API**: `src/app/api/terminal/` — `session` (mint), `session/[sid]`,
  `session/list`, `session/end`, `session/closed`, `session/reattach`,
  `helper/status`, `helper/command`. Excluded from middleware (does its own
  `supabase.auth.getUser()`).
- **Auth**: app and relay share `TERMINAL_SESSION_SECRET` (HMAC-SHA256) to sign
  short-lived, owner-bound session tokens. Never in code.

**Rules learned the hard way (each one is a fixed bug — don't regress them):**
- **Never trap the user in a dialog.** Launch dialogs were built undismissable
  on the theory that a fired launch must resolve to one outcome. Nothing is
  minted until a click, so backing out is always free and must always be
  possible — close button, Escape and outside-click, all modes.
- Swapping the dock body tears down the xterm instance, socket and scrollback —
  only use an overlay when a **live** tab genuinely needs protecting; otherwise
  render in the panel.
- A popped-out tab reports a misleading status (mid-preemption) while very much
  alive elsewhere — never read it as ended or errored.
- Sessions with no recorded folder can't be resumed; hide them from the chooser
  but keep them in the internal reconnect check.
- **The recorded project folder is always the MAIN checkout, never a worktree.**
  A second concurrent in-app session runs in `<repo>/.claude/worktrees/<id>`
  (`claude --worktree`); its `pwd` must never be stored as the project folder.
  `stripClaudeWorktreeSuffix` collapses it on every write AND read path
  (self-heals poisoned rows). Only isolate when the mint route says another
  session is already live on the board (`isolate: true`) — the first/only
  session works in the main folder. Never tell a session to `cd` between the
  two. Don't add words to the compact prompt's protected head: with the agent-guide
  step (carried by Codex launches only; Claude launches no longer carry it), the tightest realistic browser launch has almost no room left under
  `MAX_LAUNCH_URL_LENGTH` (`src/lib/terminal/deep-link.ts`). The budget is
  pinned by `launch-claude-code.guide-bootstrap.test.ts` — run it after any
  wording change.
- **The browser launch link never drops the folder to make the prompt fit.**
  `buildBoundedDeepLink` is called with `cwdPolicy: "keep"` from
  `use-terminal-session.ts`: the prompt degrades around `cwd=` (directory echo
  → full work step → compact work step → head only), and a folder that can't
  fit at all refuses to launch (toast). The old ladder dropped `cwd=` on a
  long-titled board; the bridge then spawned claude at `/` (a helper-forked
  process's cwd), the prompt said "cd in first", and the agent cd'd into and
  *recorded* another project's checkout as that board's folder (29 Aug 2026).
  The terminal-window (claude-cli://) launch keeps the default "degrade" ladder.
- **The helper resolves the project folder on the Mac before the agent
  starts; the page never sends another Mac's folder.** Order (bridge
  `folder-resolve.js`): this Mac's own saved folder if it really is the
  project → an existing checkout found by its git remote → clone into
  `~/projects/<repo>` → a new `~/projects/<board>` for a repo-less board.
  Never `/`, never home, never another Mac's row (`chooseLaunchCwdDetailed`
  only uses rows whose hostname is one of this browser's machine names).
  The bridge records the result through `/api/terminal/session/folder` under
  every name the Mac reports (its fixed `scutil --get LocalHostName` +
  ".local", plus `os.hostname()`), so one Mac with two network names stays
  one Mac. A folder it can't get ready ends the session with a reason and a
  "Start again" screen; it never starts somewhere else (card 6b2cb8ac,
  17 Oct 2026: the Mac mini opened the MacBook's folder, which didn't exist
  there, and every session died silently).
- **A bridge 1000 close ends the session at once; only an abnormal close
  gets the 90s hold.** The relay passes the bridge's reason to the browser
  and leaves a 10-minute tombstone so a late reattach gets the same reason.
  Treating a deliberate stop like a dropped link showed "Connected" plus
  "reconnecting…" for 90s, then a Resume that died again.
- **Helper control legs are per Mac.** "Update now" closes only this Mac's
  helper and ends only this Mac's sessions (`machines` on helper command /
  status / session end). A browser that knows no machine name skips the
  close and just downloads.
