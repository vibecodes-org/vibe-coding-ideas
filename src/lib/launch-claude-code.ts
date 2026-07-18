/**
 * Launch Claude Code — pure logic for deep links, prompt builders, and per-idea
 * path persistence. See docs/launch-claude-code-design.html (approved design).
 *
 * All functions here are framework-agnostic and unit-tested. The deep link opens
 * the user's local, subscription-authed Claude Code via the `claude-cli://` scheme;
 * the prompt it pre-fills bootstraps the `vibecodes` MCP connector and then
 * picks up board work. The human reviews + presses Enter (human-in-the-loop).
 */

/**
 * Hard cap on the deep-link `q` (prompt) length, measured on the URL-ENCODED
 * value (acceptance criterion #6: `encodeURIComponent(q).length <= 5000`).
 * The work-context tail is trimmed until the encoded prompt fits.
 */
export const MAX_DEEP_LINK_PROMPT_LENGTH = 5000;

/**
 * Hard ceiling on the FULL `claude-cli://` URL for the deep-link path. Chromium
 * silently refuses to launch an external-protocol URL past an OS limit (Windows
 * ShellExecute ≈ 2083 chars; macOS higher but finite) — the launch just no-ops,
 * no error. The verbose bootstrap prompt blew past this on a no-repo "new" board
 * (~5000-char URL → silent failure). The deep link therefore uses the COMPACT
 * prompt builder, kept well under this; the copy-command (no URL limit) keeps the
 * verbose prompt. 1900 leaves margin below the strictest (Windows) ceiling.
 */
export const MAX_DEEP_LINK_URL_LENGTH = 1900;

/** localStorage key namespace for the per-user-per-idea launch path. */
export const LAUNCH_PATH_KEY_PREFIX = "vibecodes:launch-path:";

export type LaunchMode = "existing" | "new";

