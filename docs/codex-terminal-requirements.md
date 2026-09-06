# Requirements: launch Codex from VibeCodes' terminal features

**Status:** Requirements step output (Product Owner). Not a design or an implementation plan.
**Board task:** bde102c1 — "Let people launch Codex (ChatGPT's coding agent) in the browser terminal, not just Claude Code."
**Scope:** macOS only, matching the current terminal beta. **Two launch locations:** the in-browser terminal **and** a desktop Terminal window on the user's Mac.
**Date:** 6 Sep 2026 — **revised same day** after stakeholder review (see §0).

---

## 0. Revision log (what changed after Nick's review)

Nick reviewed the first draft and expanded scope. Two changes, plus a set of decisions that are now settled:

- **Change A — desktop-window Codex is in v1.** "Codex on the terminal-window launch button" was deferred in the first draft on the assumption that the terminal-window launch was ours to extend. It is not: the existing "In a terminal window" launch fires the `claude-cli://` URL scheme, which is registered and handled by **Claude Code itself (Anthropic), not VibeCodes** (comment in `launch-claude-code-button.tsx` ~line 242: "the claude-cli:// scheme is a third-party handler VibeCodes doesn't control"; our helper registers only `vibecodes://` — `setAsDefaultProtocolClient` / `LAUNCH_PREFIX` in `terminal/helper/main.js`). Codex registers no URL scheme at all. So desktop Codex has to be delivered by **our own helper app opening a real macOS Terminal window running `codex`** — a new helper capability. Specified in §2.3, US-10, FR-11–FR-14, AC-14–AC-19.
- **Change B — the board toolbar and task-card menu offer Codex explicitly.** The first draft's assumption that the toolbar's "In the browser" option went through a chooser/picker (where an agent choice could be slotted in) is **wrong**. Verified: the toolbar button body and "In a terminal window" both fire Claude's `claude-cli://` launcher; "In the browser" calls `handleLaunchInBrowser` → `requestBrowserLaunch`, which auto-launches Claude in the dock with **no picker**. Supporting Codex there is real work, and because Codex now runs in both locations the toolbar dropdown becomes **agent × location**. Specified in §2.4, US-11, FR-15, AC-20–AC-22.
- **Settled decisions (carried forward, not re-opened):** task-card ⋯ menu gets an explicit "Launch in Codex" item (no silent switching); old helper on a first-ever browser gets the attach-time "start, detect too-old, stop cleanly, show update panel" safety net and Codex is always offered; the agent pick is remembered **per account** (across devices, like the starting-model setting — small one-time DB change accepted); a 2nd Codex session sharing the folder **warns, doesn't block**; a "Codex" pill on Codex tabs only, both agents named on session-list rows; "Start with Claude Code instead" also flips the remembered pick back to Claude (intended); exact install-page URLs confirmed at implementation (placeholder); v1 is still Codex-only-if-installed (no in-app install/sign-in wizard — separate To Do card covering both agents); macOS only.

---

## 1. Problem and goal

Today every launch from VibeCodes — the in-app browser terminal **and** the "open in a terminal window on my Mac" button — starts Claude Code. People who already pay for and prefer OpenAI's Codex command-line agent can't use either.

**Goal:** wherever VibeCodes launches an agent, the user can choose **Claude Code** (default, unchanged) or **Codex**, in **either location**: the in-browser terminal or a desktop Terminal window on their Mac. Same "runs on your own machine" model, same board write-back — a different agent driving it.

**Success looks like:** a Codex user opens a board, picks Codex, and within one click is talking to Codex — in the browser or in a Terminal window, their choice — in the right project folder, with the board tools connected. No regression for Claude Code users in either location.

---

## 2. What the investigation found (grounding)

