# 6b2cb8ac: first browser terminal on a fresh Mac (wrong agent, wrong folder, silent death)

Working notes for the Bug Fix workflow. Step 1 (Investigate and plan), Planner. First pass and rework, 17 Oct 2026.
Labels: OBSERVED = seen in data, logs or on disk; PROVEN = shown by a test, a probe or an exact code path; INFERRED = reasoning only.
The repo is public: the board this was found on is private, so it is named here only by id (d650f96a) and its repo as `<owner>/<repo>`.

## Status
- Diagnosis: done (first pass), unchanged by the rework.
- Rework (Nick's decisions, 17 Oct, binding): the helper resolves the folder itself; mock first; one release (app + relay + helper 0.3.25); per-Mac "Download the helper".
- Mock: `docs/terminal-fresh-mac-folder-mock.html`, attached to the card as `terminal-fresh-mac-folder-mock.html`. **Approved by Nick 17 Oct 12:37, all 9 decisions as recommended plus the 7 listed differences.**
- Fix step (Atlas, 17 Oct): built on `fix/6b2cb8ac-fresh-mac-folder`, fresh from `origin/master`, one commit per plan commit. See "Build log" at the end.
- Branch history warning: the two earlier commits on `fix/6b2cb8ac-fresh-mac-terminal` (4129361, 7b11478, local only, never pushed) contain the private board's folder/repo name. Do NOT push them. Start the PR branch fresh from `origin/master` and bring over only the final versions of this file and the mock.

## Root causes (first pass)
| # | Problem | Cause | Status |
|---|---|---|---|
| A | Sessions on the Mac mini die at once, blank terminal | The launch used the MacBook's folder `~/projects/<repo>`, which doesn't exist on the mini (the mini's checkout is `~/<repo>`). node-pty can't enter it: Claude exits code 1 in ~20ms, 0 bytes | OBSERVED (helper log, mini disk) + PROVEN (probe) |
| B | The page borrows another Mac's folder | `chooseLaunchCwdDetailed` rule 2 (src/lib/launch-claude-code.ts): one distinct path across all rows → used "whichever machine the browser is on" | PROVEN (probe). Since #187 (20 Aug) / #233 (29 Aug) |
| C | With each Mac's own correct row, BOTH Macs get no folder | Rule 3: own row disagrees with another row → undefined. No cwd → bridge spawns at the helper's own folder "/" | PROVEN (probe + 46005e4e cwd NULL). Since #233/#234 (29 Aug) |
| D | Repo board with no row for this Mac starts at "/" | No cwd → bridge `CWD = process.cwd()` = "/" (helper forked by LaunchServices) | PROVEN (code) |
| E | "Connected" + "Connection interrupted — reconnecting…" for 90s, then "couldn't reattach" + a Resume that dies again | Relay `handleDetach` opens the 90s grace hold for ANY bridge close, including a deliberate 1000 close ("pty-exit", "agent-not-installed") | PROVEN (code) + OBSERVED (close times = exit + 90s). Since 4bfa9e7 (2 Jul) |
| F | "Couldn't reach the helper on this Mac" though it answered | The 8s helper timer is cleared only by PTY bytes (`markLinkHealthyAndWrite`), never by the bridge-version frame | PROVEN (code: use-terminal-session.ts `openLaunchLinkAndArmTimeout`) |
| G | A later session got "isn't a git project / shared with your other live session" | Dead session still "active" until its 90s hold ended → mint said isolate; the worktree check ran on a missing folder | PROVEN (code + timestamps) |
| H | A retry tab lost the task title | Reattach tabs never carry the task (by design) | INFERRED |
| I | Wrong agent (Codex from the Claude item) | NOT REPRODUCED. Hazard: `terminal-dock.tsx` passes `agent={chooserAgent}` (dock-wide remembered agent) to every `TerminalSessionView`; its Setup panel "Connect" calls `connect({agent})` with it. Tabs created from a payload get `agent: payload?.agent`, which is undefined for Claude, so a dropped carried payload + a remembered "codex" mints Codex | Open; hazard PROVEN by code reading only |
| J | Helper quits ~60s after each failure | Designed idle linger | PROVEN |

New in the rework:
| K | "Download the helper" closes another Mac's helper and ends every Mac's sessions | The relay keeps ONE helper control slot per account (`helperSessionId(sub)`); a new helper leg preempts the old one. `/helper/command quiesce` goes to whichever Mac holds the slot. `use-helper-update-flow.ts` first calls `/session/end {all:true}` (every Mac) | PROVEN (code). INFERRED: two running helpers preempt each other in a loop (close 4001 → reconnect after 2s → preempt the other); not observed, needs a relay tail to confirm |

Ruled out: old Claude Code (mini 2.1.302), helper crash, VPN drops. A recorded `claude_session_id` doesn't prove Claude started (the bridge mints it before spawning).

## Facts checked for the rework (17 Oct)
- OBSERVED (prod, read-only): `idea_project_paths` rows by hostname: Nicks-MacBook-Pro.local 14, Nicks-MBP.home.local 9, Nicks-Mac-mini.local 1 (board d650f96a, wrong path `~/projects/<repo>`, written 10:06Z by the coordinator's revert), plus one other account's row. No "set manually" rows exist.
- OBSERVED: `terminal_sessions` already has `agent` (NOT NULL) and `cwd`, `machine_label`. Only the mint LOG line lacks the agent.
- OBSERVED: the private board's repo is PRIVATE on GitHub (so a fresh Mac needs GitHub sign-in to clone it).
- OBSERVED (this MacBook): `hostname` = Nicks-MacBook-Pro.local, `scutil --get LocalHostName` = Nicks-MacBook-Pro, `HostName` not set. INFERRED: on home Wi-Fi `hostname` becomes Nicks-MBP.home.local (DHCP name) while LocalHostName stays fixed. Mac mini: not checked; command for Nick: `scutil --get LocalHostName; hostname`.
- OBSERVED (this MacBook): git's credential helper is `osxkeychain` from `/Library/Developer/CommandLineTools/usr/share/git-core/gitconfig`; `gh` is logged in (keyring) but is NOT git's credential helper; origins are https.
- OBSERVED: the closed-callback route accepts only `idle_timeout|time_limit|peer_gone`.
- OBSERVED: `vitest` excludes `terminal/**`, and no CI job runs terminal tests. `terminal/test/package.json` lists test files explicitly (new files must be added).
- OBSERVED: the relay forwards every frame (text or binary) between bridge and browser legs; the browser ignores unknown text frames. So a new bridge→browser text frame needs no relay change.

## Decisions
Binding (Nick, 17 Oct): (1) the helper finds the folder itself; (2) mock first; (3) one release; (4) per-Mac helper close.
Open, in the mock, each with a recommendation (R):
1. Search roots. R: ~/{projects,code,dev,src,Developer,repos,git,GitHub,Projects,Code,workspace,work} + top of home, 2 levels, ~2s. Not Documents/Desktop/Downloads (macOS privacy prompt). Alt: include Documents.
2. Other Macs' saved folders. R: ignore completely. Alt: check them on this disk as one more candidate.
3. Several copies. R: most recently used (`.git/index` mtime), say where the other is.
4. Clone destination. R: `~/projects/<repo>`, else `<repo>-2…`.
5. Git missing. R: open Apple's installer (`xcode-select --install`). Alt: message only.
6. Folder can't be got ready. R: stop with reason + Start again (never start elsewhere).
7. Button name. R: "Start again", and rename today's ended-panel "Launch again" to match. Alt: "Launch again" everywhere.
8. Isolation. R: give a second session its own worktree only when the other live session is on the SAME Mac.
9. Update confirm wording. R: add "on this Mac".
Deliberate differences from existing controls are listed in the mock's section 6.

Decided by the Planner (technical, not for Nick):
- The bridge owns the folder choice outright. The page's hostname list is per-browser (empty on a fresh browser, polluted by attaches to other Macs' sessions); the bridge knows the real machine and the real disk.
- The page keeps sending `cwd=` only when THIS browser has an own row (a hint the bridge validates). Old helpers keep working on the Mac whose own row is right.
- The page's bootstrap prompt is unchanged (zero launch-URL budget risk). The bridge prepends a short "you're already in <folder>" note locally when it chose a folder other than the hint.
- Machine identity: the bridge and helper report the Mac's fixed name (`scutil --get LocalHostName` + ".local") as canonical, plus `os.hostname()` as an alias. Folder records are written under every name the bridge reports, so one Mac's names stay in step.
- Ruled out: page-only rules (can't see the disk); asking the helper over the control link (one slot per account, wrong Mac); the "agent sorts it out" prompt self-heal (Nick ruled it out); a `vibecodes://quiesce` URL-scheme close (would cold-launch an old helper on a Mac that isn't running one, and Chrome prompts each time).

## Plan: one release, built as one PR with ordered commits
One PR keeps one paid build; each commit must leave all suites green. Run the terminal suites by hand (no CI): `cd terminal/bridge && node --test`, `cd terminal/relay && npm test`, `cd terminal/test && VIBECODES_PACKAGED= npm test`, then `npm run test` and `npm run typecheck` at the root.

### Commit 1 — shared modules (terminal/shared)
1. `project-path.mjs`: JS port of `isValidAbsolutePath`, `isPlausibleProjectPath`, `stripClaudeWorktreeSuffix` from src/lib/launch-claude-code.ts (identical logic). Drift test `src/lib/terminal/project-path.drift.test.ts` runs both over one table (/, /tmp, /Users, /Users/x, /Users/x/p, ~/p, relative, worktree suffixes, Windows drive, C:\Users\x, UNC).
2. `machine-name.mjs`: `resolveMachineNames({ hostname, platform, run })` → `{ canonical, names }`. darwin: `run("/usr/sbin/scutil", ["--get","LocalHostName"])` (1s timeout) → `<value>.local`; else hostname. `names` = dedupe-case-insensitive [canonical, hostname], each through `sanitizeMachineLabel`. Tests: drifted hostname → 2 names, canonical first; scutil fails → hostname only; equal → 1; non-darwin → hostname.
3. `control-frames.mjs`: `sanitizeBridgeEndReason(raw)` (≤120 bytes, `[A-Za-z0-9:._-]`, else "ended"); `encodeBridgeCwdFrame/isBridgeCwdFrame/parseBridgeCwdFrame` → `{"t":"bridge-cwd","cwd":"/abs"}` (absolute, ≤1024 chars); `sanitizeMachineList(raw)` → ≤5 sanitized lowercase labels from a comma string or array. Tests in terminal/test/control-frames.test.mjs.
   Bridge end reasons (bridge close reason, passed through by the relay to the browser): existing `pty-exit, agent-not-installed, spawn-failed, SIGTERM, SIGINT, helper-gone, reconnect-exhausted, max-duration, connect-timeout, attach-confirm-timeout, e2ee-verify-failed, ws-close, ws-close-terminal, fatal`; new `agent-stopped-early:<exitCode>, folder-missing, folder-unavailable, folder-not-allowed, folder-lookup-failed, clone-failed, clone-no-access, git-missing`.

### Commit 2 — relay (terminal/relay/src/index.js) and the stand-in (terminal/test/standin-relay.mjs), same behaviour in both
1. Deliberate bridge end (fixes E, G): in `webSocketClose`, when the closing socket's role is `bridge`, `code === 1000`, it isn't retired and `sessionStartedAt` is set → `endFromBridge(reason)` instead of `handleDetach`. 1006/1001/errors keep today's grace hold.
   `endFromBridge`: reason = `sanitizeBridgeEndReason(reason) || "pty-exit"`; retire every other live leg with `(1000, reason)`; `notifyAppSessionClosed(sid, "bridge_ended")`; `clearSessionState()`; then store `tombstoneReason`, `tombstoneAt`, `tombstoneOwner` and `setAlarm(now + TOMBSTONE_MS)` (10 min; env `TERMINAL_TOMBSTONE_MS` for tests). Log `session ended {why:"bridge-ended", reason, sid}`.
2. Tombstone: a BROWSER attach after `authorizeAttach` (pass `boundOwner = owner ?? tombstoneOwner` so the real owner's aged token isn't a 4006) with no live bridge, no session and a fresh tombstone → `accept(); close(1000, tombstoneReason)`; bind nothing. A BRIDGE attach clears the tombstone and proceeds (deliberate relaunch).
3. `alarm()`: with no session (`sessionStartedAt == null`) and a tombstone: past expiry → delete the 3 keys; else re-arm to expiry; return.
4. Per-Mac helper legs (fixes K):
   - `fetchHelperLeg`: `names` = [sanitized `machineLabel`, ...`sanitizeMachineList(machineAliases)`], lowercased. Retire only live helper legs whose names intersect (same Mac relaunch); a leg with no names at all keeps today's "retire every helper leg". Attachment: `{role, sub, goodbye:false, names, version, alwaysOn, codexInstalled, claudeInstalled, attachedAt}`. Keep writing the legacy single keys (latest attach); also write `helper:<names[0]>:<field>` keys; unclean detach also writes `helper:<names[0]>:uncleanAt`.
   - `handleHelperStatus`: optional `machines` query → status of the newest live leg whose names intersect (connected = any match), else last-known per-machine keys. Absent → today's behaviour.
   - `handleHelperCommand`: optional `body.machines`. Non-empty → send to every matching live leg, none → `{delivered:false, reason:"not-on-this-mac"}`; empty → `{delivered:false, reason:"machine-unknown"}`; absent → newest live leg.
   - always-on frames update the sending leg's per-machine key.

### Commit 3 — app server (src/app/api/terminal)
1. `session/closed/route.ts`: accept reason `bridge_ended`. MUST be live before the relay deploy.
2. `session/route.ts`: add `agent: effectiveAgent` to the "Minted terminal session tokens" log.
3. NEW `session/workspace/route.ts` (POST, bridge-token auth, service-role client, like `session/key`):
   body `{ sid, token, machineNames: string[1..5] }`. Read the `terminal_sessions` row (user_id, idea_id, status, expires_at) first, then `authorizeAttach({ token, secret, session: sid, role:"bridge", boundOwner: row?.user_id ?? null, maxSessionMs: 24h })`; require ok, `auth.sub === row.user_id`, row active and unexpired (else `{ workspace: null }`).
   Returns `{ workspace: { repo: {owner, name, cloneUrl} | null, repoFolderName, newFolderName, savedFolders, otherLiveSessionsOnThisMac } }`:
   - repo from `parseRepoFromGithubUrl(ideas.github_url)`; owner/name must match `/^[A-Za-z0-9._-]+$/`; cloneUrl built here, never taken from the deep link.
   - `newFolderName = slugifyIdeaTitle(ideas.title)` (same as the page).
   - `savedFolders`: this owner's rows for this idea whose hostname (case-insensitive) is in `machineNames` → `stripClaudeWorktreeSuffix` → `isPlausibleProjectPath` → dedupe → newest first. Never other Macs' rows (decision 2).
   - `otherLiveSessionsOnThisMac`: active rows, same user + idea, sid ≠ this, machine_label in names OR null (unknown counts as "maybe this Mac").
   Log `{sid, ideaId, hasRepo, savedCount, liveOnThisMac}`, no paths.
4. NEW `session/folder/route.ts` (POST, same auth): body `{ sid, token, machineNames, path (≤1024), how: "saved"|"found"|"cloned"|"created" }`. `stripClaudeWorktreeSuffix` → `isValidAbsolutePath && isPlausibleProjectPath` else 400 `not-a-project-folder`. Upsert `idea_project_paths` (onConflict `idea_id,owner_user_id,hostname`) for EVERY sanitized name; update `terminal_sessions.cwd` for the sid. Log `{sid, ideaId, how, names}`.
5. Per-Mac helper calls: `helper/command` body gains optional `machines: string[] (≤5, each ≤200)` forwarded to the relay; `helper/status` forwards `?machines=`; `session/end` accepts `{ all: true, machines?: string[] }` and then ends only active rows whose `machine_label` (case-insensitive) is in the list (null labels left alone).
No migration, no `database.ts` change.

### Commit 4 — bridge (terminal/bridge/src)
1. NEW `folder-resolve.js` (pure; `fs`, `homedir`, `now`, `onProgress` injected). `resolveWorkspaceFolder({ hint, workspace, isResume, deps })` → `{ok:true, path, how, alsoFound}` | `{ok:false, reason, detail}`:
   0. Resume: hint must be an existing directory → `saved`; else `folder-missing` (no search: the conversation belongs to that folder).
   1. `workspace == null` (route failed / older app): hint is an existing directory → `saved`; else `folder-lookup-failed`.
   2. Candidates `[hint, ...savedFolders]`: strip worktree suffix; must pass `isPlausibleProjectPath`, be a directory, and for a repo board have a matching remote (below) → `saved` (path = realpath).
   3. Repo board → search → `found`. 4. Repo board → clone → `cloned`.
   5. Repo-less → `~/projects/<newFolderName>`: existing directory reused, else `mkdir -p` → `created`; mkdir error → `folder-unavailable`.
   6. Final guard: never "/", never home, must pass `isPlausibleProjectPath` → else `folder-not-allowed`.
   Remote match: `<dir>/.git` must be a DIRECTORY (a `.git` file = worktree/submodule, skipped). Parse `.git/config` text for `[remote "<name>"] url = …`; `normalizeGithubRepo(url)` accepts `https://github.com/o/n(.git)(/)`, `http://…`, `git@github.com:o/n(.git)`, `ssh://git@github.com/o/n(.git)`, `git://github.com/o/n` → lowercase `o/n`. `origin` match ranks above another-remote match.
   Search (decision 1): roots as listed, case-insensitively deduped (APFS default is case-insensitive), plus home at depth 1 only. Depth 2 below each root (`root/x`, `root/org/x`). Skip names starting with ".", `node_modules`, `Library`, `Applications`, `Documents`, `Desktop`, `Downloads`, `Movies`, `Music`, `Pictures`, `Public`, `OneDrive*`, `Dropbox`, `Google Drive`, `iCloud Drive`, and any path containing `/.claude/worktrees`. `lstat`, never descend into symlinks; a root that is itself a symlink is realpath'd once. Dedupe by realpath. Stop at 2000ms or 3000 directory reads; log `{scanned, ms, matches}`. Rank: origin match, then newest `.git/index` mtime (fallback `.git/HEAD`), then shorter path, then name. `alsoFound` = up to 3 others.
2. NEW `git-clone.js`: `cloneRepo({ repo, home, repoFolderName, env, run, spawn, fs, onProgress })`.
   - Git present: `xcode-select -p` exit 0 AND `git --version` exit 0. Else (decision 5) fire-and-forget `xcode-select --install`, fail `git-missing`.
   - Destination `~/projects/<repoFolderName>`; empty directory → use; taken by something else → `-2` … `-9`; none free → `folder-unavailable`. `mkdir -p ~/projects`. Clone into `<dest>.vibecodes-partial-<pid>`, `renameSync` on success, `rm -rf` the partial on any failure.
   - Attempt 1: `git clone --progress <cloneUrl> <tmp>` (argv array, no shell) with the login-shell PATH (`resolveSpawnEnv`), `GIT_TERMINAL_PROMPT=0`, `GCM_INTERACTIVE=never`, `GIT_ASKPASS=`, `SSH_ASKPASS=`. Uses the Mac's own credential helpers (Apple git defaults to the keychain).
   - Attempt 2, only after an access failure: `gh` on PATH and `gh auth status` exit 0 → `gh repo clone o/n <tmp> -- --progress`.
   - Attempt 3, only after an access failure and only if `~/.ssh/known_hosts` mentions github.com: `git clone git@github.com:o/n.git <tmp>` with `GIT_SSH_COMMAND="ssh -o BatchMode=yes -o StrictHostKeyChecking=yes"`.
   - Progress: split stderr on `\r`/`\n`; `/Receiving objects:\s+(\d+)%/` → `onProgress(pct)`, at most every 500ms and only on change.
   - Stall: no stderr for 60s → kill → `clone-failed` (detail "stalled"); overall cap 20 min.
   - `classifyCloneError(stderr)`: `clone-no-access` for /Repository not found|Authentication failed|could not read Username|terminal prompts disabled|Permission denied \(publickey\)|returned error: 403/; `folder-unavailable` for /No space left|Read-only file system/; otherwise `clone-failed`. `detail` = last non-empty stderr line (≤200 chars), written only into the terminal stream (encrypted), never into the close reason.
3. `index.js` restructure:
   - Top level: `HINT = launched?.cwd || args.cwd || process.env.BRIDGE_CWD || null` (no more `process.cwd()` for real launches; keep `process.cwd()` only for the dev/test `--cmd` override so existing tests keep working). `CONV_ID = crypto.randomUUID()`; call `resolveAgentLaunch` once early with `worktree:false, mintId: () => CONV_ID` just for `CONV` (relay URL). Remove the top-level `WORKTREE_ELIGIBILITY`/`CMD`/`file`/`cmdArgs`; build them in `prepareLaunch(folder, { isolateHere })` after resolution: `checkWorktreeEligibility(folder)`, then `resolveAgentLaunch({…, worktree: WORKTREE_REQUESTED && isolateHere && eligible, mintId: () => CONV_ID})` → `shellSplit` → `buildSpawnArgs(cmdArgs, agentArgs, finalPrompt)`. `isolateHere = workspace ? workspace.otherLiveSessionsOnThisMac > 0 : true` (decision 8).
   - `MACHINE = resolveMachineNames(...)`; relay URL `host=` = `MACHINE.canonical`.
   - `main()`: `Promise.all([fetchE2eeSessionKey(), fetchSessionAgents(), fetchWorkspace()])`. `fetchWorkspace` POSTs `/api/terminal/session/workspace {sid, token, machineNames: MACHINE.names}`, 5s timeout, `null` on any failure.
   - Resume (`RESUME || RESUME_ID`): step 0 synchronously before the promptless spawn; failure → queue the line, end after open with `folder-missing` (same pattern as `agentMissing`).
   - Fresh launch: on `attached` → agent installed check FIRST (no point cloning if the CLI is missing) → wait for `peer-reattached` (pair whole) or 3s so progress lines reach the browser (the relay drops frames with no peer) → resolve with progress lines via `outputBatcher.queueBinary` → on ok: record (`/session/folder`, 3s timeout, best effort; the prompt's own record step stays as a backup), send `encodeBridgeCwdFrame(path)` as a TEXT frame, prompt note, `prepareLaunch`, `spawnPty(path)`; on fail: failure lines then `shutdown(1, reason)`.
   - `spawnPty(cwd)` takes the folder; `spawnedAt` recorded. `onExit`: within `EARLY_EXIT_MS = 10000` → line "Claude Code stopped straight away (exit code N)." (Codex: "Codex …") + `shutdown(0, "agent-stopped-early:N")`; else `shutdown(0, "pty-exit")`.
   - Every failure writes its line(s) before `shutdown`, so even an old relay shows the reason in the terminal.
4. Prompt note (local argv, no URL budget): when the folder differs from `HINT` (or there was none), `PROMPT = note + "\n\n" + PROMPT`, note = "VibeCodes note: you are already in this board's project folder on this Mac: <path> (<found an existing copy | downloaded it | created it>). Work here. Ignore any other folder or clone instruction below, and don't cd elsewhere." Claude and Codex.
5. `bridge-copy.js` (extend `agent-copy.js`): progress lines (cyan "VibeCodes" tag) and failure lines (yellow), exact strings from the approved mock; display paths use `~`. Pure, unit-tested, no "token/relay/port".

### Commit 5 — helper (terminal/helper)
`connectControl` / `connectOpenTerminalControl`: `machineLabel = MACHINE.canonical`, new `machineAliases` param (other names) via `control-url.mjs` (update its test). `package.json` 0.3.25. Quiesce itself unchanged.

### Commit 6 — page (src)
1. Per-Mac folder rule (fixes B, C): `chooseLaunchCwdDetailed(records, machineNames: readonly string[])`: own = usable rows whose hostname (case-insensitive) is in `machineNames`; none → undefined; one distinct own path → it; own rows disagree → undefined. Never another Mac's row. `resolveEffectiveLaunchTarget({ recordedPaths, machineNames })`; callers use-terminal-session.ts (~l.1442) and launch-claude-code-button.tsx (~l.177, ~l.231) pass `getMachineIdentities()`. Rewrite the tests that pinned old rules 2/3 (they encode the bug). Note: the desktop "Launch Claude Code" button on a Mac with no own row now gets no folder, and its prompt's existing "cd your local clone, or git clone" step runs.
2. Identity only from this browser's own launches: in the bridge-version handler, `addMachineIdentity(host)` only when `launchedHereSidRef.current === sessionId` (set in `fireLaunchDeepLink`). Still PATCH `machine_label` for every session.
3. Watchdog (fixes F): on the first bridge-version frame of the current sid → `clearHelperTimer(); removeLaunchIframe(); setLaunchPhase("idle")`.
4. Ended reasons: extend `EndedReason` (connection.ts) with `agent-stopped-early | agent-not-installed | folder-missing | folder-unavailable | folder-not-allowed | folder-lookup-failed | clone-failed | clone-no-access | git-missing | helper-closed`, plus `endedDetail: string | null` (e.g. exit code). `parseEndedReason`: bridge tokens first (exact, or prefix before ":"), `SIGTERM|SIGINT|helper-gone` → `helper-closed`; then the idle/max substrings; else `remote`. Old-helper rule: `pty-exit` with no PTY bytes ever received on this sid and helperVersion < 0.3.25 (or unknown) → `agent-stopped-early`, detail `old-helper`.
   NEW `src/lib/terminal/ended-copy.ts`: per reason + agent + folder + repo → `{title, body, primary: "start-again"|"resume", installLink?, showUpdate?, showDetails?}`, strings exactly as in the approved mock; forbidden-words test like first-run-copy.
   `canResume` is false for every "never started" reason (all new ones except `helper-closed`).
   terminal-session-view.tsx ended branch renders from ended-copy with today's anatomy; "Start again" = `actions.beginBrowserLaunch`; install links (Claude: https://docs.claude.com/en/docs/claude-code, Codex: the existing `CODEX_INSTALL_GUIDE_URL`); old-helper → `HelperUpdateButton` + outline Start again; "Show what happened" → local state swaps the overlay for the grey bottom bar (mock 3e).
5. `bridge-cwd` frame → `setSessionCwd(cwd)` (no PATCH: the bridge already recorded it).
6. Agent hazard (I): tabs created from a launch payload get `agent: payload?.agent ?? "claude"` (terminal-dock.tsx ~l.1909/1945/1967). In TerminalSessionView, `launchAgent = entry.agent ?? agent ?? "claude"`; Setup/Timeout panels' Connect use `launchAgent`; only the ReadyPanel (which shows the picker) uses the picker's `agent`.
7. Per-Mac update flow (K): `use-helper-update-flow.ts`: `names = getMachineIdentities()`; empty → skip the end call and the quiesce and go straight to the download; else `/session/end {all:true, machines}`, `/helper/command {cmd:"quiesce", machines}`, status poll `?machines=`. Same `machines` for the My sessions panel's stop / always-on and `helper-row.ts` status. Decision 9: `updateConfirmBody` adds "on this Mac".
8. `MINIMUM_RECOMMENDED_HELPER_VERSION = "0.3.25"` (src/lib/terminal/helper-version.ts).
9. Decision 7 (if approved): ended panel "Launch again" → "Start again"; update unit and e2e tests that look for the old label.

### Commit 7 — docs
CLAUDE.md In-App Terminal rules: add "the helper resolves the project folder on the Mac before the agent starts (this Mac's saved folder → search → clone → new folder) and records it under every name the Mac reports; the page never sends another Mac's folder" and "a bridge 1000 close ends the session at once; only an abnormal close gets the 90s hold". terminal/RUN.md: the new routes and frames. Search src/app/guide for first-launch folder wording ("cd your local clone", "record_project_path", "folder") and update. Finalise these notes.

## Isolation, launch link, Codex
- Worktree: the mint still says isolate when any session is live on the board; the bridge narrows it to "a live session on THIS Mac" (null workspace keeps the page's flag). Eligibility runs on the resolved folder: a fresh clone has commits (eligible); a new repo-less folder isn't a git repo (existing fallback note). Resume never adds `--worktree` (unchanged). Worktree `pwd`s are collapsed server-side (unchanged).
- Launch-URL budget: no new link params, page prompt unchanged, the bridge's note is added locally. The per-Mac rule can only remove a `cwd=` the old rule borrowed. `launch-claude-code.guide-bootstrap.test.ts` and the deep-link budget tests must pass unchanged.
- Codex: same resolver, same screens (Codex wording), Codex install link, same prompt note; Codex has no `--worktree`.

## Security notes
- New bridge routes verify the bridge token signature and that the session row's owner matches; the aged-token waiver applies only with the row's own owner, an active row, ≤24h.
- Paths re-validated server-side; clone URL built server-side from the board's repo; argv arrays only; `GIT_TERMINAL_PROMPT=0` so a hidden process never waits on a password.
- The `bridge-cwd` frame is plaintext over the relay (metadata, like host/conv today); git error details go only in the encrypted stream.
- The search reads directory listings and `.git/config` text only; no git process per directory.

## Regression tests (write each first and watch it fail)
| # | Test | Where | Fails before because |
|---|---|---|---|
| 1 | Bridge leg closes 1000 "pty-exit" → browser gets close 1000 "pty-exit" within 1s, never `peer-degraded`, one closed-callback `bridge_ended`; a 1006 still gets `peer-degraded` + grace | terminal/relay (unit with fake state) + terminal/test (stand-in) | today the 1000 close opens the 90s hold (E) |
| 2 | Browser attaches to that sid within 10 min → closed 1000 + reason; after expiry → normal | relay + stand-in | no tombstone today |
| 3 | Two helper legs, different machine labels → both stay; same label → older retired; `quiesce` with machines=[mini] reaches only the mini leg; no match → `delivered:false`; status per machine | relay + stand-in | single slot preempts (K) |
| 4 | Real-process: launch with `cwd=<missing>`, a stand-in app answering workspace with `savedFolders=[<missing>]` and a repo, temp HOME holding a checkout (git init + origin) at `~/<repo>` → the sentinel command runs IN that checkout; folder route called with it | terminal/test (new `fresh-mac-folder.test.mjs`, added to package.json list) | today node-pty spawns into the missing folder: exit 1, 0 bytes (A, reproduced) |
| 5 | Same with no checkout and a local bare repo as the clone source → cloned into `~/projects/<repo>`; with a taken name → `-2` | terminal/test | no clone today |
| 6 | Resume with missing cwd → close reason `folder-missing`, banner, nothing spawned | terminal/test | today spawns and dies silently |
| 7 | `BRIDGE_CMD="sh -c 'exit 1'"` → close reason `agent-stopped-early:1` | terminal/test | today "pty-exit" |
| 8 | folder-resolve unit: hint/saved/search/clone/create order; `.git` file skipped; `.claude/worktrees` skipped; symlink loop terminates; budget stops; never "/", home, top-level; ranking by recency; Documents not read | terminal/bridge | new module |
| 9 | git-clone unit: progress parsing; error classes from canned stderr; partial dir removed; gh/ssh fallbacks only after access failures | terminal/bridge | new module |
| 10 | `chooseLaunchCwdDetailed`: mini names + MacBook-only rows → undefined; mini own row + differing MacBook row → mini's path; MacBook two names agreeing → path; own names disagreeing → undefined | src/lib/launch-claude-code.test.ts | today returns the MacBook path (B) / undefined (C) |
| 11 | `mapCloseCode(1000,"agent-stopped-early:1")` → session-ended, reason, detail; ended-copy table pinned; `canResume` false; old-helper rule | src/lib/terminal/connection.test.ts, ended-copy.test.ts | reason parsed as "remote" today |
| 12 | Bridge-version frame clears the 8s timer (fake timers) → no "helper-timeout" | src/components/board/use-terminal-session.test.ts | today only PTY bytes clear it (F) |
| 13 | Dock: remembered agent "codex", Claude card launch, payload dropped, Setup "Connect" → mint body has no `agent:"codex"` | src/components/board/terminal-dock.test.tsx | today uses the dock-wide agent (I hazard) |
| 14 | Mint log includes `agent` | session/route.test.ts | missing today |
| 15 | workspace/folder routes: bad token 401, other owner 401, ended row → null, aged token OK only for the row's owner; refuses "/", home, /Users; strips worktrees; upserts every name; sets session cwd; no other-Mac folders returned | route tests | new routes |
| 16 | Update flow: no identities → no end call, no quiesce, download; with names → `machines` sent; end route filters by machine_label | use-helper-update-flow.test.ts, session/end route test | account-wide today (K) |
| 17 | `project-path.mjs` vs TS drift table; `machine-name.mjs`; new frames | vitest + terminal/test | new |
| 18 | `addMachineIdentity` only for sessions launched from this browser | use-terminal-session.test.ts | any attach adds today |
| 19 | Existing budget tests unchanged: `launch-claude-code.guide-bootstrap.test.ts`, deep-link tests | — | guard |

## Release order (one release)
0. Pre-checks: clean release worktree from `origin/master` (memory: helper-release-recipe). `TERMINAL_HELPER_VERSION` in Vercel is unset or will be set to 0.3.25. Fresh Apple app-specific password (`xcrun notarytool history` first).
1. Helper 0.3.25: `npm ci` in terminal/bridge AND terminal/helper, `npm run dist` (notarize), `spctl` accepted, `gh release create terminal-helper-v0.3.25 --prerelease` with the 4 artifacts, `curl -IL` the arm64 DMG → 200. Nothing points at it yet.
2. App: merge the PR to master (new routes, closed reason, page, min version 0.3.25). Wait until the production deploy for the merge commit is READY. The download link now serves 0.3.25 and old helpers see the update nudge.
3. Relay: from a checkout whose terminal/relay + terminal/shared equal master, `npm test` then `npx wrangler deploy`, `/healthz`, `wrangler deployments list`. Tell Nick first: live terminals blip and reconnect.
4. Nick updates each Mac from that Mac: board → "Update now" → only this Mac's helper closes → drag to Applications. Then on the Mac mini, browser terminal on board d650f96a: expect "Looking for…" → "Found it: ~/<repo>" → Claude starts there; the mini's row becomes `~/<repo>` (both its names).
Why: the app must accept `bridge_ended` before the relay sends it (else the callback 400s and sessions stay "active"); the min-version bump must not ship before the release exists; per-Mac quiesce needs the new relay, so update the Macs only after step 3.

## Older helper (0.3.24) against the new app + relay
- Launch: the page sends this Mac's own saved folder (or none). Where that folder is right (the MacBook), it works as today. On the mini (own row wrong) it still dies at once, but the relay now ends it immediately and the page shows "Claude Code stopped on your Mac straight away" with Update now (mock 2e), not 90s of reconnecting. With no own row it still starts at "/" with the old prompt self-heal until updated.
- Deliberate stops (quit, helper closed) end at once with honest copy (old bridges already close 1000 with a reason).
- Update now closes only that Mac's helper: old helpers send `machineLabel = hostname`, and the browser knows that name from its own launches. A browser with no remembered name skips the close and downloads.
- No `bridge-cwd` frame: the page keeps using its own hint for the session folder.
New helper against the OLD relay (if step 3 slipped): deliberate stops keep the 90s hold, but the reason line is visible in the terminal. New helper against the OLD app (only if someone installs it from GitHub before step 2): the workspace route 404s → the hint is used if it exists, else "Couldn't check where this project lives".

## Evidence trail (first pass)
- Vercel logs 09:15-10:05Z: mint, key, agents and closed-callback times per session; one quiesce at 09:24:31 (delivered=false).
- Mac mini unified log: bridge child exits at 09:29:45.1, 09:34:33.7, 09:34:47.3, 09:36:16.7; helper exits = +60s.
- Helper log capture (8d7499d6): "spawning PTY" cwd `~/projects/<repo>` → "PTY exited" exitCode 1 after 20ms → "shutting down" why pty-exit, bytesOut 0.
- Relay tail 09:37-10:06Z (scratchpad, not committed): bridge attach 10:01:28.35, grace teardown 10:02:58.4 (+90s); later browser re-attaches closed 4011 after ~8s (INFERRED: TERMINAL_E2EE_REQUIRED on in prod).

## Manual data changes (by the orchestrator, NOT the fix)
- 10:04:19Z record_project_path d650f96a, Nicks-Mac-mini.local → `~/<repo>` (made both Macs launch at "/", cause C).
- 10:06:55Z rewritten to `~/projects/<repo>` (doesn't exist on the mini). The mini's own row is wrong until the fixed helper re-records it. For a true never-seen-Mac check, use another repo board with no mini row.
The Planner made no data changes.

## History (when it broke)
- 12 Jun (c498b9b): the prompt self-heal ("cd your local clone, or git clone…" + record_project_path every launch).
- 8 Jun (eaf353a) / 20 Aug (#187): borrowing another Mac's folder. 29 Aug (#233/#234): own row stops winning on disagreement → both Macs get nothing.
- 30 Jun (1f72842): browser terminal passes cwd straight to node-pty → silent death on a missing folder. 14 Oct (#361): browser terminal became the default launch on a Mac.
- 2 Jul (4bfa9e7): relay grace hold applied to every bridge close.

## Build log (Fix step, Atlas, 17 Oct)
Branch `fix/6b2cb8ac-fresh-mac-folder` from `origin/master` (db79594). Commits follow the plan's order 1-7. None of the old branch's commits were brought over; only this file and the mock were copied in as new files.

### Decisions made while building (and why)
Shared / relay:
- `TOMBSTONE_MS` lives in `relay/src/pairing.js`, not index.js: Cloudflare treats named exports from the worker file as entrypoints.
- Last-known helper status is written under EVERY name the leg reports (`helper:<name>:<field>`), not only the first: a browser may know the Mac only by its alias. At most 5 names.
- A live helper leg with no names (an old helper) is also retired when a named leg attaches: it can't be told apart from this Mac's.
- The tombstone reason is given only to the tombstone's owner; another account's attach takes the normal path, so a reason never leaks across accounts.
- With no `machines`, a helper command goes to the newest leg (the last attached), as the plan says.
- The stand-in relay gained `tombstoneMs` and an `onSessionClosed(sid, reason)` hook in place of the app callback.

App routes:
- One auth helper for both bridge routes (`src/lib/terminal/bridge-session-auth.ts`): read the session row first, then accept an aged bridge token only for that row's own owner, active, within 24h.
- Folder route: an ended/missing session gets 409 `session-not-active` (the plan was silent). The cwd update also checks `status = active` (concurrency-guard rule).
- Folder records: reads match hostnames case-insensitively, but a write reuses an existing row's spelling of the name, because the table's unique key is case-sensitive and lower-casing would add duplicates next to today's mixed-case rows.
- `otherLiveSessionsOnThisMac` ignores expired rows; if that read fails it reports 1 (keeps the page's isolate flag: "isolate when unsure").
- A failed board read returns 500 instead of `{workspace:null}`; the bridge treats both as "no workspace".
- Per-Mac filtering in session/end runs in code, not in the query, because stored machine names vary in case.

Bridge / helper:
- Three launch modes: an explicit `--cmd` with no prompt (dev/tests only) keeps the old start-first behaviour in the hint or `process.cwd()` (keeps prompt-launch AC8 and the roundtrip tests unchanged); a resume checks its folder synchronously; every other launch resolves the folder after the relay's `attached` frame. A real launch never falls back to the helper's own folder `/`.
- The final guard checks the path as given AND its realpath (`/tmp` resolves to `/private/tmp`, which would otherwise pass). Search results pass the same guard; the search never descends into a checkout.
- The prompt note is added only when there is a prompt and the folder differs from the page's hint (compared by realpath). Small addition: a folder from this Mac's saved list says "(this Mac's saved folder)".
- The folder is recorded only when the workspace lookup succeeded (3s, before the agent starts). The bridge-cwd frame is sent only while the link is open (text frames aren't buffered). The bridge prints "Downloaded. Starting <agent> there." itself after a clone.
- The early-exit rule applies to every exit code, 0 included (as planned); a signal exit with no code reports 0.
- `machineAliases` is sent comma-separated (the relay parses it with `sanitizeMachineList`).

Page:
- The page uses only folders saved under one of this browser's machine names. With none it sends no `cwd=` and the helper finds or downloads the project. Consequence: a "set manually" pin (hostname `set manually`, written only by a browser that has never had a terminal) is ignored until the pin migration gives it a real Mac name. Prod has no such rows (checked in step 1).
- A Mac's name is remembered only for sessions this browser launched; the server still records `machine_label` for every session.
- The helper's first hello (bridge-version frame) clears the 8s "couldn't reach the helper" timer.
- All ended-screen wording lives in `src/lib/terminal/ended-copy.ts`, pinned to the mock by `ended-copy.test.ts`. Wording not in the mock: the unsafe-folder screen ("Couldn't find a safe project folder") and plainer fallbacks when the project or folder isn't known (e.g. "Couldn't download the project").
- The "always Claude" default applies to tabs started from a launch payload; a tab created with nothing in hand still follows the picker.
- A browser that knows no Mac name skips the update confirm (nothing will be ended) and goes straight to the download, with today's honest "couldn't reach the helper to close it" notice. The confirm's session count is unchanged (it can still include another Mac's sessions); only its wording says "on this Mac".
- "Launch again" inside the bad-token error message was left alone: it's the error panel's text, not the ended screen's button.

### Regression tests (failed before, pass after)
Evidence in the Fix step's scratchpad (`evidence/*-before.txt`, `*-after.txt`).
1-2. Relay: `terminal/relay/src/bridge-end.test.js`; stand-in: `terminal/test/bridge-end.test.mjs`.
3. `terminal/relay/src/helper-legs.test.js`, `terminal/test/helper-legs.test.mjs`.
4-7. `terminal/test/fresh-mac-folder.test.mjs` (test 4 reproduced cause A before the fix: PTY exit 1 after 0.04s, 0 bytes).
8. `terminal/bridge/src/folder-resolve.test.js`. 9. `terminal/bridge/src/git-clone.test.js` (+ `bridge-copy.test.js`).
10. `src/lib/launch-claude-code.test.ts` "chooseLaunchCwdDetailed — per-Mac rule". 11. `src/lib/terminal/connection.test.ts` "bridge end reasons", `src/lib/terminal/ended-copy.test.ts`.
12, 18. `src/components/board/use-terminal-session.test.ts`. 13. `terminal-dock.test.tsx`, `terminal-session-view.test.tsx`.
14-16. `src/app/api/terminal/session/{route,workspace/route,folder/route,end/route}.test.ts`, `helper/{command,status}/route.test.ts`; page half in `src/lib/terminal/use-helper-update-flow.test.ts`, `helper-update-flow.test.ts`.
17. `src/lib/terminal/project-path.drift.test.ts`, `terminal/shared/{machine-name,project-path}.test.mjs`, `terminal/test/control-frames.test.mjs`.
19. `launch-claude-code.guide-bootstrap.test.ts` and the deep-link tests pass unchanged.
Old tests that pinned the bug (the borrowing rules 2/3 and "manual pin wins" in `launch-claude-code.test.ts`) were rewritten for the per-Mac rule.

### Results at hand-off
- `terminal/bridge` node --test 147/147; `terminal/relay` npm test 87/87; `terminal/test` 306/307: the one failure is `orphan-cleanup.test.mjs` case (a) (25s exit timeout), which fails the same way on untouched master.
- Root `npm run test` 5029 passed / 5 skipped; `npm run typecheck` clean; `npm run lint` 0 errors.
- Mock: the built ended screens and update confirm were rendered with the app's styles and compared with the mock at 375px and 1280px; they match (only the terminal lines behind each panel and the example session ids differ).

### Release checklist (for the release session, after code review)
0. Clean release worktree from `origin/master` after the merge (never reset the main checkout). Check `TERMINAL_HELPER_VERSION` in Vercel is unset or 0.3.25. Fresh Apple app-specific password (`xcrun notarytool history` first).
1. Helper 0.3.25 (`terminal/helper/package.json` already says 0.3.25): `npm ci` in `terminal/bridge` AND `terminal/helper`, `npm run dist` (notarized), `spctl` accepted, `gh release create terminal-helper-v0.3.25 --prerelease` with the 4 artifacts, `curl -IL` the arm64 DMG → 200.
   Ordering issue: the min-version bump is in this PR, so step 1 must finish before step 2.
2. Merge the PR to master; wait until the production deploy for the merge commit is READY (the app must accept `bridge_ended` before the relay sends it). Check the helper download redirect serves 0.3.25.
3. Relay: from a checkout whose `terminal/relay` + `terminal/shared` equal master, `npm test`, then `npx wrangler deploy`, `/healthz`, `wrangler deployments list`. Tell Nick first: live terminals blip and reconnect.
4. Nick updates each Mac from that Mac (board → Update now → only this Mac's helper closes → drag to Applications). Then on the Mac mini, browser terminal on board d650f96a: expect "Looking for…" → "Found it: ~/<repo>" → Claude starts there, and the mini's saved folder is corrected under both its names.

## Rework after code review (Fix step, Atlas, 17 Oct)
Two blocking problems from the review, plus three small safety notes. Every new test was written first and failed on the branch before the change (evidence in the Fix step's scratchpad, `rework-evidence/*-before.txt`).

### Decisions (and why)
1. A moved project's real checkout was skipped and a second copy downloaded (this board's saved GitHub address still names the old owner; the checkout's origin names the organisation; SSH host aliases failed the same way).
   - The page's folder and this Mac's saved folders are trusted when they exist and are a git checkout (a real `.git` folder) **unless every remote names a different project name**. A checkout with no remotes is trusted. I kept that one check instead of dropping the remote check entirely (the reviewer's first suggestion): a saved row can still be stale and point at another project, and opening the wrong project is worse than one search.
   - Project name = last segment of any remote, `.git` dropped, lower-cased (`repoNameFromRemote`): covers a changed owner, SSH host aliases, other hosts and local paths.
   - Search ranking: exact GitHub owner/name first, then origin over another remote, then most recently used. A same-name-only match is the fallback after every exact match.
   - Before downloading, `~/projects/<repo>` is reused (`how: "found"`) when it is already a checkout with a same-name remote. The search normally finds it first; this covers a search that stopped on its time or folder budget.
   - Real-disk probe (read-only, download stubbed, this board's production address naming the old owner): with the page's folder → `~/projects/vibe-coding-ideas` (`saved`); with nothing known → the search picks `~/projects/vibe-coding-ideas` (`found`) and lists the other checkout as also found. No download, nothing written.
2. "Set exact folder" in a browser that has never run a terminal session saves under `set manually`, and the per-Mac rule ignored it. Now, **only when the browser knows no machine name**, the `set manually` rows count as its own (the helper re-checks the folder on the Mac anyway). A browser that knows its Mac's names still never uses a `set manually` row: it could be any Mac's (the plan's "never another Mac's row"). This replaces the build-log line saying such pins are ignored until the pin migration.
3. Safety notes:
   - The search skips `*.vibecodes-partial-*` folders. Before a download, leftover partial folders of the same project (`<repo>` or `<repo>-2…-9`) are removed when the process that made them is no longer running; a running one (another helper downloading right now) is left alone.
   - Resume uses the same guard as a launch (`resolveResumeFolder`, shared by the resolver and the bridge's start-up): never `/`, the home folder or a top-level folder → `folder-not-allowed`, nothing spawned. A resume still opens the folder as given (not its realpath), as before.
   - A GitHub owner or name starting with `-` is refused in the workspace route and in the bridge's check of the app's answer (`sanitizeWorkspace`, moved into folder-resolve.js so it can be tested), so it can never reach git or gh as an option.
- No visible wording changed. The two unmocked wordings ("Couldn't find a safe project folder", the generic "Couldn't download the project") are untouched, waiting on Nick.

### Known follow-ups (not done here)
- The review's other non-blocking notes are left as they are (see the Code review step's output).

### Tests that failed before and pass after
- `terminal/bridge/src/folder-resolve.test.js`: "moved project…", "SSH host alias…", "a saved checkout with no remotes is trusted…", "search: a project-name-only match…", "search: a different project with another name is never a match" (guard), "search: a half-downloaded *.vibecodes-partial-* folder is never picked", "before downloading: ~/projects/<repo> … reused, not -2", "resolveResumeFolder…", "sanitizeWorkspace drops a repo whose owner or name starts with '-'", "repoNameFromRemote…".
- `terminal/bridge/src/git-clone.test.js`: "stale half-downloads of this project left by a dead process are cleared first; a live one is left alone".
- `terminal/test/fresh-mac-folder.test.mjs`: 8a moved project (before: cloned into `widget-2`), 8b SSH host alias (before: cloned into `~/projects/widget`), 8c resume into the home folder (before: spawned there and ran).
- `src/lib/launch-claude-code.test.ts`: "a manually-pinned row (MANUAL_PIN_HOSTNAME) resolves like any own row in a browser that knows no machine name" (restores the deleted test for the no-names case), plus "a browser that knows its Mac's names never uses a manually-pinned row" (guard).
- `src/app/api/terminal/session/workspace/route.test.ts`: "a GitHub address whose owner or name starts with '-' gets repo null".

### Release checklist
Unchanged: still one release (helper 0.3.25 + app + relay, in the order above). The rework touches only the bridge (ships in the helper) and the app; no relay change, no new route, no migration.