/** Persisted per-idea launch config (machine-specific; localStorage only). */
export interface LaunchPathState {
  mode: LaunchMode;
  /** Existing mode: the absolute project path. New mode: composed parent/name. */
  path: string;
  /** New mode: absolute parent folder the new dir is created inside. */
  parent?: string;
  /** New mode: the new folder name. */
  name?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Deep link + MCP endpoint
// ────────────────────────────────────────────────────────────────────────────

interface DeepLinkParams {
  prompt: string;
  cwd?: string;
  repo?: string;
}

/**
 * Build a `claude-cli://open?q=…&cwd=…&repo=…` deep link.
 *
 * Uses encodeURIComponent so spaces become `%20` (NOT `+` — application/x-www-
 * form-urlencoded `+` is wrong for a custom-scheme query the CLI parses raw).
 * `cwd` / `repo` are omitted entirely when absent (no empty params).
 */
export function buildClaudeDeepLink({ prompt, cwd, repo }: DeepLinkParams): string {
  const parts = [`q=${encodeURIComponent(prompt)}`];
  if (cwd) parts.push(`cwd=${encodeURIComponent(cwd)}`);
  if (repo) {
    // The handler expects an `owner/name` SLUG, not a full URL. Normalise so a
    // raw github_url (https://github.com/owner/name) becomes owner/name, and a
    // value we can't reduce to a slug is dropped rather than sent broken.
    const slug =
      parseRepoFromGithubUrl(repo) ??
      (/^[\w.-]+\/[\w.-]+$/.test(repo.trim()) ? repo.trim() : null);
    if (slug) parts.push(`repo=${encodeURIComponent(slug)}`);
  }
  return `claude-cli://open?${parts.join("&")}`;
}

/** Resolve the VibeCodes MCP HTTP endpoint from the app URL (trailing-slash safe). */
export function mcpEndpoint(appUrl: string): string {
  return `${appUrl.replace(/\/+$/, "")}/api/mcp`;
}

/** URL-encoded length, i.e. the size of the value that lands in the `q` param. */
function encodedLength(s: string): number {
  return encodeURIComponent(s).length;
}

/**
 * The trailing marker enforcePromptLength appends whenever it trims anything
 * (head OR tail). Hoisted to a module constant (was a local inside
 * enforcePromptLength) so fitEssentialHead (BUG B fix, below) can reserve the
 * same amount of budget headroom for it — guaranteeing its own atomic head
 * never needs a SECOND, char-level trim pass once enforcePromptLength sees it.
 */
const TRUNCATION_MARKER = "\n…(truncated)";

/**
 * Enforce a cap on the URL-ENCODED prompt (acceptance criterion #6). The
 * MCP-setup `head` is load-bearing (without it the agent can't connect), so it
 * is preserved verbatim whenever possible — we trim only the variable `tail`
 * until `encodeURIComponent(head + tail).length <= cap`.
 *
 * `head` must already contain whatever joins it to the tail (e.g. a trailing
 * newline); `tail` is appended as-is.
 *
 * BUG 6 (root cause, 4th rework cycle): a function named `enforcePromptLength`
 * MUST guarantee `encodeURIComponent(return).length <= cap` in ALL cases. The
 * prior implementation broke that guarantee two ways: (1) the "never sacrifice
 * the head" branch returned `head` VERBATIM once `encodedLength(head) >= cap`,
 * without ever trimming it back under the cap; (2) the tail binary search's
 * floor (`lo = 0`) returned `head + ellipsis` unconditionally, never checking
 * that `head + ellipsis` itself actually fits `cap` — so a head that was just
 * UNDER the cap alone could still tip over once the ellipsis marker was added.
 * Both let an over-cap string escape this function.
 *
 * Fix: whenever `head + ellipsis` alone doesn't fit `cap`, trim the HEAD too —
 * the largest prefix of `head` whose encoded `(prefix + ellipsis)` fits `cap`,
 * via the same monotonic binary search used for the tail. Only once
 * `head + ellipsis` is confirmed to fit on its own do we fall through to the
 * normal tail-trim path, where `lo = 0` (tail fully dropped) is now guaranteed
 * to be a valid floor. Real heads (~1k chars) sit far under any realistic cap
 * (>=1900 for the deep link, 5000 for the copy-command prompt, or a computed
 * URL budget in between), so the head-trim branch is a no-op for every
 * non-pathological caller — this only changes the pathological floor case.
 *
 * `cap` defaults to the claude-cli:// deep-link budget; the in-browser terminal
 * launch passes its own per-launch budget (the vibecodes:// URL ceiling minus
 * the session/token overhead — see terminal-dock.tsx).
 */
export function enforcePromptLength(
  head: string,
  tail: string,
  cap: number = MAX_DEEP_LINK_PROMPT_LENGTH
): string {
  const full = head + tail;
  if (encodedLength(full) <= cap) return full;

  const ellipsis = TRUNCATION_MARKER;

  // Pathological: even `head + ellipsis` alone doesn't fit `cap` (whether
  // because the head alone already exceeds it, or because adding the
  // ellipsis marker tips an otherwise-fitting head over). Trimming the tail
  // (below) can never rescue this — the tail can shrink to nothing and the
  // marker is still there — so trim the HEAD too: the largest prefix whose
  // encoded `(prefix + ellipsis)` fits `cap`.
  if (encodedLength(head + ellipsis) > cap) {
    let lo = 0;
    let hi = head.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      const candidate = head.slice(0, mid) + ellipsis;
      if (encodedLength(candidate) <= cap) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return head.slice(0, lo) + ellipsis;
  }

  // Largest tail length whose encoded (head + tail + ellipsis) fits. Binary
  // search on the raw tail length — encodedLength is monotonic in it. The
  // branch above guarantees `head + ellipsis` alone already fits `cap` before
  // we get here, so lo=0 (tail fully dropped) is always a valid floor.
  let lo = 0;
  let hi = tail.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = head + tail.slice(0, mid) + ellipsis;
    if (encodedLength(candidate) <= cap) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return head + tail.slice(0, lo) + ellipsis;
}

// ────────────────────────────────────────────────────────────────────────────
// Repo parsing + folder-name validation
// ────────────────────────────────────────────────────────────────────────────

/**
 * Parse a GitHub URL into `owner/name`, or null when it isn't a usable repo URL.
 * Degrading to null lets create-new fall back to `git init` rather than emitting
 * a broken `git clone` (Design Review nit #5).
 */
export function parseRepoFromGithubUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  // Strip protocol / host / scp-style prefixes, leaving the path.
  let path = trimmed
    .replace(/^https?:\/\/(www\.)?github\.com\//i, "")
    .replace(/^git@github\.com:/i, "")
    .replace(/^ssh:\/\/git@github\.com\//i, "");

  // If nothing was stripped it wasn't a GitHub URL.
  if (path === trimmed) return null;

  path = path.replace(/\/+$/, "").replace(/\.git$/i, "");
  const segments = path.split("/").filter(Boolean);
  if (segments.length < 2) return null;

  const [owner, name] = segments;
  // Reject obviously invalid owner/name (GitHub allows alnum, hyphen, dot, underscore).
  const valid = /^[A-Za-z0-9._-]+$/;
  if (!valid.test(owner) || !valid.test(name)) return null;

  return `${owner}/${name}`;
}

export interface FolderNameValidation {
  valid: boolean;
  /** Human-readable message naming the offending characters (warn, don't block). */
  message?: string;
  /** The distinct invalid characters found, for naming them in the UI. */
  invalidChars?: string[];
}

/**
 * Light-touch validator for the new-folder name. Allows letters, numbers, `-`,
 * `_`, `.`. Warns (does not block) and names the offending characters.
 */
export function validateFolderName(name: string): FolderNameValidation {
  const trimmed = name.trim();
  if (!trimmed) {
    return { valid: false, message: "Name the new folder." };
  }
  const offenders = Array.from(new Set(trimmed.match(/[^A-Za-z0-9._-]/g) ?? []));
  if (offenders.length > 0) {
    const named = offenders
      .map((c) => (c === " " ? "spaces" : `"${c}"`))
      .join(", ");
    return {
      valid: false,
      invalidChars: offenders,
      message: `Use letters, numbers, - or _ (no slashes or spaces). Remove: ${named}`,
    };
  }
  return { valid: true };
}

/** Light-touch absolute-path check (warn, don't block). */
export function looksAbsolutePath(path: string): boolean {
  const p = path.trim();
  // POSIX absolute, home-relative, or Windows drive letter.
  return /^\//.test(p) || /^~(\/|$)/.test(p) || /^[A-Za-z]:[\\/]/.test(p);
}

/**
 * STRICT absolute-path validation for `record_project_path` (the value the agent
 * reports from an EXPANDED `pwd`). Unlike `looksAbsolutePath`, this REJECTS:
 *  - empty / whitespace-only
 *  - relative paths (no leading `/`, drive, or UNC)
 *  - home-relative `~` / `~/…` (must already be the expanded pwd, never a tilde)
 *  - `$VAR` / `$HOME`-style unexpanded values
 *
 * Accepts: POSIX absolute (`/Users/nick/projects/x`), Windows drive
 * (`C:\Users\nick\x` or `C:/…`), and UNC (`\\server\share\x`).
 */
export function isValidAbsolutePath(path: string): boolean {
  if (typeof path !== "string") return false;
  const p = path.trim();
  if (!p) return false;
  // Reject any tilde-home or shell variable — those aren't an expanded pwd.
  if (p.startsWith("~")) return false;
  if (p.includes("$")) return false;

  const isPosix = p.startsWith("/");
  const isWinDrive = /^[A-Za-z]:[\\/]/.test(p);
  const isUnc = /^\\\\[^\\]+\\[^\\]+/.test(p);
  return isPosix || isWinDrive || isUnc;
}

/** Compose `parent/name` into a single path, normalising the joining slash. */
export function composeNewProjectPath(parent: string, name: string): string {
  const base = parent.trim().replace(/\/+$/, "");
  return `${base}/${name.trim()}`;
}

/** A recorded project path row (subset the launch UI needs). */
export interface RecordedProjectPath {
  absolute_path: string;
  hostname: string;
}

/**
 * Choose the cwd to inject into a no-repo launch deep link from the paths
 * recorded for (this user, this idea) — Design Review hostname rule, option (a):
 *
 *  - 0 records  → undefined (first-launch / home flow; the agent creates + records)
 *  - exactly 1  → that record's absolute_path
 *  - >1 records → undefined (ambiguous across machines; the browser can't know
 *                 which host it's on, so never inject a path we can't attribute
 *                 to THIS machine — fall back to the safe first-launch flow)
 *
 * A record is only usable if its absolute_path passes strict validation; bad
 * rows are ignored so a single corrupt record can't poison the choice.
 */
export function chooseLaunchCwd(
  records: ReadonlyArray<RecordedProjectPath> | null | undefined
): string | undefined {
  const usable = (records ?? []).filter((r) => isValidAbsolutePath(r.absolute_path));
  if (usable.length === 1) return usable[0].absolute_path.trim();
  return undefined;
}

/**
 * The single source of truth for "where will a no-repo launch open, and what do
 * we show the user?". DISPLAY and LAUNCH must derive from this same result so
 * they can never diverge (the bug: the dialog saved to localStorage but the
 * dropdown read only the DB).
 *
 * `cwd` is what gets injected into the deep link / copy command; `displayPath`
 * + `displayLabel` + `host` drive the dropdown's "This machine" line.
 */
export interface EffectiveLaunchTarget {
  /** Absolute cwd to inject into the launch, or undefined (first-launch flow). */
  cwd: string | undefined;
  /** The path to show the user (same value as `cwd` when present). */
  displayPath: string | undefined;
  /** Heading for the path line — names the source so it's honest. */
  displayLabel: string | undefined;
  /** Hostname for the DB-sourced case (null for the localStorage/device case). */
  host: string | null;
  /** Where the path came from. "none" → show no path line. */
  source: "saved" | "recorded" | "none";
}

export interface ResolveEffectiveLaunchTargetArgs {
  /** Whether the idea has a GitHub repo (repo-backed ideas never inject a cwd). */
  hasRepo: boolean;
  /** The user's saved localStorage launch config for this idea (or null). */
  saved: LaunchPathState | null;
  /** Paths the agent recorded in the DB for this user + idea. */
  recordedPaths: ReadonlyArray<RecordedProjectPath> | null | undefined;
}

/**
 * Resolve the effective launch target, preferring an explicitly-saved
 * existing-mode absolute path (localStorage — what the "Set exact folder" dialog
 * writes) over the agent-recorded DB path. This makes the dropdown reflect a
 * just-saved path immediately AND guarantees launch uses that same value.
 *
 * Precedence:
 *  1. Repo-backed idea → never inject a cwd (the `repo` slug resolves the folder).
 *  2. Saved `existing`-mode path that passes strict validation → use it
 *     (labelled "This machine — set manually" — localStorage has no hostname).
 *  3. Otherwise the DB recorded path via `chooseLaunchCwd` (0/1/>1 contract),
 *     labelled "This machine — <host>". Both share the "This machine — <detail>"
 *     shape so they read as one box with two path sources, not two concepts.
 *  4. Nothing usable → source "none" (first-launch flow; no path line).
 *
 * `new`-mode saved state is intentionally ignored here: its composed
 * `~/projects/<slug>` path is not a validated absolute pwd and must not surface
 * as a recorded/launch path (it's created + recorded by the agent on launch).
 */
export function resolveEffectiveLaunchTarget({
  hasRepo,
  saved,
  recordedPaths,
}: ResolveEffectiveLaunchTargetArgs): EffectiveLaunchTarget {
  if (hasRepo) {
    return { cwd: undefined, displayPath: undefined, displayLabel: undefined, host: null, source: "none" };
  }

  // Saved existing-mode absolute path wins — it's the user's explicit choice and
  // it's what the launch cwd resolution already used, so display now matches.
  if (saved && saved.mode === "existing") {
    const trimmed = saved.path.trim();
    if (isValidAbsolutePath(trimmed)) {
      return {
        cwd: trimmed,
        displayPath: trimmed,
        displayLabel: "This machine — set manually",
        host: null,
        source: "saved",
      };
    }
  }

  const recordedCwd = chooseLaunchCwd(recordedPaths);
  if (recordedCwd) {
    const match = (recordedPaths ?? []).find((r) => r.absolute_path.trim() === recordedCwd);
    return {
      cwd: recordedCwd,
      displayPath: recordedCwd,
      displayLabel: match ? `This machine — ${match.hostname}` : "This machine",
      host: match ? match.hostname : null,
      source: "recorded",
    };
  }

  return { cwd: undefined, displayPath: undefined, displayLabel: undefined, host: null, source: "none" };
}

// ────────────────────────────────────────────────────────────────────────────
// Prompt builders
// ────────────────────────────────────────────────────────────────────────────

export interface NewProjectOptions {
  /** Absolute path of the folder to create (parent/name). */
  newProjectPath: string;
}

interface CommonPromptArgs {
  appUrl: string;
  ideaId: string;
  mode: LaunchMode;
  /** Idea github_url (raw); resolved internally for the create-new clone step. */
  repoUrl?: string | null;
  newProject?: NewProjectOptions;
}

/**
 * The MCP-setup block — the part that must ALWAYS survive truncation. It is
 * placed at the very front of every prompt (existing and create-new) so the
 * length guard never trims it. In create-new mode it reads as step 1 of the
 * numbered setup sequence (steps 2/3 = mkdir + clone/init).
 */
function mcpSetupHead(appUrl: string): string {
  return `Make sure you can reach the VibeCodes board over MCP. If the board tools (get_my_tasks, claim_next_step, get_task, move_task) are ALREADY available, skip this section.

If they are NOT available, add the hosted connector, then hand sign-in back to me. IMPORTANT: do NOT build an OAuth URL or run the authorization yourself — Claude Code's built-in \`/mcp\` flow manages the browser sign-in (and its localhost callback) reliably; a hand-driven flow fails with "localhost refused to connect".
1. Add it at local scope (local scope intentionally overrides any existing project "vibecodes", e.g. a local stdio server, so there is no conflict):
     claude mcp add -s local --transport http vibecodes ${mcpEndpoint(appUrl)}
2. Then STOP and tell me to finish sign-in with the built-in flow: run \`/mcp\`, select "vibecodes", choose Authenticate, and approve in the browser. (If the browser ever shows "localhost refused to connect", copy the full URL from the address bar and paste it back into Claude Code — that's the supported fallback.)
3. Once I confirm it's connected, re-check the board tools and continue.

Do NOT debug or reconfigure other MCP servers, and do NOT improvise the OAuth flow. If the board tools still aren't available after I authenticate, stop and tell me rather than guessing.`;
}

/**
 * Concurrent-terminal auto-worktree isolation — the agent-side protocol a
 * launched local session runs at startup, BEFORE reading the board or picking
 * up any task. Builds on:
 *  - Requirements (ProdOwner): Scope C, auto-isolate each additional concurrent
 *    session into its own `git worktree`; first session unchanged (FR-1);
 *    dirty/unpushed worktrees are never deleted (FR-6); degrade, never block
 *    (FR-8).
 *  - UX Design (Compass, docs/concurrent-terminal-worktrees-design.html §3):
 *    the exact banner copy/glyphs below (● Primary checkout / ⧉ Isolated
 *    worktree / ⚠ Shared folder / ✓ Worktree removed).
 *  - Design Review (Nick, BINDING): mechanism (A) agent-side; worktree home
 *    sibling `<repo>.vibe/wt-N` on branch `vibe/wt-N`; PID-liveness lock
 *    (`kill -0`, not a heartbeat TTL); the lock lives OUTSIDE the repo at
 *    `~/.vibecodes/locks/<hash-of-abs-path>` so it never pollutes `git
 *    status`; lock content is THIS session's PID + the absolute path (so a
 *    recycled PID for a different process/path reads as stale); leftover
 *    worktrees are reconciled (clean ones auto-pruned, dirty/unpushed always
 *    kept) on the NEXT primary-claiming launch, since agents rarely fire exit
 *    hooks; a worktree session must never push to or merge the primary
 *    branch — only `vibe/wt-N`.
 *
 * Only used for existing-mode/no-repo launches (see directoryBlock and
 * buildCompactBootstrapPromptParts) — a repo-backed idea resolves its working
 * copy via the deep link's `repo` slug and is out of scope for this protocol.
 *
 * `variant: "compact"` returns a terse, budget-conscious rewrite of the same
 * steps for the URL-capped deep-link / in-browser-terminal prompt (see
 * MAX_DEEP_LINK_URL_LENGTH / MAX_LAUNCH_URL_LENGTH) — the full numbered
 * version below would blow those OS ceilings. Both variants keep every
 * load-bearing mechanic (lock path, `kill -0`, sibling + branch naming, the
 * never-push-primary directive, reconcile/auto-prune, degrade-don't-block);
 * the compact one drops only the prose explanations and the recovery-card
 * formatting.
 */
export function buildWorktreeIsolationProtocol(variant: "full" | "compact" = "full"): string {
  if (variant === "compact") {
    return `Not a git repo? Skip, warn shared folder, continue. LOCK=~/.vibecodes/locks/<pwd-hash>; kill -0 PID AND path==$PWD -> lowest free N, worktree add ../<repo>.vibe/wt-N -b vibe/wt-N, never push primary, only wt-N. Else: dirty=git status --porcelain nonempty; unpushed=git log @{u}.. nonempty or no @{u}+commits; prune only if clean+pushed; else keep dirty/unpushed, never git worktree remove --force during auto-prune (even on retry), claim here.`;
  }

  return `WORKTREE ISOLATION - run before any board work.

0. Not a git repo? Print, stay here:
     ⚠ Shared folder - isolation unavailable (not a git repository)
       Concurrent edits may clash. Continuing anyway.

1. LOCK=~/.vibecodes/locks/$(printf '%s' "$PWD"|shasum -a 256|cut -c1-16)

2. Live PID in $LOCK (kill -0) AND its recorded path == $PWD -> step 3 (a
   recycled PID for a different process/path is NOT live — treat as stale).
   Else stale -> step 4; overwrite.

3. ISOLATE: REPO=$(basename "$(git rev-parse --show-toplevel)"); pick the
   LOWEST FREE N (../$REPO.vibe/wt-1, wt-2, … — the first that doesn't already
   exist, so a bare wt-N never collides with a kept dirty worktree); git
   worktree add ../$REPO.vibe/wt-N -b vibe/wt-N. Fails: warn, stay. Else: cd in,
   relock, print:
     ⧉ Isolated worktree - <path> - branch vibe/wt-N
   Push only vibe/wt-N when done; never the primary branch.

4. CLAIM PRIMARY: for each leftover ../<repo>.vibe/wt-*, check dirty
   (\`git status --porcelain\` non-empty) and unpushed (git log @{u}..
   --oneline non-empty, or no @{u} with commits ahead of primary). Clean AND
   fully pushed -> prune, print "✓ Worktree removed"; else keep dirty/unpushed
   (never delete), print:
     ⧉ Worktree kept - <path>, branch vibe/wt-N
       Resume cd <path>; publish git push -u origin vibe/wt-N + PR; discard
       git worktree remove <path> --force.
   Never run \`git worktree remove --force\` during auto-prune (even on retry)
   — dirty/unpushed always means KEEP; --force above is for a HUMAN's
   deliberate discard only.
   Write the lock, print:
     ● Primary checkout - <path> - branch <branch> - only session on this folder`;
}

/**
 * The create-new (no-repo / repo-into-new-folder) bootstrap steps. Idempotent
 * intent. Numbered to follow the MCP-setup head (step 1), so it reads as one
 * sequence. Order is load-bearing: cd/create FIRST → pwd → record_project_path
 * (only after the connector is confirmed) → THEN write project files. This keeps
 * CLAUDE.md and all scaffolding in the project folder, never in home, and
 * persists the resolved path so future launches open straight in the folder.
 *
 * @param ideaId  the idea_id to record the path against
 */
function newProjectSteps(
  newProjectPath: string,
  ideaId: string,
  repoUrl?: string | null
): string {
  const repo = parseRepoFromGithubUrl(repoUrl);
  const setupStep = repo
    ? `Then set up its contents based on what you find — do NOT overwrite existing work:
     • Empty / just-created → clone the repo: git clone https://github.com/${repo}.git .
     • Already a git checkout → leave it; optionally fast-forward: git pull --ff-only || true
     • Has files but no git → use them as-is; do NOT clone over them.`
    : `Then set up git based on what you find — do NOT overwrite existing work:
     • Empty / just-created → initialise: git init
     • Already a git repo, or already has files → leave it as-is.`;

  return `STEP 0 — get into this idea's project directory. This is MANDATORY and comes before everything else, including reading the board. This session has started in your home directory, which is the WRONG place to work.
  • If ${newProjectPath} ALREADY EXISTS, cd into it and reuse it as-is — do NOT re-clone, re-init, or overwrite existing files.
  • If it does NOT exist, create it: mkdir -p ${newProjectPath} && cd ${newProjectPath}
  • ⚠️ This applies EVEN IF the first task is planning, research, design, or "board-only" work with no files yet. Do NOT stay in your home directory on the reasoning that "no files are needed yet" or "the repo will be created later" — that mis-files this idea's history and config under home. EVERY session for this idea runs from its project folder. No exceptions.
Then confirm and record exactly where you are (this lets future launches open straight in this folder):
  • Run \`pwd\` and capture the absolute path it prints — this is the authoritative location on this machine, not a guess.
  • ⚠️ If \`pwd\` still shows your home directory, STOP — you have not changed into the project folder. cd into it before doing anything else.
  • Get the machine name: run \`hostname\` (or \`uname -n\`).
  • As SOON as the vibecodes board tools are available (you connect them in the MCP step below), call record_project_path with idea_id "${ideaId}", that hostname, and the \`pwd\` output — do this BEFORE picking up any task. Repeat it on EVERY launch (self-heal) so a moved or renamed folder updates the stored path.
${setupStep}
Only AFTER you are confirmed inside the project folder (pwd is NOT home) should you write any files — CLAUDE.md, .vibecodes/, scaffolding — so everything lands in the project, never in your home directory.`;
}

/** Default parent for a brand-new project — home-relative so it needs no absolute path. */
export const DEFAULT_NEW_PROJECT_PARENT = "~/projects";

/** Slugify an idea title into a safe default folder name (letters/numbers/dashes). */
export function slugifyIdeaTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug || "project";
}

/**
 * The directory-resolution block. The browser never supplies an absolute path;
 * the launched (local) Claude Code resolves WHERE to work:
 *  - new mode → mkdir the suggested folder, then clone/init (handled by the agent);
 *  - existing mode WITH a repo → open the local clone, or clone it if missing
 *    (repo-backed; OUT OF SCOPE for worktree isolation — the repo slug already
 *    resolves the folder deterministically, no concurrent-terminal ambiguity);
 *  - existing mode WITHOUT a repo → rely on the deep link's cwd, if any, and run
 *    the worktree-isolation protocol (buildWorktreeIsolationProtocol) — this is
 *    the "launches that inject a cwd" case the concurrent-terminal design
 *    targets: a real local shell about to sit in a possibly-shared folder.
 * Home-relative (`~/…`) suggestions are fine — the agent expands them in the shell.
 */
function directoryBlock({
  ideaId,
  mode,
  repoUrl,
  newProject,
}: Pick<CommonPromptArgs, "ideaId" | "mode" | "repoUrl" | "newProject">): string {
  if (mode === "new" && newProject) {
    return newProjectSteps(newProject.newProjectPath, ideaId, repoUrl);
  }
  const repo = parseRepoFromGithubUrl(repoUrl);
  if (repo) {
    return `First, get into this idea's repository (${repo}) — do this before anything else:
  • If you already have it cloned locally, cd into that working copy.
  • If not, clone it first (suggested location ${DEFAULT_NEW_PROJECT_PARENT}/${repo.split("/")[1]}):
     git clone https://github.com/${repo}.git ${DEFAULT_NEW_PROJECT_PARENT}/${repo.split("/")[1]}`;
  }
  // Worktree isolation is scoped to existing-mode/no-repo only (the deep
  // link's cwd, if any). A "new" mode call that reaches here (e.g. a caller
  // that never supplied `newProject`) falls back to the prior no-op — it's
  // about to create a brand-new folder, not sit in a possibly-shared one.
  if (mode === "existing") {
    return buildWorktreeIsolationProtocol();
  }
  return "";
}

export interface BoardBootstrapArgs extends CommonPromptArgs {
  ideaTitle: string;
}

/**
 * Board-level bootstrap prompt — picks up the top of the user's queue.
 * Existing vs create-new branches. ≤5000 guard preserves the MCP-setup head.
 */
export function buildBoardBootstrapPrompt({
  appUrl,
  ideaId,
  ideaTitle,
  mode,
  repoUrl,
  newProject,
}: BoardBootstrapArgs): string {
  const dir = directoryBlock({ ideaId, mode, repoUrl, newProject });
  const mcp = mcpSetupHead(appUrl);
  const work = `Then, pick up my work on the VibeCodes board for this idea:
  • Idea: "${ideaTitle}"  (idea_id: ${ideaId})
  • Call get_board with idea_id ${ideaId} to see the columns and tasks. Do NOT use get_my_tasks here — it only returns tasks already ASSIGNED to you, and a freshly created board has none, so it would look (wrongly) like there's no work.
  • Pick the top unstarted task (e.g. the first item in To Do, then Backlog), read it with get_task, assign it to yourself, and move it to In Progress.
  • If that task has a workflow attached, use claim_next_step to claim its next step and follow the orchestration loop instead.

Use the MCP tools (get_board / get_task / claim_next_step / set_agent_identity / move_task / …) to do the work. Move the task to In Progress and comment as you go.`;

  // Directory step FIRST so the session is in the right folder before anything
  // else, then MCP setup — both protected from truncation; work is the trimmable tail.
  const head = dir ? `${dir}\n\n${mcp}` : mcp;
  return enforcePromptLength(head, `\n\n${work}`);
}

export interface TaskBootstrapArgs extends CommonPromptArgs {
  taskId: string;
  taskTitle: string;
}

/**
 * Per-task bootstrap prompt — targets a specific task_id + idea_id.
 * Existing vs create-new branches. ≤5000 guard preserves the MCP-setup head.
 */
export function buildTaskBootstrapPrompt({
  appUrl,
  ideaId,
  taskId,
  taskTitle,
  mode,
  repoUrl,
  newProject,
}: TaskBootstrapArgs): string {
  const dir = directoryBlock({ ideaId, mode, repoUrl, newProject });
  const mcp = mcpSetupHead(appUrl);
  const work = `Then, pick up this specific task on the VibeCodes board:
  • Task: "${taskTitle}"  (task_id: ${taskId}, idea_id: ${ideaId})

Use the MCP tools (get_task / set_agent_identity / move_task / …) to do the work. Move the task to In Progress and comment as you go.`;

  // Directory step FIRST so the session is in the right folder before anything
  // else, then MCP setup — both protected from truncation; work is the trimmable tail.
  const head = dir ? `${dir}\n\n${mcp}` : mcp;
  return enforcePromptLength(head, `\n\n${work}`);
}

export interface CompactBootstrapArgs extends CommonPromptArgs {
  ideaTitle: string;
  /** Per-task launch: targets this task instead of the top of the queue. */
  taskId?: string;
  /**
   * Existing-mode, no-repo launches: the absolute folder the deep-link cwd will
   * open in (a recorded DB path for this machine, or a user-pinned localStorage
   * path). When set, the compact prompt emits a "you're already here, just
   * confirm" verify-folder step INSTEAD of the create-folder/mkdir block — the
   * session already lands here via the deep link's cwd. Omitted → no directory
   * step at all (repo-backed or first-launch flows resolve the folder elsewhere).
   */
  existingPath?: string;
}

/**
 * The compact prompt split into the LOAD-BEARING head (header + project-dir +
 * MCP-connect + record_project_path steps — must always survive truncation) and
 * the trimmable tail (the final "work" step). `head + tail` is byte-identical to
 * buildCompactBootstrapPrompt for the same args; enforcePromptLength consumes
 * the two parts when a launch has a hard URL budget (the in-browser terminal's
 * vibecodes:// deep link — see terminal-dock.tsx).
 */
export interface CompactPromptParts {
  head: string;
  tail: string;
}

/**
 * The raw ingredients of the compact prompt, shared by BOTH
 * buildCompactBootstrapPromptParts (unconditional — always folds the worktree
 * protocol in when in scope; used by the no-budget/content-inspection builder
 * and by callers with no URL ceiling of their own) and
 * buildCompactPromptEssentials (BUG1 fix — keeps the raw-cwd echo AND the
 * protocol OUT of the protected head so a URL-capped caller can decide
 * inclusion against its own budget). Single source of the step text so the
 * two builders can never drift apart.
 */
interface CompactStepPieces {
  header: string;
  /** Directory-create/clone step for newProject/repo modes. Doesn't duplicate
   * the deep-link's cwd param (new-project/repo launches don't carry one the
   * same way existing-mode does), so it's fine to leave in the protected head
   * — out of BUG1's scope. Empty for existingPath / first-launch (no step). */
  leadingSteps: string[];
  /**
   * Existing-mode/no-repo only: echoes the raw cwd. This DUPLICATES the deep
   * link's `cwd` URL param, so a long recorded/pinned path grows both the
   * fixed URL overhead AND (if this sat in the protected head) the head
   * itself — the mechanism behind BUG1's overflow. Kept out of any
   * `head`/essentials text; callers place it in the trimmable tail.
   */
  directoryEcho?: string;
  /**
   * Compact worktree-isolation protocol candidate — same existing-mode/no-repo
   * scope as directoryEcho, same reason it's kept separate: it must be
   * included or omitted as one atomic block (BUG1 — see
   * fitCompactWorktreeProtocol), never embedded where a length guard could
   * half-truncate it.
   */
  protocol?: string;
  /** Always-present, path-length-independent: MCP connect + record_project_path. */
  essentialSteps: string[];
  work: string;
}

function buildCompactStepPieces({
  appUrl,
  ideaId,
  ideaTitle,
  repoUrl,
  newProject,
  existingPath,
  taskId,
}: CompactBootstrapArgs): CompactStepPieces {
  const title = ideaTitle.length > 80 ? `${ideaTitle.slice(0, 79)}…` : ideaTitle;
  const repo = parseRepoFromGithubUrl(repoUrl);
  const leadingSteps: string[] = [];
  let directoryEcho: string | undefined;
  let protocol: string | undefined;

  // Directory step. In create-new mode → mkdir/init the folder. Repo-backed →
  // clone/cd. Existing-no-repo WITH a known folder (recorded/pinned path the deep
  // link's cwd already opens in) → a "confirm you're already here" step, NOT a
  // create step. Existing-no-repo with NO known folder → nothing (first-launch).
  if (newProject) {
    const p = newProject.newProjectPath;
    const git = repo
      ? `if empty, \`git clone https://github.com/${repo}.git .\`, else keep existing files`
      : "if empty, `git init`";
    leadingSteps.push(
      `Project folder FIRST, before anything else (even planning/research): if ${p} exists, cd in and reuse it as-is; else \`mkdir -p ${p} && cd ${p}\`. Never work in your home directory (${git}).`
    );
  } else if (repo) {
    leadingSteps.push(
      `Get into the repo ${repo} first: cd your local clone, or \`git clone https://github.com/${repo}.git ${DEFAULT_NEW_PROJECT_PARENT}/${repo.split("/")[1]}\` and cd in. Never work in your home directory.`
    );
  } else if (existingPath) {
    directoryEcho = `You should already be in ${existingPath} (recorded from a previous session). Confirm with \`pwd\`; \`cd\` there if not. Don't re-init or re-clone — reuse the folder as-is.`;
    // Concurrent-terminal isolation (existing-mode/no-repo — the deep link's cwd
    // is what puts this session in a possibly-shared folder; a repo-backed
    // launch resolves via the `repo` slug instead and never reaches this
    // branch). The "compact" variant is a budget-conscious rewrite of the same
    // steps buildWorktreeIsolationProtocol("full") gives the copy-command
    // prompt — this one keeps every load-bearing invariant but drops the prose
    // so the URL-capped deep link / in-browser terminal stay under their ceiling.
    protocol = buildWorktreeIsolationProtocol("compact");
  }

  const essentialSteps = [
    `Connect the board tools (if they're already available, skip this step): run \`claude mcp add -s local --transport http vibecodes ${mcpEndpoint(appUrl)}\`, then \`/mcp\` → vibecodes → Authenticate in the browser. Use the built-in /mcp flow; do NOT hand-build the OAuth URL.`,
    `Re-confirm the folder: call record_project_path (idea_id ${ideaId}, machine \`hostname\`, \`pwd\`) so future launches reopen here — safe to repeat on every launch.`,
  ];

  const work = taskId
    ? `Work this task: get_task (task_id ${taskId}, idea_id ${ideaId}), move it to In Progress, then start. Comment as you go.`
    : `Find work: call get_board (idea_id ${ideaId}) — NOT get_my_tasks, which only returns tasks already assigned to you (a new board has none). Take the top task in To Do (then Backlog), get_task it, assign it to yourself, move it to In Progress, then start. Comment as you go.`;

  const header = taskId
    ? `Set up VibeCodes and work a board task for "${title}".`
    : `Set up VibeCodes and pick up board work for "${title}".`;

  return { header, leadingSteps, directoryEcho, protocol, essentialSteps, work };
}

/**
 * COMPACT bootstrap prompt, as head/tail parts — the SINGLE source of the
 * compact prompt's content. See buildCompactBootstrapPrompt for the semantics;
 * this variant exists so URL-budgeted launch paths can truncate the tail with
 * enforcePromptLength while the head (title header + dir + MCP connect +
 * record_project_path steps) survives verbatim. The task/idea ids live in the
 * TAIL's work step; on (rare) truncation the agent recovers them from the board
 * over MCP — the head's connect step is what makes that possible.
 *
 * UNCONDITIONAL: the worktree-isolation protocol (when in scope) always rides
 * the head here, exactly as before — this builder has no URL budget of its
 * own to weigh it against. Callers that DO have a hard URL ceiling (the
 * claude-cli:// deep link, the in-browser terminal) must NOT clamp this
 * output directly — the protocol is load-bearing-shaped text embedded in
 * `head`, and enforcePromptLength's "never sacrifice the head" fallback would
 * let an oversized head overflow the cap instead of degrading (BUG1). Those
 * callers use buildCompactPromptEssentials + fitCompactWorktreeProtocol
 * instead, which keep the protocol OUT of the protected head and decide its
 * inclusion against the actual budget.
 */
export function buildCompactBootstrapPromptParts(args: CompactBootstrapArgs): CompactPromptParts {
  const { header, leadingSteps, directoryEcho, protocol, essentialSteps, work } =
    buildCompactStepPieces(args);
  const steps = [...leadingSteps];
  if (directoryEcho) steps.push(directoryEcho);
  if (protocol) steps.push(protocol);
  steps.push(...essentialSteps);

  const numbered = steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
  return {
    head: `${header}\n\n${numbered}\n`,
    tail: `${steps.length + 1}. ${work}`,
  };
}

export interface CompactPromptEssentials {
  /**
   * Header + MCP-connect + record_project_path steps ONLY — ALWAYS present
   * and, unlike `CompactPromptParts.head`, path-length-independent: it never
   * echoes the raw cwd, so a long recorded/pinned path can't shrink the
   * available URL budget out from under it (BUG1). Protected: a final
   * enforcePromptLength call must never trim this.
   *
   * This is the UNCONDITIONAL join of `headSteps` under `header` — kept for
   * parity/back-compat callers with a roomy (or no) budget of their own, and
   * for the `head`-vs-`CompactPromptParts.head` divergence test. Budget-aware
   * callers (fitCompactWorktreeProtocol) do NOT consume this string directly
   * — see `header`/`headSteps` below.
   */
  head: string;
  /**
   * Trimmable: the existing-folder confirm echo (duplicates the deep link's
   * `cwd` param — safe to truncate, unlike the protocol) + the work step.
   */
  tail: string;
  /**
   * Compact worktree-isolation protocol candidate (existing-mode/no-repo with
   * a known cwd only); undefined when out of scope (repo-backed / new-project
   * / first-launch). Best-effort on the URL-capped path — see
   * fitCompactWorktreeProtocol, which decides whether it rides the head.
   */
  protocol?: string;
  /**
   * BUG B fix (5th rework cycle): the title-header line, ALONE (no steps).
   * Optional — omitted (with `headSteps`) by any caller that doesn't have a
   * natural step breakdown, in which case `fitCompactWorktreeProtocol` falls
   * back to treating `head` as one indivisible unit (its pre-BUG-B
   * behaviour). `buildCompactPromptEssentials` always supplies both.
   */
  header?: string;
  /**
   * BUG B fix (5th rework cycle, QA BUG B): the essential steps that make up
   * `head`, as ATOMIC, individually-addressable units, in PRIORITY order
   * (index 0 = highest priority — for the real prompt this is MCP-connect,
   * since an agent that can't reach the board can't self-heal anything else;
   * record_project_path follows). When the full head doesn't fit a budget,
   * `fitCompactWorktreeProtocol` greedily includes whole steps from this list
   * in order and OMITS any step that doesn't fit in its entirety — it NEVER
   * emits a mid-sentence fragment of a step, unlike the old raw-char
   * `enforcePromptLength` head-trim this replaces for the compact-essentials
   * path (that char-trim remains the tail's belt-and-suspenders — see
   * enforcePromptLength's own doc comment).
   */
  headSteps?: string[];
}

/**
 * BUG1 fix — the essentials-only counterpart to buildCompactBootstrapPromptParts
 * for launch paths with a hard URL ceiling (the claude-cli:// deep link, the
 * in-browser terminal). Keeps the protected `head` constant-size regardless of
 * cwd length (no raw-path echo) and surfaces the worktree-isolation protocol
 * candidate SEPARATELY so `fitCompactWorktreeProtocol` can include it only
 * when it actually fits the remaining budget — an omission is always clean
 * (the whole protocol, never a fragment) and the final prompt can never push
 * the URL past the cap (FR-8 degrade: no isolation beats a silently-dropped
 * launch).
 */
export function buildCompactPromptEssentials(args: CompactBootstrapArgs): CompactPromptEssentials {
  const { header, leadingSteps, directoryEcho, protocol, essentialSteps, work } =
    buildCompactStepPieces(args);

  // Priority order for the BUG B atomic degrade: leadingSteps (mkdir/clone —
  // must happen before anything else, when present) first, THEN essentialSteps
  // (MCP-connect, then record_project_path). For the existing-mode/no-repo
  // scenario the pathological-cwd bugs actually target, leadingSteps is
  // always empty, so this reduces to exactly [MCP-connect, record_project_path].
  const headSteps = [...leadingSteps, ...essentialSteps];
  const numbered = headSteps.map((s, i) => `${i + 1}. ${s}`).join("\n");

  const tailSteps: string[] = [];
  if (directoryEcho) tailSteps.push(directoryEcho);
  tailSteps.push(work);
  const numberedTail = tailSteps
    .map((s, i) => `${headSteps.length + i + 1}. ${s}`)
    .join("\n");

  return {
    header,
    headSteps,
    head: `${header}\n\n${numbered}\n`,
    tail: numberedTail,
    protocol,
  };
}

/**
 * BUG1 fix (FR-8 degrade applied to the URL budget) — the pure, shared
 * decision of whether the compact worktree-isolation protocol rides a
 * URL-capped launch's prompt. Used by BOTH `openInClaudeCode`
 * (launch-claude-code-button.tsx) and `useLaunchClaudeCode`'s `launch()`
 * (use-launch-claude-code.ts) so the two entry points can never diverge.
 *
 * The protocol is all-or-nothing: it is folded into the (never-trimmed) head
 * ONLY when head+protocol actually fits `budget` on its own (before the tail
 * even gets a chance to shrink) — otherwise it is omitted entirely and the
 * launch proceeds without isolation (today's pre-worktree-protocol
 * behaviour), never half-truncated. The result is double-checked against
 * `budget` after enforcePromptLength runs (rather than trusting the
 * pre-check alone) so a razor-thin edge case in the ellipsis math can never
 * let the protocol-inclusive candidate sneak past the cap — the essentials-
 * only prompt (guaranteed <= budget on its own, since essentials are
 * path-length-independent) is the fallback.
 *
 * BUG 1 (4th rework cycle, belt-and-suspenders): `enforcePromptLength` now
 * guarantees `encodedLength <= cap` in every case (BUG 6 fix, above), so
 * `withoutProtocol` can no longer overflow in practice — but this function
 * previously trusted that single call site without a post-hoc check, unlike
 * `withProtocol` below. Mirror the same defensive re-verification on BOTH
 * branches: never let EITHER candidate escape this function over `budget`,
 * even if a future change to `enforcePromptLength`'s internals regresses its
 * guarantee. The empty string is the final, always-safe floor.
 *
 * BUG 1 (4th rework cycle, priority-inversion fix): the "does the protocol
 * fit?" check MUST happen BEFORE calling enforcePromptLength on
 * `headWithProtocol`, not by inspecting its return value. Pre-BUG-6-fix, an
 * over-budget `headWithProtocol` made enforcePromptLength return it
 * VERBATIM (the old bug), which happened to double as an implicit "didn't
 * fit" signal the post-hoc `encodedLength <= budget` check could catch. Now
 * that enforcePromptLength always self-heals an over-cap head by trimming
 * IT (not just the tail), that implicit signal is gone: a `headWithProtocol`
 * too big for `budget` would get silently trimmed down to size — and since
 * `protocol` sits at the very front of `headWithProtocol`, the trim eats
 * into the essentials text that follows it, KEEPING the protocol at the
 * cost of cutting into the essentials (inverting the documented priority —
 * essentials must never be sacrificed for the best-effort protocol). The
 * explicit pre-check below restores the original contract: the protocol
 * rides the head only when `head + protocol`, BOTH fully intact, already
 * fits `budget` on its own.
 *
 * BUG B fix (5th rework cycle, QA BUG B): the head handed to
 * enforcePromptLength below is no longer `essentials.head` (the always-both-
 * steps join) — it's `resolveEssentialHead(essentials, budget)`, which
 * greedily assembles the head from `essentials.headSteps` in priority order,
 * including a step ONLY when it fits WHOLE. Pre-BUG-B, a head that didn't fit
 * `budget` fell through to enforcePromptLength's raw-char binary-search
 * head-trim (the BUG 6 belt-and-suspenders), which happily bisected mid-step
 * — QA's repro showed the record_project_path step silently dropped AND the
 * MCP-connect step itself cut mid-sentence ("...Authenticate in the
 * brow\n…(truncated)"). resolveEssentialHead's output is already guaranteed
 * to fit `budget` (with room reserved for enforcePromptLength's own trailing
 * marker), so enforcePromptLength's head-trim branch is no longer reachable
 * for a real (headSteps-bearing) essentials object — it remains exactly as
 * before (KEPT, unmodified) as the tail's trim mechanism, and as the
 * back-compat fallback for a caller with no step breakdown (see
 * resolveEssentialHead).
 */
export function fitCompactWorktreeProtocol(
  essentials: CompactPromptEssentials,
  budget: number
): string {
  const { tail, protocol } = essentials;
  const head = resolveEssentialHead(essentials, budget);
  const withoutProtocol = enforcePromptLength(head, tail, budget);
  const safeWithoutProtocol = encodedLength(withoutProtocol) <= budget ? withoutProtocol : "";
  if (!protocol) return safeWithoutProtocol;

  const headWithProtocol = `${protocol}\n\n${head}`;
  // Pre-check (see BUG 1 priority-inversion note above): only attempt the
  // protocol-inclusive candidate when the COMBINED head already fits budget
  // intact — never let enforcePromptLength's head-trim decide this for us.
  if (encodedLength(headWithProtocol) > budget) return safeWithoutProtocol;

  const withProtocol = enforcePromptLength(headWithProtocol, tail, budget);
  return encodedLength(withProtocol) <= budget ? withProtocol : safeWithoutProtocol;
}

/**
 * BUG B fix (5th rework cycle) — resolve the essentials head AGAINST `budget`
 * using ATOMIC step inclusion (fitEssentialHead) whenever the caller supplied
 * a step breakdown (`headSteps` — every real caller, via
 * buildCompactPromptEssentials, does). Falls back to the raw `head` string,
 * UNCHANGED, for a caller with no natural step decomposition (e.g. a
 * synthetic test fixture) — enforcePromptLength's own char-level head-trim
 * remains that caller's (documented, pre-existing) belt-and-suspenders.
 */
function resolveEssentialHead(essentials: CompactPromptEssentials, budget: number): string {
  if (!essentials.headSteps) return essentials.head;
  return fitEssentialHead(essentials.header ?? "", essentials.headSteps, budget);
}

/**
 * Greedily assemble an essentials head from atomic step units, in PRIORITY
 * order (index 0 = highest priority — MCP-connect for the real prompt, since
 * an agent that can't reach the board can't self-heal any later step). A step
 * is included ONLY when the numbered head INCLUDING it — plus headroom for
 * enforcePromptLength's own trailing TRUNCATION_MARKER, so this function's
 * output never forces a further head-trim there — fits `budget` in its
 * entirety. The FIRST step that doesn't fit stops inclusion: lower-priority
 * steps after it are never promoted ahead of a dropped higher-priority one
 * (this is what makes MCP-connect "the last to drop" — record_project_path,
 * index 1, can only ever appear once MCP-connect, index 0, already fit).
 * Every included step is present in its FULL text, verbatim — never a
 * fragment; an omitted step is cleanly absent, never partially there.
 */
function fitEssentialHead(header: string, steps: string[], budget: number): string {
  const reserve = encodedLength(TRUNCATION_MARKER);
  const included: string[] = [];
  for (const step of steps) {
    const candidateSteps = [...included, step];
    const numbered = candidateSteps.map((s, i) => `${i + 1}. ${s}`).join("\n");
    const candidateHead = `${header}\n\n${numbered}\n`;
    if (encodedLength(candidateHead) + reserve > budget) break;
    included.push(step);
  }
  const numbered = included.map((s, i) => `${i + 1}. ${s}`).join("\n");
  return `${header}\n\n${numbered}\n`;
}

// ────────────────────────────────────────────────────────────────────────────
// FIX A (5th rework cycle, QA BUG A) — bounded deep link: cwd is unclamped
// ────────────────────────────────────────────────────────────────────────────

/**
 * `cd '<path>'` line FIX A folds into the (trimmable) prompt when the `cwd=`
 * URL param alone is too large for the deep-link cap — the agent still gets
 * the working directory, just as a shell command instead of a param. Reuses
 * buildLaunchCommand's inert POSIX single-quoting (below) so no command
 * substitution / variable expansion / escape can leak through a pathological
 * path.
 */
function buildCdLine(cwd: string): string {
  return `cd ${shellSingleQuote(cwd)}\n`;
}

/** Fold a `cd` line in as the new highest-priority prefix of the essentials
 * head — ahead of every atomic step (headSteps) when present, or simply
 * prepended to the raw `head` for a back-compat caller with no breakdown. */
function foldCdIntoEssentials(
  essentials: CompactPromptEssentials,
  cdLine: string
): CompactPromptEssentials {
  if (essentials.headSteps) {
    return {
      ...essentials,
      header: cdLine + (essentials.header ?? ""),
      head: cdLine + essentials.head,
    };
  }
  return { ...essentials, head: cdLine + essentials.head };
}

export interface BoundedDeepLinkArgs {
  /** The compact prompt essentials (see buildCompactPromptEssentials). */
  essentials: CompactPromptEssentials;
  /** The working directory this launch would otherwise carry as `cwd=`. */
  cwd?: string;
  /** The full-URL hard ceiling (MAX_DEEP_LINK_URL_LENGTH / MAX_LAUNCH_URL_LENGTH). */
  cap: number;
  /**
   * Extra fixed literal chars the final URL carries once its prompt param
   * becomes non-empty, BEYOND what `buildLink({ prompt: "" })` already
   * measures. The claude-cli:// `q=` key is always present (0 here); the
   * vibecodes:// `prompt=` key is OMITTED entirely for an empty prompt, so
   * its owner (terminal-dock.tsx) passes `"&prompt=".length` (8).
   */
  promptKeyOverhead?: number;
  /**
   * Build the full deep-link URL for a prompt, with or without a `cwd` —
   * omit the `cwd` key (don't pass `cwd: someLongPath`) to build the
   * NO-cwd-param variant. Callers close over their own fixed params (repo;
   * or relay/session/token).
   */
  buildLink: (parts: { prompt: string; cwd?: string }) => string;
}

export type BoundedDeepLinkResult =
  | { ok: true; url: string; droppedCwd: boolean }
  | { ok: false };

/**
 * FIX A (5th rework cycle, QA BUG A) — the single shared decision both
 * call-sites (`openInClaudeCode` in launch-claude-code-button.tsx,
 * `fireLaunchDeepLink` in terminal-dock.tsx) route through to build a
 * deep-link URL. `cwd` rides the link's `cwd=` param, completely UNCLAMPED —
 * enforcePromptLength only ever trimmed the PROMPT. A pathological (dense,
 * deeply-nested) path can alone exceed the cap even with an EMPTY prompt:
 * `budget` goes negative, the prompt floors to `""`, but pre-fix the
 * call-site still fired `buildLink({ prompt: "", cwd })` unconditionally — an
 * over-cap URL Chromium silently no-ops. Same original bug, moved threshold.
 *
 * The invariant this function guarantees: when it returns `ok: true`, `url`
 * is ALWAYS `<= cap` — at ANY cwd length, without exception.
 *
 * Degrade ladder:
 *  1. cwd rides its own param — the unchanged fast path. Used ONLY when it
 *     doesn't cost any essentials degradation: the fitted prompt must retain
 *     every essential step WHOLE (essentialsSurviveWhole, below). A cwd long
 *     enough to squeeze out even one essential step is exactly the case FIX A
 *     targets — rather than accept a launch that "looks fine" (right folder)
 *     but silently lost e.g. record_project_path or MCP-connect, tier 1 is
 *     rejected and the ladder proceeds to try to recover full essentials from
 *     a fresh, path-length-INDEPENDENT budget instead. (A caller with no
 *     `headSteps` breakdown — i.e. no way to check step survival — can't be
 *     held to this stricter bar; essentialsSurviveWhole degrades gracefully
 *     to "always true" for it, so tier 1's gate there is just `budgetWithCwd
 *     > 0`, unchanged from pre-FIX-A.)
 *  2. The cwd param can't deliver full essentials (or doesn't fit at all) →
 *     drop it. The essentials/protocol/tail now budget against the FULL
 *     no-cwd ceiling (CONSTANT — it doesn't shrink with path length, unlike
 *     tier 1's) with a `cd '<path>'` line folded in as an atomic prefix: it
 *     rides WHOLE alongside whatever essentials fit, or this tier is
 *     abandoned entirely — NEVER a bisected mid-path fragment (checked by
 *     confirming the raw `cwd` string appears byte-for-byte in the assembled
 *     prompt, not just a leading substring of it).
 *  3. The cd line doesn't fit either (a genuinely extreme path) → the
 *     "folder-less minimal launch": essentials only, no directory info at
 *     all, still routed through the SAME atomic degrade — this is exactly
 *     today's normal first-launch/no-cwd flow, not a new failure mode, so it
 *     fires rather than blocking on a toast.
 *  4. Even that can't fit (`budgetNoCwd <= 0` — the FIXED relay/session/token
 *     or app-url/repo overhead alone exceeds `cap`; extraordinarily
 *     unlikely) → `ok: false`. The caller shows a toast and does NOT fire an
 *     over-cap URL.
 */
export function buildBoundedDeepLink(args: BoundedDeepLinkArgs): BoundedDeepLinkResult {
  const { essentials, cwd, cap, buildLink } = args;
  const overhead = args.promptKeyOverhead ?? 0;

  // Tier 1 — cwd rides its own URL param, but only when doing so doesn't
  // cost any essentials degradation (see the ladder note above).
  const baseWithCwd = buildLink({ prompt: "", cwd });
  const budgetWithCwd = cap - baseWithCwd.length - overhead;
  if (budgetWithCwd > 0) {
    const prompt = fitCompactWorktreeProtocol(essentials, budgetWithCwd);
    const url = buildLink({ prompt, cwd });
    if (url.length <= cap && essentialsSurviveWhole(essentials, prompt)) {
      return { ok: true, url, droppedCwd: false };
    }
  }

  // Tiers 2/3 — drop the cwd param. budgetNoCwd is CONSTANT regardless of
  // path length (unlike budgetWithCwd, which shrinks linearly with it), so
  // this is the actual FR-8 backstop for a path long enough to blow tier 1.
  const baseNoCwd = buildLink({ prompt: "" });
  const budgetNoCwd = cap - baseNoCwd.length - overhead;
  if (budgetNoCwd <= 0) return { ok: false };

  if (cwd) {
    // Tier 2 — fold `cd '<path>'` in as an atomic prefix. Only accept this
    // candidate when the FULL raw cwd string survives verbatim in the
    // assembled prompt — i.e. the cd line rode whole, never bisected by
    // enforcePromptLength's tail/head trims.
    const cdLine = buildCdLine(cwd);
    const withCd = foldCdIntoEssentials(essentials, cdLine);
    const prompt = fitCompactWorktreeProtocol(withCd, budgetNoCwd);
    if (prompt.includes(cwd)) {
      const url = buildLink({ prompt });
      if (url.length <= cap) return { ok: true, url, droppedCwd: true };
    }
  }

  // Tier 3 — folder-less minimal launch: essentials only, no directory info.
  const prompt = fitCompactWorktreeProtocol(essentials, budgetNoCwd);
  const url = buildLink({ prompt });
  if (url.length <= cap) return { ok: true, url, droppedCwd: !!cwd };

  return { ok: false };
}

/**
 * Whether every essential step (essentials.headSteps) is present, WHOLE, in
 * `prompt`. A caller with no step breakdown (back-compat — see
 * CompactPromptEssentials.headSteps) can't be checked this way, so this
 * degrades to `true` for it — tier 1's gate then reduces to its pre-FIX-A
 * `budgetWithCwd > 0` check alone, unchanged for that caller.
 */
function essentialsSurviveWhole(essentials: CompactPromptEssentials, prompt: string): boolean {
  if (!essentials.headSteps) return true;
  return essentials.headSteps.every((step) => prompt.includes(step));
}

/**
 * COMPACT bootstrap prompt — used ONLY for launch paths with a URL ceiling: the
 * claude-cli:// deep link (MAX_DEEP_LINK_URL_LENGTH) and the in-browser
 * terminal's vibecodes:// launch. It keeps every ESSENTIAL step (project dir
 * first, MCP connect, record_project_path, find/start work) but terse, so the
 * encoded URL stays well under the OS ceiling. The verbose
 * buildBoard/TaskBootstrapPrompt is reserved for the copy-command, which is a
 * shell arg with no URL-length limit.
 */
export function buildCompactBootstrapPrompt(args: CompactBootstrapArgs): string {
  const { head, tail } = buildCompactBootstrapPromptParts(args);
  return head + tail;
}

// ────────────────────────────────────────────────────────────────────────────
// Copy-command fallback (shell)
// ────────────────────────────────────────────────────────────────────────────

interface ShellCommandArgs {
  prompt: string;
  cwd?: string;
  mode: LaunchMode;
  newProject?: NewProjectOptions;
  repoUrl?: string | null;
}

/**
 * Build the `cd … && claude "…"` fallback command for when the deep link is
 * blocked. In create-new mode it is prefixed with the mkdir + clone/init steps
 * so the manual path matches the delegated bootstrap (Design §2.4c).
 */
export function buildLaunchCommand({ prompt, cwd, mode, newProject, repoUrl }: ShellCommandArgs): string {
  const quoted = shellSingleQuote(prompt);
  if (mode === "new" && newProject) {
    const repo = parseRepoFromGithubUrl(repoUrl);
    const setup = repo
      ? `git clone https://github.com/${repo}.git . || git init`
      : `git init`;
    const path = newProject.newProjectPath;
    return `mkdir -p ${path} && cd ${path} && (${setup}) && claude ${quoted}`;
  }
  const dir = cwd ? `cd ${cwd} && ` : "";
  return `${dir}claude ${quoted}`;
}

/**
 * POSIX single-quote a string so the shell treats it as an inert literal — no
 * command substitution (`` ` `` / `$(…)`), no variable expansion (`$VAR`), no
 * escapes. Single quotes can't contain a literal `'`, so each one is emitted as
 * `'\''` (close-quote, escaped-quote, reopen-quote).
 */
function shellSingleQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

// ────────────────────────────────────────────────────────────────────────────
// localStorage persistence (SSR-safe)
// ────────────────────────────────────────────────────────────────────────────

export function launchPathKey(ideaId: string): string {
  return `${LAUNCH_PATH_KEY_PREFIX}${ideaId}`;
}

/** Read the saved launch config for an idea, or null. SSR-safe. */
export function readLaunchPath(ideaId: string): LaunchPathState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(launchPathKey(ideaId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LaunchPathState>;
    if (!parsed || typeof parsed.path !== "string" || !parsed.path) return null;
    const mode: LaunchMode = parsed.mode === "new" ? "new" : "existing";
    return {
      mode,
      path: parsed.path,
      parent: typeof parsed.parent === "string" ? parsed.parent : undefined,
      name: typeof parsed.name === "string" ? parsed.name : undefined,
    };
  } catch {
    return null;
  }
}

/** Persist the launch config for an idea. SSR-safe (no-op on the server). */
export function writeLaunchPath(ideaId: string, state: LaunchPathState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(launchPathKey(ideaId), JSON.stringify(state));
  } catch {
    // Storage full / disabled — caller surfaces failure via the launch flow.
  }
}