Everything below was checked against the codebase and against the real `codex` CLI (v0.135.0, installed on Nick's Mac — `codex --help`, `codex resume --help`, `codex mcp add --help`, `codex login --help`).

### 2.1 How the terminal launches Claude today

| Concern | Where | What it does today |
|---|---|---|
| Which command is spawned | `terminal/bridge/src/resume-cmd.js` → `resolveClaudeLaunch()` | Hard-codes `claude`. Four shapes: explicit `--cmd` override, `claude --resume <id>`, `claude --continue`, or a fresh `claude --session-id <uuid> [--model …] [--permission-mode auto] [--worktree <uuid>]`. |
| Starting prompt | `terminal/bridge/src/index.js` | The link's `prompt` param becomes exactly one extra argument after the command (`claude "<prompt>"`). Never shell-split. |
| Working folder | `terminal/bridge/src/index.js` | The link's `cwd` param is passed as the PTY's working directory. No `cd`, no CLI flag. |
| Finding the binary | `terminal/bridge/src/index.js` → `resolveSpawnEnv()` | Captures the user's login-shell PATH and appends `~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`. |
| "Is it installed?" check | — | **None.** Nothing checks that `claude` exists. A missing binary dies as `command not found` inside the terminal and the session ends. (The task brief's premise that the helper already detects Claude is not true.) |
| Launch link | `src/lib/terminal/deep-link.ts` + `terminal/shared/deep-link.mjs` | `vibecodes://launch?relay&session&token[&helperToken][&cwd][&resume_id|resume=1][&cols&rows][&model][&permissionMode][&worktree=1][&prompt]`. No agent param. Every optional param is whitelist-validated on parse; unknown params are ignored by old helpers (skew-safe). |
| Bootstrap prompt | `src/lib/launch-claude-code.ts` → `mcpSetupHead()` | Claude-specific: tells the agent to run `claude mcp add -s local --transport http vibecodes <url>` then use Claude Code's built-in `/mcp` sign-in. This "head" is protected from truncation and is within ~5 chars of the link's length cap for a realistic repo-backed launch. |
| Session record | `terminal_sessions` (migrations 00141, 00157) | Columns: sid, user, idea, task, machine label, cwd, status, timestamps, **`claude_session_id`**. No agent column. Also: this table is **missing from `src/types/database.ts`** (known drift, CLAUDE.md). |
| Starting model / auto-accept | `users.terminal_model`, `users.terminal_auto_accept`, mint route | Model values are **Claude model ids**; auto-accept maps to `--permission-mode auto`. Both are Claude-only semantics. |
| Concurrent sessions on one board | mint route `isolate` → bridge `--worktree` | Second live session on a board is isolated in `<repo>/.claude/worktrees/<id>` via Claude Code's native flag. |
| Terminal-window launch | `src/lib/launch-claude-code.ts` → `claude-cli://open?q=…&cwd=…` | **Handled by Claude Code (Anthropic), not by us.** VibeCodes only builds the URL (1,900-char ceiling); Claude Code's own handler opens the window, shows the prompt for review, and runs it. Our helper never sees this launch. **Not reusable for Codex** — see §2.3. |
| Helper deep-link actions | `terminal/helper/main.js` → `handleLaunchUrl()`; `terminal/shared/deep-link.mjs` → `LAUNCH_HOST = "launch"` | Registers `vibecodes://` only. **One action** (`launch`), whose only job is to validate the link and fork the in-browser bridge. It does not open Terminal.app windows or run anything visible. Any web page can fire the scheme, so the handler already pins the relay host (allowlist) before doing anything. |
| Helper version gate | `src/lib/terminal/helper-version.ts` → `MINIMUM_RECOMMENDED_HELPER_VERSION = "0.3.11"` | The app can nudge/require a helper update. |

### 2.2 What the real Codex CLI can do

| Capability | Codex (`codex` 0.135.0) | Claude Code equivalent | Verdict |
|---|---|---|---|
| Starting prompt | `codex [OPTIONS] [PROMPT]` — positional, same as Claude | `claude "<prompt>"` | **Identical.** The bridge's "one extra argv element" mechanism works unchanged. |
| Working folder | Inherits the process cwd; `-C/--cd <DIR>` also exists | inherits cwd | **Identical.** PTY cwd is enough; no flag needed. |
| Pre-assign a session id at launch | **Not available.** No `--session-id`. The id is only knowable after start (written to `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`, `session_meta.id`). | `claude --session-id <uuid>` | **Fork.** Exact-conversation Resume can't work the Claude way. |
| Resume | `codex resume <UUID>` (exact) or `codex resume --last` (most recent). Picker is folder-filtered by default (`--all` disables). | `claude --resume <id>` / `--continue` | Partial. `--last` gives Claude's legacy "most recent in this folder" behaviour; exact resume needs the id from disk (spike). |
| Isolation for a second concurrent session | **No worktree flag.** | `claude --worktree <name>` | **Fork.** Must block or warn. |
| Model | `-m/--model <MODEL>` — OpenAI ids (e.g. `gpt-5…`) | `--model <claude-id>` | **Fork.** Never pass the Claude model to Codex. |
| Auto-accept / permission mode | `-a/--ask-for-approval {untrusted,on-request,never}` + `-s/--sandbox {read-only,workspace-write,danger-full-access}`; also `--dangerously-bypass-approvals-and-sandbox` | `--permission-mode auto` | **Fork.** No one-to-one mapping; defer. |
| Connect the board (MCP) | `codex mcp add vibecodes --url <endpoint>` then `codex mcp login vibecodes` (OAuth) | `claude mcp add … ` + `/mcp` | **Fork in the prompt text only.** Same hosted endpoint. Whether Codex's OAuth login works against our MCP server end-to-end is unverified (spike). |
| Sign-in | `codex login` (browser), `--device-auth`, `--with-api-key`; stored in `~/.codex/auth.json`; `codex login status` | Claude's own login | **Nothing for us to do** — same posture as Claude: launch it, let it handle auth. |
| Install location | `~/.local/bin/codex` (npm global) or Homebrew | `~/.local/bin/claude` etc. | Already covered by the bridge's PATH fallbacks. |
| Terminal-window URL scheme | **None.** Codex is a plain CLI; nothing on the Mac answers a `codex://`-style link. | `claude-cli://` (Claude Code's own handler) | **Fork.** Desktop Codex must be opened by **our helper** — see §2.3. |

### 2.3 Desktop-window Codex: how it can actually work (Change A grounding)

The Claude desktop launch is a hand-off to a third party: we build a URL, Claude Code's own handler does everything else (opens a window, shows the prompt, runs `claude`). Codex gives us no such handler, and our helper today only knows how to fork the invisible in-browser bridge. So "Codex in a Terminal window" means: **the app fires a `vibecodes://` link with a new action → the helper opens a real Terminal window → that window runs `codex` in the right folder with the starting prompt.** Everything in that chain except the first step is new helper code, which means another helper build/notarise/release.

Realistic mechanisms for "open a Terminal window running a command in a folder" on macOS (implementation picks; none require a spike to know they exist, one needs a spike to choose):

| Option | How | Pros | Cons |
|---|---|---|---|
| **1. Launch script + `open`** | Helper writes a small executable `.command` file to its own temp dir (`cd '<folder>' && exec codex '<prompt>'`, or `exec codex --cd '<folder>' '<prompt>'`), then runs `open -a Terminal <file>` (or `open <file>.command`). | No Apple-events permission prompt; works on a notarised app with no extra entitlements; the folder and prompt never touch the shell unquoted if written with strict single-quote escaping (or read from a sibling prompt file: `codex "$(cat prompt.txt)"`). | Leaves a temp file to clean up; if the user's Terminal profile is "keep window open" they see `[Process completed]` after Codex exits; the script's shell is Terminal's login shell, so PATH may differ from the helper's — script must add the same fallbacks the bridge uses (`~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`). |
| **2. AppleScript / `osascript`** | `tell application "Terminal" to do script "cd '<folder>' && codex '<prompt>'"` then `activate`. | Directly targets a new window; can be told to reuse/close windows. | First use triggers macOS's "VibeCodes Helper wants to control Terminal" **Automation permission** prompt; requires `NSAppleEventsUsageDescription` in the helper's Info.plist and a notarisation re-check; double quoting (AppleScript string inside a shell string) is where prompt text breaks. |
| **3. `open -a Terminal <folder>`** | Opens a shell already in the folder. | Trivial. | **Can't run a command** — user would have to type `codex` and paste the prompt. Doesn't meet US-10. Reject. |

**Recommendation for Implementation:** start with option 1 (no permission prompts, fewer moving parts), with option 2 as fallback if the `[Process completed]` / PATH behaviour proves ugly in practice. The prompt goes to Codex as its **positional argument** (same as the bridge does today, one argument, never shell-split), and the folder via `cd` in the script **or** Codex's `--cd` flag — either is fine because Codex simply inherits the working folder. **Spike (S-4):** try option 1 on Nick's Mac with a realistic bootstrap prompt (quotes, newlines, `#` characters) and confirm the prompt arrives intact and the window lands in the right folder.

Two things that do **not** carry over from the browser path and must be stated plainly:

- **No session record.** A desktop Terminal window is not a relay session: nothing is minted, nothing appears in "my sessions", nothing can be resumed from VibeCodes. This exactly matches today's `claude-cli://` launch, which VibeCodes also never tracks. Resume for desktop Codex = the user types `codex resume` themselves.
- **No feedback channel by default.** With `claude-cli://` the app fires the link and hopes. For desktop Codex we own both ends, so the helper **can** tell the user what happened (native notification, or a line in the Terminal window itself). The browser only learns of a failure if the helper reports it over its existing control connection — nice-to-have, not required for v1 (FR-13).

**Security note (new attack surface).** The `vibecodes://` scheme can be fired by any web page. Today that is bounded by the relay-host allowlist and the owner-bound session token — a hostile link can't do anything useful. A "open Terminal and run a command" action is a different animal: it must **never** run an arbitrary command, only the fixed binary `codex`; the folder must be an existing directory; and — matching the safety property the `claude-cli://` comment relies on ("this scheme always shows the user the prefilled prompt before Claude Code runs it") — the user must see and confirm before Codex starts, **or** the launch must be verified as coming from the signed-in VibeCodes account (e.g. a short-lived signed token the helper checks via its control connection). Which of those two is the v1 answer is decision **S-5** (spike/decision for UX Design + Implementation); "run silently on an unauthenticated link" is not an option.

### 2.4 Where launches are offered today (Change B grounding)

| Surface | Component | What each control does today |
|---|---|---|
| Board toolbar split button | `launch-claude-code-button.tsx` (`variant: "board"`) | **Button body** → `handleLaunch` → `claude-cli://` (Claude desktop). **Dropdown "In a terminal window"** → same. **Dropdown "In the browser"** → `handleLaunchInBrowser` → `requestBrowserLaunch()` → the dock **auto-launches Claude** immediately. **No picker anywhere.** |
| Task-card ⋯ menu | same component (`variant: "task-menu-item"`), used by `task-card-menu.tsx` | "Launch in Claude Code" → `claude-cli://`; "Launch in browser terminal" → auto-launch Claude in the dock. |
| Task detail header icon | same component (`variant: "task-icon"`) | Single icon → `claude-cli://`. |
| Terminal dock chooser "Start new session" | `terminal-dock.tsx` | The only place a fresh browser session goes through a UI step before launching — this is where the first draft assumed the picker would live. |

So the original FR-4 ("wherever a fresh browser session is started, the user can pick") was aspirational for the toolbar and card menu: those two are one-click auto-launchers. Change B keeps them one-click (no forced extra picker step) by making the **agent part of the menu item**.

---

## 3. Answers to the open questions

**Q1. Does Codex take an initial prompt and a working directory as cleanly as `claude`?**
**Yes for both.** Prompt is a positional argument; the working folder is inherited from the process (plus an optional `--cd`). The bridge's spawn, prompt-as-one-argument, and cwd handling are reusable as-is. What does *not* carry over: pre-assigned session ids (exact Resume), worktree isolation, model ids, and the auto-accept flag. So the launch-link *plumbing* is shared; the *command shape* and the *bootstrap prompt head* are per-agent.

**Q2. Scope v1 to "Codex only if already installed" (no install flow)?**
**Yes — recommended.** Codex users have by definition already installed and signed into Codex. What v1 *must* add is an honest, plain-English "Codex isn't installed on this Mac" message with a link to OpenAI's install instructions — because today a missing binary just says `command not found` and kills the session. No download/install/sign-in flow inside VibeCodes. (Settled: the in-app install/sign-in wizard is a separate To Do card covering both agents.)

**Q3. Can desktop-window Codex reuse the existing "In a terminal window" launch?**
**No.** That launch is Claude Code's own `claude-cli://` handler; Codex has no equivalent scheme. Desktop Codex is delivered by our helper opening a Terminal window itself (§2.3). The Claude `claude-cli://` launch stays exactly as it is.

---

## 4. Users and user stories

Personas:
- **Codex user** — pays for ChatGPT/Codex, has `codex` installed and signed in, doesn't use Claude Code.
- **Claude user** — today's user; must see no change unless they opt in.
- **Switcher** — uses both, wants to pick per session.

### Must have (v1)

**US-1 — Pick the agent when starting a session**
As a Codex user, I want to choose Codex when I start a browser terminal session, so that the terminal runs the agent I actually pay for.

**US-2 — Default stays Claude Code**
As a Claude user, I want the terminal to keep starting Claude Code without me touching anything, so that nothing changes for me.

**US-3 — Codex opens in the right folder with the board connected**
As a Codex user, I want my Codex session to start in my project folder with the VibeCodes board tools reachable, so that it can pick up and update tasks like Claude Code does.

**US-4 — Told clearly when Codex isn't installed**
As a Codex user on a new Mac, I want a plain-English message with a link to install Codex when it isn't there, so that I'm not staring at a dead terminal.

**US-5 — See which agent a session is running**
As a switcher, I want each session tab and each row in "my sessions" to show whether it's Claude or Codex, so that I don't resume the wrong kind of session.

**US-6 — Resume a Codex session**
As a Codex user, I want "Resume" on a Codex row to continue my most recent Codex conversation in that folder, so that I can pick up where I left off.

**US-7 — Never handed a broken launch by an old helper**
As a Codex user with an out-of-date helper app, I want to be asked to update before launching Codex (rather than silently getting Claude), so that I never end up in the wrong agent.

**US-10 — Open Codex in a Terminal window on my Mac** *(Change A)*
As someone who prefers a full desktop terminal, I want to open Codex in a Terminal window on my Mac, like I can with Claude Code, launched from VibeCodes, so that I get the same one-click "right folder, board connected" start without using the in-browser terminal.

**US-11 — Pick Codex directly from the board toolbar and the task card** *(Change B)*
As a Codex user, I want the board's launch button and each task card's menu to offer Codex by name — for both "in a terminal window" and "in the browser" — so that I get Codex in one click with no hidden switch and no extra picker step.

### Should have (v1 if cheap, else v1.1)

**US-8 — Remember my last choice** *(settled: per account, across devices)*
As a switcher, I want the agent picker to default to whatever I picked last time, on any of my devices, so that I'm not re-choosing on every launch.

**US-9 — Second Codex session on the same board is handled honestly** *(settled: warn, don't block)*
As a Codex user, I want to be told that a second session on the same board will share the project folder (Codex has no built-in isolation), so that I can decide whether to proceed.

### Deferred (not in v1)

- Exact-conversation Resume for Codex (needs the session id read from Codex's on-disk session file after launch — spike first).
- Codex model choice and auto-accept mapping (different flag vocabulary; needs its own design).
- Desktop-window Codex in a terminal app other than Apple's Terminal (iTerm2, Warp, Ghostty…). v1 opens **Terminal.app** only.
- Tracking desktop Codex windows as sessions (resume/list from VibeCodes). Same as `claude-cli://` today: fire and forget.
- Install/sign-in flow for Codex inside VibeCodes (separate To Do card, both agents).
- Windows.

---

## 5. Functional requirements

### FR-1 Agent choice travels on the launch link
- The launch link carries an optional `agent` param. Allowed values: exactly `claude` or `codex` (whitelist, validated on build **and** parse, like `permissionMode`). Anything else is dropped. Absent means `claude`.
- `agent` is inserted before `prompt` (prompt stays last) so the prompt budget stays stable.
- The shared `.mjs` parser and the TypeScript builder stay in lock-step (extend the existing drift test).

### FR-2 The bridge spawns the chosen agent
- A new pure resolver (sibling of `resolveClaudeLaunch`, or the same function taking `agent`) returns the command for Codex:
  - Fresh: `codex` (+ the prompt as one argument, unchanged mechanism).
  - Resume (legacy/most-recent): `codex resume --last`.
  - Exact resume (`resume_id` present **and** agent is codex): `codex resume <uuid>`. (Only reachable once the deferred exact-resume work lands; the resolver should support it now so the deep link shape is settled.)
- On Codex, the bridge must **never** append `--model`, `--permission-mode`, `--session-id`, or `--worktree` — those are Claude flags. `model`/`permissionMode`/`worktree` link params are ignored for Codex.
- `conv` (the announced conversation id) is `null` for a fresh Codex launch — the bridge doesn't know it. Nothing upstream may assume `conv` is present.
- Explicit `--cmd`/`BRIDGE_CMD` override still wins over everything (dev/test seam).

### FR-3 Pre-flight "is the agent installed?" check (both agents)
- Before spawning, the bridge checks the chosen binary resolves on the same PATH `resolveSpawnEnv()` builds.
- If missing: write a one-line plain-English note into the terminal (same mechanism as the worktree-fallback banner), send a structured reason the dock can recognise, and exit cleanly **without spawning anything**. No `command not found`.
- Copy must name the agent and, for Codex, point to OpenAI's install instructions. Calm tone, no jargon (same rules as `first-run-copy.ts`).
- The prompt-carrying R1 gate (spawn only after the relay confirms the owner-bound token) is unchanged — the install check runs inside that gate, never before auth.

### FR-4 Agent picker in the launch UI
- Where a **fresh** browser session goes through a UI step before launching (the dock chooser's "Start new session", the per-task launch dialog), the user can pick Claude Code or Codex. Default: Claude Code (or the remembered choice, US-8 / FR-4a).
- The one-click surfaces (board toolbar, task-card menu, task-detail icon) do **not** gain a picker step; they name the agent in the control itself — FR-15.
- The picker is never shown for Resume — a resumed row reuses the agent recorded on that row.
- The picker must not trap the user (close, Escape, outside click all work — existing rule).
- Non-Mac: unchanged "Mac-only for now" copy.
- Old helper on a first-ever browser launch (settled): the picker always offers Codex; if the helper turns out to be too old at attach time, the dock starts, detects too-old, stops cleanly and shows the update panel (see FR-7).

### FR-4a Remembered agent pick is per account
- The last-chosen agent is stored on the user's account (a `users.terminal_agent`-style column, default `'claude'`, check `in ('claude','codex')`), exactly like the starting-model setting — so it follows the user across devices. One forward migration; `database.ts` updated.
- Choosing an agent on any picker updates it. "Start with Claude Code instead" (the fallback offered when Codex is refused or missing) **also** flips the remembered pick back to Claude — intended, settled.
- The remembered pick applies to the picker default and to the "remembered agent" ordering in the toolbar/card menus (FR-15); it never silently changes what an explicitly-labelled control does.

### FR-5 Session record is agent-aware
- `terminal_sessions` gets `agent text not null default 'claude'` (check constraint `in ('claude','codex')`). Mint route stamps it from the request.
- `src/types/database.ts` gains the full `terminal_sessions` block (Row/Insert/Update/Relationships) — it is missing today and must be added before any typed query.
- Chooser rows, "my sessions" panel, tab labels and the pop-out carry the agent. Resume on a codex row mints with `agent=codex` and `resume=1` (legacy path); `resume_id` is only sent on a codex row if a codex session id was recorded (deferred).
- Labelling (settled): a small **"Codex" pill on Codex tabs only** (Claude tabs stay as they are); session-list rows name the agent on **both** kinds of row.
- The existing `claude_session_id` column keeps its name in v1 (renaming is churn with no user value); code comments note it holds "the agent's conversation id".

### FR-6 Codex-specific bootstrap prompt head
- A Codex variant of `mcpSetupHead()`: `codex mcp add vibecodes --url <endpoint>` then `codex mcp login vibecodes`, with the same "stop and hand sign-in back to me" guidance and the same "don't improvise OAuth" rule.
- The rest of the prompt (directory echo, record_project_path, work step) is agent-neutral and shared.
- The Codex head must fit the same link budget. Measure it in `deep-link.test.ts` the way the Claude head is measured; if it doesn't fit for a realistic repo-backed launch, shorten the Codex head, never the folder.

### FR-7 Helper version gate for Codex
- Launching with `agent=codex` requires a helper version ≥ the release that ships FR-2/FR-3. An older helper ignores the unknown param and would silently launch Claude — so the dock must refuse the Codex launch and show the existing "update the helper" path instead.
- `MINIMUM_RECOMMENDED_HELPER_VERSION` bump follows the helper release recipe (build, notarise, release, bump).

### FR-8 Claude-only settings are not applied to Codex
- `users.terminal_model` and `users.terminal_auto_accept` are not sent on a Codex launch. The chooser footer's model/auto-accept chips are hidden or read "Codex uses its own settings" when Codex is selected.

### FR-9 Concurrent session on the same board (Codex)
- When the mint route would set `isolate: true` and the agent is Codex, the launch proceeds in the main folder and the bridge writes the existing "your sessions share this folder" note. No worktree flag is sent. **Settled: warn, don't block.**
- The recorded project folder rule is unchanged: always the main checkout.

### FR-10 Analytics and logging
- Launch, install-missing and resume events include `agent` **and `location` (`browser` | `desktop`)**. Never log prompt content or tokens (existing rule).

### FR-11 Desktop Codex: a new helper action opens a Terminal window *(Change A)*
- The `vibecodes://` scheme gains a **second action** alongside `launch` (working name `open-terminal`), parsed by the shared `deep-link.mjs` module with the same whitelist discipline: `agent` (v1: `codex` only — `claude` is refused on this action because Claude keeps its own `claude-cli://` path), `cwd` (required), `prompt` (optional, last), plus whatever S-5 decides for verification.
- On receipt the helper opens **Apple's Terminal.app** with a new window whose shell is in `cwd` and which runs `codex` there, handing the prompt as Codex's single positional argument (never shell-split, never interpolated unquoted). Mechanism per §2.3 — option 1 (launch script + `open`) recommended, option 2 (AppleScript) acceptable.
- The Terminal window's PATH must find `codex` in the same places the bridge does (`~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`) — reuse/extract the bridge's `resolveSpawnEnv()` fallbacks rather than duplicating them.
- Any temp launch script is written to the helper's own temp area with owner-only permissions and removed after Terminal has started it (or on next helper start).
- Nothing is spawned, written or opened until the action has been fully validated. An unknown/old helper that doesn't know the action ignores it (skew-safe), and the app gates on helper version (FR-14) so the user is never left staring at nothing.
- The existing `launch` action and the bridge are untouched by this feature.
- **Unchanged:** the Claude "In a terminal window" launch continues to fire `claude-cli://` exactly as today. Desktop Codex is a new path beside it, not a replacement.

### FR-12 Desktop Codex: folder and board-connect handoff
- `cwd` is the recorded project folder for the board/task (main checkout, never a worktree — existing rule), resolved by the same launch-path logic (`LaunchPathState`) the Claude desktop launch uses. If the board has no recorded folder, the launch goes through the existing "pick a folder" dialog first — same as Claude today.
- The prompt is the **same compact bootstrap prompt** the browser Codex launch uses (FR-6): Codex head (`codex mcp add vibecodes --url <endpoint>` → `codex mcp login vibecodes` → stop and hand sign-in back to the user), then the shared directory echo / `record_project_path` / work step.
- Budget: the deep link is still a URL (helper scheme ceiling ~2,048 chars), so the prompt is budgeted with `buildBoundedDeepLink` using `cwdPolicy: "keep"` — the folder is never dropped to make the prompt fit; a folder that cannot fit refuses to launch with the existing toast. (This is the in-browser rule, deliberately reused; the Claude `claude-cli://` path keeps its own "degrade" ladder.)
- `isolate`: desktop Codex has no worktree option. If another session is already live on that board, the prompt carries the same advisory note the Claude desktop launch adds (`includeIsolationAdvisory`), because prose is the only lever on a path with no enforced flag. Warn, don't block (FR-9).

### FR-13 Desktop Codex: "not installed" and failure behaviour on this path
- Before opening anything, the helper checks `codex` resolves on the same PATH it will give the Terminal window. If missing: **do not open a Terminal window.** Tell the user in plain English that Codex isn't installed on this Mac and where to install it (placeholder URL, confirmed at implementation). Minimum v1 delivery: a native macOS notification/dialog from the helper. Nice-to-have: the helper also reports the reason over its existing control connection so the browser shows the same "not installed" state it shows for the browser path (FR-3), giving one consistent message.
- If Terminal can't be opened (permission denied on option 2, `open` fails, temp dir unwritable): same treatment — a plain-English "couldn't open a Terminal window" message, no half-written state left behind, reason logged (no prompt content).
- **Nothing half-launches:** the helper either opens a Terminal window running `codex` in the right folder, or opens nothing and says why. It never opens an empty window, a window in the wrong folder, or a window showing `command not found`.
- The "Start with Claude Code instead" escape hatch is offered on the browser side whenever a desktop Codex launch is refused before firing (helper too old, not installed per FR-14's pre-check) — and, as settled, taking it flips the remembered pick to Claude.

### FR-14 Desktop Codex: gating on helper presence and version
- Desktop Codex is only **enabled** when the app knows a helper is installed and its version is ≥ the release that ships FR-11 (via the existing helper-status API / `MINIMUM_RECOMMENDED_HELPER_VERSION` machinery). Otherwise the control stays visible but leads to the existing "install / update the helper" path — never to a silent no-op click.
- This is the first time the desktop-window launch depends on our helper at all (Claude's doesn't). Copy must say so plainly: "Opening Codex in a Terminal window needs the VibeCodes helper app."
- Ship FR-11–FR-14 in the **same** helper release as FR-2/FR-3 so users update once, not twice.

### FR-15 Board toolbar and task-card menu offer Codex explicitly *(Change B)*
- **Board toolbar split button.** The dropdown becomes agent × location — four explicit items: *Claude Code › In a terminal window* (unchanged `claude-cli://`), *Claude Code › In the browser* (unchanged auto-launch), *Codex › In a terminal window* (FR-11), *Codex › In the browser* (`requestBrowserLaunch({ agent: "codex" })` → the dock auto-launches Codex directly, no picker). Grouping/ordering is UX Design's call; the requirement is that every item names its agent **and** location and does exactly that in one click.
- **Button body.** Keeps doing today's thing (Claude, terminal window) unless UX Design chooses to make it follow the remembered pick — in which case the button's **label** must change to match ("Launch Codex") so the click is never a surprise. **No silent agent-switching.**
- **Task-card ⋯ menu** (settled): adds an explicit *Launch in Codex* item (desktop, FR-11) next to *Launch in Claude Code*, and *Launch Codex in browser terminal* next to *Launch in browser terminal*. Same "name the agent, one click, no picker" rule.
- **Task detail header icon** stays Claude-only in v1 (single icon, no room for four choices); UX Design may propose a small menu there but it is not required.
- `requestBrowserLaunch` carries `agent`; absent means Claude (byte-identical to today). The dock honours it: a Codex request goes straight to a Codex mint and launch (FR-1/FR-2), through the helper gate (FR-7) and the settled old-helper safety net.
- Below `md` / non-Mac: unchanged hiding rules; the new items appear only where the old ones did.

---

## 6. Non-functional requirements

- **No regression for Claude Code, in either location.** Every existing terminal test passes unchanged; a launch with no `agent` param behaves byte-for-byte as today; the `claude-cli://` desktop launch is not modified by this feature.
- **Skew-safe.** Old helper + new app: Codex is refused with an update nudge (FR-7); Claude works. New helper + old app: no `agent` param → Claude, as today.
- **Security posture unchanged on the browser path.** `agent` is whitelist-validated; the relay still never parses stream content; no new params reach `pty.spawn` unvalidated.
- **Security on the new desktop path (FR-11).** The helper's new action runs exactly one fixed binary (`codex`), in a directory that must already exist, with a prompt passed as one argument. It never runs shell text from the link. Because any web page can fire `vibecodes://`, the action must not start Codex unattended from an unverified link: either the user confirms what is about to run (window shows the folder + prompt and waits, or a native confirm), or the link carries a short-lived signed token the helper verifies — decision S-5. Same principle the `claude-cli://` comment relies on (human sees the prompt before it runs).
- **Plain-English copy.** All new user-facing text passes the same "no jargon, no error-speak" tests as `first-run-copy.ts`.
- **Tests.** Pure logic (launch resolver, link build/parse for both actions, chooser agent labelling, menu item wiring, prompt head budget, helper-version gate) has unit tests. Bridge-side resolver tested in `terminal/bridge` (`node --test`). No unit or E2E test requires a real `codex` binary — see the test strategy under AC-19.

---

## 7. Acceptance criteria (testable)

**AC-1 (US-2)** Starting a session without touching the picker launches Claude Code with a link identical to today's (no `agent` param). Existing `deep-link.test.ts` drift test passes unchanged.

**AC-2 (US-1, FR-1)** Choosing Codex produces a link containing `agent=codex`, placed before `prompt`. The shared parser returns `agent: "codex"`. A link with `agent=anything-else` parses as Claude.

**AC-3 (FR-2)** Bridge resolver unit tests: `{agent:"codex"}` → `codex`; `{agent:"codex", resume:true}` → `codex resume --last`; `{agent:"codex", resumeId:<uuid>}` → `codex resume <uuid>`; `{agent:"codex", model:"claude-x", permissionMode:"auto", worktree:true}` → command contains none of `--model`, `--permission-mode`, `--session-id`, `--worktree`; `conv` is `null` for fresh/`--last` Codex.

**AC-4 (US-3)** With `codex` installed and signed in, launching Codex from a board with a recorded folder opens Codex in the browser terminal, `pwd` is the recorded main-checkout folder, and the bootstrap prompt's first section instructs `codex mcp add vibecodes --url …` / `codex mcp login vibecodes`. Verified live on Nick's Mac, not from code reading.

**AC-5 (US-4, FR-3)** With the chosen binary absent from PATH, the terminal shows one calm sentence naming the agent (and for Codex, where to install it), the dock shows a recognisable "not installed" state rather than "ended unexpectedly", and **no** process was spawned (bridge log shows the pre-flight reason, no `spawning PTY` line). Same behaviour for a missing `claude`.

**AC-6 (US-5, FR-5)** A Codex session's tab, chooser row and "my sessions" row show a Codex label; Claude rows show Claude (or remain unlabelled — UX Design decides). Migration adds `terminal_sessions.agent` with default `'claude'`; existing rows read as Claude. `database.ts` compiles with a typed `terminal_sessions` entry (`npm run typecheck` passes).

**AC-7 (US-6)** Resume on a Codex row mints with `agent=codex` and launches `codex resume --last` in the row's folder; the agent picker is not shown. Resume on a Claude row is unchanged.

**AC-8 (US-7, FR-7)** With a helper reporting a version below the Codex-capable release, choosing Codex shows the update-helper path and does not fire a launch link. Claude launches still work with that helper.

**AC-9 (FR-6)** `deep-link.test.ts` asserts the realistic repo-backed Codex launch link (Codex head + directory echo + cwd) fits `MAX_LAUNCH_URL_LENGTH` with `cwdPolicy: "keep"`, and that the folder is never dropped.

**AC-10 (FR-8)** A Codex launch link never contains `model=` or `permissionMode=`, even when the user has `terminal_model`/`terminal_auto_accept` set.

**AC-11 (FR-9)** A second Codex session on a board where one is already live launches in the main folder, without `worktree=1`, and the terminal's first line is the existing "share this folder" note.

**AC-12 (NFR)** Full unit suite (`npm run test`), `npm run typecheck`, `npm run lint`, and `terminal/bridge` + `terminal/test` suites pass. No test depends on a real `codex` binary.

**AC-13 (US-8, FR-4a)** After a Codex launch, reopening the picker defaults to Codex; after a Claude launch, to Claude — **on a different browser/device signed into the same account** too. Taking "Start with Claude Code instead" flips the default back to Claude. Migration adds the account column with default `'claude'`.

**AC-14 (US-10, FR-11) — window opens in the right folder.** With `codex` installed, choosing *Codex › In a terminal window* on a board with a recorded folder opens a **new Terminal.app window** in which `pwd` prints the recorded main-checkout folder (never a `.claude/worktrees/…` path) and Codex is running. Verified live on Nick's Mac.

**AC-15 (US-10, FR-12) — prompt handed over.** In that window, Codex's first user turn is the compact bootstrap prompt, starting with the Codex board-connect head (`codex mcp add vibecodes --url …` / `codex mcp login vibecodes`), with quotes, newlines and `#` characters intact. Verified live with a realistic long-titled board (the S-4 spike's prompt).

**AC-16 (FR-13) — Codex missing on this path.** With `codex` absent from PATH (rename the binary), choosing *Codex › In a terminal window* opens **no** Terminal window, shows a plain-English "Codex isn't installed on this Mac" message with an install link, and the helper log records the pre-check reason with no prompt content. Claude's "In a terminal window" is unaffected.

**AC-17 (FR-13) — nothing half-launches.** Forcing each failure in turn (temp dir unwritable; `open`/AppleScript failing; folder deleted after the link was built) results in **either** a Terminal window running Codex in the right folder **or** no window plus a message — never an empty window, a `command not found`, or a window in the wrong folder. No temp launch script is left behind after a successful or failed launch.

**AC-18 (FR-14) — gated on the helper.** With no helper installed, or a helper older than the Codex-capable release, *Codex › In a terminal window* leads to the existing install/update-helper path and fires no `vibecodes://` link. Claude's `claude-cli://` desktop launch still works with no helper at all (unchanged).

**AC-19 (NFR, S-5) — no unattended run from an unverified link; and test strategy.** Pasting a hand-built `vibecodes://open-terminal?…` link into the browser's address bar does not start Codex without the S-5 safeguard (confirmation or token check) being satisfied. **Test strategy, since CI has no real `codex`:** (a) the link builder/parser for the new action is unit-tested in `src/lib/terminal` and `terminal/shared` (drift test extended); (b) the helper's "build the launch script / AppleScript for `{cwd, prompt}`" step is a **pure function** unit-tested for quoting (single quotes, `$`, backticks, newlines, `#`), and its "which binary, on which PATH" pre-check is tested with a stub PATH containing a fake `codex` shell script that just prints its arguments and `pwd`; (c) an opt-in local integration test (`terminal/test`, skipped in CI) opens a real Terminal window against that fake `codex` and asserts the printed folder and argument match; (d) the real-Codex run is a live sign-off on Nick's Mac, recorded in the Verify comment — never claimed from code reading.

**AC-20 (US-11, FR-15) — toolbar.** On desktop the board toolbar dropdown shows four items, each naming an agent and a location. *Claude Code › In a terminal window* and the button body fire `claude-cli://` exactly as today (existing tests unchanged). *Claude Code › In the browser* calls `requestBrowserLaunch` without `agent` (byte-identical payload to today's test). *Codex › In the browser* calls `requestBrowserLaunch({ agent: "codex", … })` and the dock launches Codex with **no intermediate picker**. *Codex › In a terminal window* fires the new helper action (or the helper-gate path per AC-18). Unit tests in `launch-claude-code-button.test.tsx` and `terminal-dock.test.tsx`.

**AC-21 (US-11, FR-15) — task card.** The task-card ⋯ menu shows *Launch in Claude Code*, *Launch in Codex*, *Launch in browser terminal*, *Launch Codex in browser terminal* (final wording UX Design's). Each does its named thing in one click; the Codex browser item carries the task id/title in the launch request exactly as the Claude one does. Unit test in `task-card-menu.test.tsx`.

**AC-22 (FR-15) — no silent switching.** No control anywhere launches a different agent from the one written on it. If the button body is made to follow the remembered pick, its label changes with it (test: remembered `codex` → body reads "Launch Codex").

---

## 8. Scope, estimate and sequencing

Impact/effort, v1 = "Codex if already installed, no install flow, legacy resume only, **browser + desktop Terminal window**, explicit Codex items on toolbar and card":

| Slice | Effort | Notes |
|---|---|---|
| A. Link param + bridge resolver + pre-flight install check | M | Pure logic + tests. **Requires a helper release** (bridge ships inside the Mac app). |
| B. DB: `terminal_sessions.agent` + per-account remembered pick + `database.ts` typing + mint route stamps agent | S | One forward migration covering both columns (apply via Supabase MCP). |
| C. Agent picker + labels (Codex pill, row names) + resume path + helper gate + old-helper safety net | M | The intricate part is `terminal-dock.tsx`; UX Design step owns the look. |
| D. Codex bootstrap prompt head + budget test | S–M | Budget is tight; may need wording trims. |
| E. Helper build/notarise/release + min-version bump | S (process) | Release-coupled; ship with A **and F** (one release). |
| **F. Helper opens a Terminal window running Codex** (Change A: new deep-link action, shared parser, script/AppleScript builder, PATH pre-check, not-installed + failure messaging, S-5 safeguard, temp-file hygiene) | **M–L** | Entirely new helper capability. Includes spike S-4 (mechanism) and decision S-5 (safeguard). The Claude `claude-cli://` launch is not touched. |
| **G. Toolbar agent × location dropdown + task-card Codex items + `requestBrowserLaunch({agent})` + dock honours it** (Change B) | **S–M** | Mostly wiring and tests in `launch-claude-code-button.tsx`, `task-card-menu.tsx`, `terminal-dock.tsx`. |

**Revised rough total: ~3–4.5 focused days of implementation plus one helper release** (up from ~1.5–2.5 days). To be honest about it: slice F roughly doubles the helper-side work and adds the first helper feature that touches something the user can *see* (a Terminal window), with its own permission, quoting and security wrinkles; slice G is modest but touches the board's most-clicked control. Still one app PR (or two: browser path, then desktop + menus), one migration first, **one** helper release carrying A and F together.

Trade-offs to be explicit about:
- Exact-conversation Resume for Codex in v1 would add a post-launch file-watch of `~/.codex/sessions` and a new announce path — roughly doubling slice A. Not worth it before we know Codex users want the terminal at all.
- **We can ship the browser path first (A–E, G's browser half) and the desktop window (F, G's desktop half) a week later, but it means two helper releases and two "update the helper" nudges for users.** Recommended: hold to one release unless F's spike turns up something nasty.
- Supporting the user's preferred terminal app (iTerm2 etc.) in v1 would add a settings surface and per-app launch quirks — deferred.

---

## 9. Risks and dependencies

1. **Helper release required.** Nothing in slice A reaches users until the Mac helper is rebuilt, notarised, released, and the minimum version bumped. Old helpers must be gated (FR-7) or a Codex click silently launches Claude.
2. **Codex ↔ our MCP OAuth is unverified.** `codex mcp login` supports OAuth, but nobody has run it against `/api/mcp` end to end. **Spike S-1 for Implementation:** connect once by hand on Nick's Mac before writing the prompt head. If it fails, v1 falls back to "connect the board manually" copy and the bootstrap prompt still works for folder/record steps.
3. **Prompt budget.** The Claude head is within ~5 chars of the cap. The Codex head must be measured, not assumed.
4. **No isolation for concurrent Codex sessions.** FR-9 mitigates with a warning; UX Design should confirm warn-vs-block.
5. **Codex resume semantics.** Whether `codex resume --last` is folder-filtered like the picker is unconfirmed. **Spike S-2:** run it from two folders and observe. If not folder-filtered, v1 Resume for Codex should be hidden rather than wrong (same rule as "sessions with no folder can't be resumed").
6. **Codex CLI churn.** Flags changed between 0.13x releases (e.g. `--full-auto` is gone in 0.135). Pin what we depend on to the positional prompt, `resume --last`, `resume <uuid>`, `mcp add --url`, `mcp login` — all stable, documented surfaces — and keep everything else off the command line.
7. **Session id column naming.** `claude_session_id` becomes slightly misleading; accepted for v1 to avoid a rename migration.
8. **Existing drift.** `terminal_sessions` isn't typed in `database.ts`; slice B must add it or every query resolves to `never`.
9. **A second new helper capability (Change A).** Opening a Terminal window is the first thing the helper does that the user can see, and it lands in the same release as the bridge changes. If slice F slips, it drags the helper release — and therefore the browser Codex path — with it. Mitigation: F is designed so it can be pulled from the release without touching A; decide at the release gate.
10. **Which terminal app, and macOS permissions.** v1 targets Apple's Terminal.app only. Option 2 (AppleScript) triggers an Automation permission prompt and needs an Info.plist usage string plus notarisation re-check; option 1 avoids that but may leave `[Process completed]` windows depending on the user's Terminal profile. **Spike S-4** picks. Users on iTerm2/Warp get Terminal.app and may grumble — accepted for v1.
11. **Desktop path is fire-and-forget from the browser's point of view.** Unlike the browser terminal, the app can't see whether the window opened. FR-13's native message covers the user; the control-connection report-back is the way to give the browser the same story and is nice-to-have.
12. **New attack surface on `vibecodes://`.** "Open Terminal and run a command" from a link any web page can fire is qualitatively different from "fork an invisible bridge behind an owner-bound token". Fixed binary + existing-directory + S-5 safeguard are the mitigations; this must be reviewed (security-review) before the helper ships.
13. **Testing without a real Codex.** CI can't run Codex, and a real Terminal window can't be asserted from a unit test. AC-19's layered strategy (pure builders → fake `codex` on a stub PATH → opt-in local integration → live sign-off) is the answer; the live sign-off is not optional.
14. **Toolbar is the board's most-clicked control (Change B).** A four-item dropdown is easy to get wrong in ordering/wording; UX Design owns it, but AC-22's "label matches action" rule is the non-negotiable.

### Open spikes / decisions for the next steps

| Id | What | Owner | Blocks |
|---|---|---|---|
| S-1 | Does `codex mcp login` complete OAuth against our `/api/mcp` end to end? (risk 2) | Implementation | FR-6 wording |
| S-2 | Is `codex resume --last` folder-filtered? (risk 5) | Implementation | FR-2 resume, AC-7 |
| S-3 | Does the Codex prompt head fit the link budget for a realistic repo-backed launch? (risk 3) | Implementation | FR-6, AC-9 |
| **S-4** | **Mechanism for opening Terminal.app running `codex` in a folder with an intact prompt: launch script + `open` vs AppleScript. Try option 1 on Nick's Mac with a gnarly prompt.** (risks 10, 13) | Implementation | FR-11, AC-14/15/17 |
| **S-5** | **Safeguard for the new helper action: user confirmation in the window/native dialog vs signed token verified over the control connection.** (risk 12) | UX Design proposes; Implementation confirms feasibility | FR-11, AC-19 |

---

## 10. Definition of done (shared understanding)

- All Must-have stories' ACs (AC-1 to AC-12, AC-14 to AC-22) pass; AC-13 (per-account remembered pick) is in v1 as settled.
- Verified live on Nick's Mac, **browser path:** one Codex launch from a real board, one Claude launch, one "Codex missing" case (rename the binary temporarily), one Codex resume.
- Verified live on Nick's Mac, **desktop path:** one *Codex › In a terminal window* from the toolbar (folder + prompt correct), one from a task card, one "Codex missing" case (no window opens, message shown), one Claude "In a terminal window" to prove `claude-cli://` is untouched.
- Spikes S-4 and S-5 resolved and their outcome recorded as a task comment.
- Security review of the new helper action done before the helper release.
- Helper released (one release carrying A + F) and min-version bumped; production migration applied.
- Board task moved to Verify with a summary of what to test.
