# fae2ce4f — Claude and Codex terminal settings look and read the same: working notes

Card: "Make the Claude and Codex terminal starting settings look and read the same (Settings and Admin)".
Workflow "Feature Development": Plan (Planner) -> Build -> Code review -> Test and release summary.
Plus three tidy-ups shipped in the same release (Nick, 27 Oct).

## Plan step (Planner, 27 Oct 2026)
Code read at origin/master 06e7ef8 in a scratch worktree (main checkout untouched).
Mock: docs/terminal-settings-consistency-mock.html (attached to the card, opened in Nick's browser).
Checked at 1280 and 375 with Playwright: no sideways scroll at 375; no strip overflows.

### Facts checked
- Settings dialog: `src/components/profile/model-tier-settings.tsx` L691-930 renders, in order: Claude model
  (Select, "Platform default (Opus)"), Claude effort (strip with Default), Claude memory limit (strip with Default),
  Codex model (Select, "Use organization default"), Codex effort (unlabelled strip, no Default, hidden when model is
  site default or machine default), Codex memory limit (strip with Default), auto mode, Remote Control. One Save.
- Admin: `admin-tabs.tsx` L124-131 renders AdminPlatformDashboard, then Codex model card, Claude model card,
  Claude effort card, Claude memory card, Codex memory card (Codex first). All five live in
  `admin-platform-dashboard.tsx` L600-1286.
- Storage (unchanged by this card): users.terminal_model / terminal_effort / terminal_auto_compact /
  terminal_codex_model + terminal_codex_effort (pair) / terminal_codex_auto_compact. platform_settings keys
  terminal_model_default {model}, terminal_effort_default {effort}, terminal_auto_compact_default {window},
  terminal_codex_auto_compact_default {window}, terminal_codex_model_default {model, effort}.
- Live (read-only, 27 Oct): site = Claude model opus, effort medium, Claude memory 300000, Codex pair
  gpt-5.6-terra/medium, no Codex memory key. Nick's own row: opus, medium, no memory, terra/medium, no Codex memory.
- Every server action the new Admin cards need already exists in `src/actions/admin-platform.ts` (get…ForAdmin and
  update… per key). No server or schema change.
- Codex resolution: user pair -> site pair -> Standard tier's Codex pair (`resolveEffectiveTerminalCodexModelWithSource`).
  Codex model/effort flags go only on fresh launches (`terminal/bridge/src/resume-cmd.js` L209-216); resume is bare.
- The user screen is /settings (`src/app/(main)/settings/page.tsx` row "Model Tiers"). "Profile → Model Tiers" is
  stale in: admin Claude model card, admin Codex card, guide troubleshooting (launching-claude-code L493),
  constants.ts L67 (step tier hint) and a comment at L200.
- Guide: only a "Memory limit" section (launching-claude-code L460-482); nothing on starting model/effort.
- Effort strips: Claude 5 levels, Codex 5 levels -> with a leading Default both are 6 segments, same widths.
  Memory: Claude 5 steps, Codex 3 -> widths differ by necessity.
- Tidy-up 1: `mcp-server/src/tools/cost-report.test.ts` L131 title "…as jsonResult sends it…"; it measures compactResult.
- Tidy-up 2: `src/lib/step-cost/weekly.ts` L133 counts a not-finished step when it has cost OR a changes_requested
  comment. Admin (`report.ts` L241) counts it only when caught (agent failure paired within 60s with a send-back
  by the same author on another step of the run) or rejected (non-bot failure on a human-check step).
  bot_profiles is readable by any signed-in user (policy bot_profiles_select USING true), so the MCP tool can
  read failure-comment authors' bot rows under RLS.
- Tidy-up 3: the line now lives in `.claude/rules/terminal.md` L54 (moved out of CLAUDE.md in 5e654dd1 stage 4).
  Current behaviour: chooser still hides no-folder rows (`visibleRecentRows`, chooser-data.ts L393); Reconnect of
  a row with a conversation id but no folder now resumes it via Claude's own transcript store (PR #402,
  use-terminal-session.ts L1672-1680); no transcript -> fresh session plus toast; the helper records the folder
  itself at launch (helper 0.3.28).