/**
 * The public app URL every bootstrap prompt points the MCP connector at.
 * NEXT_PUBLIC_APP_URL is inlined at build time; trailing-slash safe.
 */
export function resolveAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") || "https://vibecodes.co.uk";
}

/**
 * The launch state used when the user hasn't pinned one — the ONE resolution
 * shared by the launch button AND the terminal dock's dock-initiated launches
 * (paired auto-connect / Retry), so both build the compact prompt from the same
 * state and can never diverge (bootstrap-prompt parity, AC1/AC3):
 *
 *  - saved localStorage config for this idea → use it verbatim.
 *  - idea has a GitHub repo → existing mode, empty path; the repo slug resolves
 *    the working copy locally.
 *  - no repo BUT a real existing folder is known (a recorded DB path for THIS
 *    machine, surfaced via `effectiveTarget`) → existing mode at that absolute
 *    path, so the bootstrap prompt SKIPS the create-folder/mkdir/git-init block
 *    (the deep link's cwd already lands the session there — this is the fix for
 *    the "already-recorded idea still gets the first-run script" bug).
 *  - no repo, no known folder → a brand-new project under ~/projects/<slug>; the
 *    agent mkdir's it.
 *
 * `effectiveTarget` is optional so callers without recorded paths (the terminal
 * dock's payload-less fallback) keep working unchanged — they pass nothing and
 * fall through to the create-new default exactly as before.
 *
 * SSR-safe (readLaunchPath returns null on the server).
 */