### Decisions proposed (await Nick)
1. Admin: two per-agent cards (Claude Code, Codex) with model, effort, memory limit and one Save; still one
   storage key per setting; Save writes only changed rows. Recommended.
2. Admin: "Not set" first choice replaces the red Clear button. Recommended.
3. Codex effort row gets Default; because Codex saves a pair, Default on either row resets both; effort buttons
   greyed (site level shown) while model is on Default. Recommended. Alternative (independent Codex effort) ruled
   out: changes storage and behaviour.
4. One word "site" for the site's setting in these rows. Tier grid wording left alone (out of scope).
5. Claude first, then Codex, on both screens.
6. Differences kept: memory steps 5 vs 3; Claude effort applies to resume, Codex doesn't; only Claude mentions
   /effort and /autocompact; Codex has no Custom… on Settings; no "I've checked" tick for unknown Codex names.
7. Guide: fix "Profile → Model Tiers", add "Starting model and effort" paragraph.

### Ruled out
- Combining Claude model and effort into one storage row (Clear on one would wipe the other — 18a37612 notes).
- Making Codex effort independent of its model (behaviour change).
- Changing the tier-grid "platform default" wording (not this card).

## Build step (Atlas, 27 Oct 2026)
Nick approved the plan ("1 - approve"): decisions 1-5 and 7 as recommended, the differences in 6 stay.
Built in a worktree off origin/master (06e7ef8); main checkout untouched.

### Decisions made while building
- Codex has a `/model` command (checked in the codex-cli 0.163.0 binary: "/model - choose what model and reasoning
  effort to use"), so `CODEX_HAS_MODEL_COMMAND = true` and the Codex model help keeps the "typing /model" sentence.
  The Standard-tier fallback line leaves it out, as the plan's strings did.
- Shared strip control: `defaultOption` gained `label` ("Not set" on Admin) and `disabled`; the effort control gained
  `levelsDisabled` (greys only the levels, Default stays clickable). Existing callers are unchanged.
- Admin cards are `AdminClaudeTerminalCard` / `AdminCodexTerminalCard` inside admin-platform-dashboard.tsx, on a small
  shared shell (`TerminalSettingsCard`, `TerminalSettingRow`, `TerminalCardFooter`). Save writes only the dirty rows,
  each through its own existing action (`Promise.allSettled`), so no key can wipe another. A failed row keeps its staged
  value; one error toast names it.
- Pre-fill on picking a specific Codex model while on Default: the site pair's effort, else the Standard tier's, else
  "medium" (plan said site else medium; the Standard tier step keeps the pair from jumping when no site pair exists).
  Pure helper `codexPrefillEffort`.
- Admin strip sub-labels shortened ("Claude's own", "Codex's own", "with model") because the mock's "Claude decides" and
  "with the model" clipped by about 5px at 375 in the real card. The Admin card padding is `p-4 sm:p-6` (the mock's phone
  frame used 16px).
- Cost report tidy-up: `weekly.ts` now takes `comments` + `botIds` instead of `sentBackStepIds`; `report.ts` exports
  `caughtOrRejectedStepIds` (stepSignals refactored to a narrower input, Admin report tests untouched and passing).
  The MCP tool reads failure and send-back comments and the bot ids of failure authors only.
- CLAUDE.md on master no longer holds the "no recorded folder" line; it lives in `.claude/rules/terminal.md`, reworded
  there. The plan's "and a toast says so" was dropped: the bridge prints a "fresh session" line in the terminal, there is
  no toast.

### Verified
- Rendered the real components in a throwaway browser harness (not committed) at 375 and 1280: no sideways scroll,
  both agents' effort strips have identical segment widths, sub-labels fit. One-pixel overflow of the "Medium" label
  in the Claude strip already existed (same markup as 18a37612).