export function resolveDefaultLaunchState(
  ideaId: string,
  ideaTitle: string,
  ideaGithubUrl: string | null,
  effectiveTarget?: EffectiveLaunchTarget
): LaunchPathState {
  const saved = readLaunchPath(ideaId);
  if (saved) return saved;
  if (ideaGithubUrl) return { mode: "existing", path: "" };
  // A no-repo idea with a known folder (recorded/pinned via resolveEffective-
  // LaunchTarget) opens THERE as existing mode so the prompt matches the cwd.
  if (effectiveTarget && effectiveTarget.source !== "none" && effectiveTarget.cwd) {
    return { mode: "existing", path: effectiveTarget.cwd };
  }
  const name = slugifyIdeaTitle(ideaTitle);
  return {
    mode: "new",
    path: composeNewProjectPath(DEFAULT_NEW_PROJECT_PARENT, name),
    parent: DEFAULT_NEW_PROJECT_PARENT,
    name,
  };
}

/**
 * The cwd a launch should carry for a given state — the ONE rule shared by the
 * claude-cli:// deep link (launch button) and the in-browser vibecodes:// launch
 * (bus payload + terminal dock), so both destinations open in the same folder:
 *
 *  - existing mode with a user-pinned absolute path → use it.
 *  - new (no-repo) mode → the caller's effective cwd (the saved path or the
 *    agent-recorded path for THIS machine — resolveEffectiveLaunchTarget.cwd).
 *    Callers without the recorded paths (the dock's payload-less fallback) pass
 *    undefined, and the bootstrap prompt's directory step creates
 *    ~/projects/<slug> instead. (`~`-paths don't expand in the cwd param.)
 *  - repo-backed (existing mode, empty path) → no cwd; the repo slug / prompt
 *    directory step resolves the working copy.
 */
export function resolveLaunchCwd(
  state: LaunchPathState,
  effectiveCwd: string | undefined
): string | undefined {
  if (state.mode === "existing" && state.path.trim()) return state.path.trim();
  if (state.mode === "new") return effectiveCwd;
  return undefined;
}
