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
 * Enforce a cap on the URL-ENCODED prompt (acceptance criterion #6). The
 * MCP-setup `head` is load-bearing (without it the agent can't connect), so it
 * is ALWAYS preserved verbatim — we trim only the variable `tail` until
 * `encodeURIComponent(head + tail).length <= cap`.
 *
 * `head` must already contain whatever joins it to the tail (e.g. a trailing
 * newline); `tail` is appended as-is. If the head alone exceeds the cap we keep
 * the whole head (correctness of the bootstrap beats the cap; an extreme edge).
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

  // Never sacrifice the head, even if it alone overflows the cap.
  if (encodedLength(head) >= cap) return head;

  const ellipsis = "\n…(truncated)";
  // Largest tail length whose encoded (head + tail + ellipsis) fits. Binary
  // search on the raw tail length — encodedLength is monotonic in it.
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
 *  - existing mode WITH a repo → open the local clone, or clone it if missing;
 *  - existing mode WITHOUT a repo → nothing here (rely on the deep link's cwd, if any).
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
 * COMPACT bootstrap prompt, as head/tail parts — the SINGLE source of the
 * compact prompt's content. See buildCompactBootstrapPrompt for the semantics;
 * this variant exists so URL-budgeted launch paths can truncate the tail with
 * enforcePromptLength while the head (title header + dir + MCP connect +
 * record_project_path steps) survives verbatim. The task/idea ids live in the
 * TAIL's work step; on (rare) truncation the agent recovers them from the board
 * over MCP — the head's connect step is what makes that possible.
 */
export function buildCompactBootstrapPromptParts({
  appUrl,
  ideaId,
  ideaTitle,
  repoUrl,
  newProject,
  existingPath,
  taskId,
}: CompactBootstrapArgs): CompactPromptParts {
  const title = ideaTitle.length > 80 ? `${ideaTitle.slice(0, 79)}…` : ideaTitle;
  const repo = parseRepoFromGithubUrl(repoUrl);
  const steps: string[] = [];

  // Directory step. In create-new mode → mkdir/init the folder. Repo-backed →
  // clone/cd. Existing-no-repo WITH a known folder (recorded/pinned path the deep
  // link's cwd already opens in) → a "confirm you're already here" step, NOT a
  // create step. Existing-no-repo with NO known folder → nothing (first-launch).
  if (newProject) {
    const p = newProject.newProjectPath;
    const git = repo
      ? `if empty, \`git clone https://github.com/${repo}.git .\`, else keep existing files`
      : "if empty, `git init`";
    steps.push(
      `Project folder FIRST, before anything else (even planning/research): if ${p} exists, cd in and reuse it as-is; else \`mkdir -p ${p} && cd ${p}\`. Never work in your home directory (${git}).`
    );
  } else if (repo) {
    steps.push(
      `Get into the repo ${repo} first: cd your local clone, or \`git clone https://github.com/${repo}.git ${DEFAULT_NEW_PROJECT_PARENT}/${repo.split("/")[1]}\` and cd in. Never work in your home directory.`
    );
  } else if (existingPath) {
    steps.push(
      `You should already be in ${existingPath} (recorded from a previous session). Confirm with \`pwd\`; \`cd\` there if not. Don't re-init or re-clone — reuse the folder as-is.`
    );
  }

  steps.push(
    `Connect the board tools (if they're already available, skip this step): run \`claude mcp add -s local --transport http vibecodes ${mcpEndpoint(appUrl)}\`, then \`/mcp\` → vibecodes → Authenticate in the browser. Use the built-in /mcp flow; do NOT hand-build the OAuth URL.`
  );

  steps.push(
    `Re-confirm the folder: call record_project_path (idea_id ${ideaId}, machine \`hostname\`, \`pwd\`) so future launches reopen here — safe to repeat on every launch.`
  );

  const work = taskId
    ? `Work this task: get_task (task_id ${taskId}, idea_id ${ideaId}), move it to In Progress, then start. Comment as you go.`
    : `Find work: call get_board (idea_id ${ideaId}) — NOT get_my_tasks, which only returns tasks already assigned to you (a new board has none). Take the top task in To Do (then Backlog), get_task it, assign it to yourself, move it to In Progress, then start. Comment as you go.`;

  const header = taskId
    ? `Set up VibeCodes and work a board task for "${title}".`
    : `Set up VibeCodes and pick up board work for "${title}".`;
  const numbered = steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
  return {
    head: `${header}\n\n${numbered}\n`,
    tail: `${steps.length + 1}. ${work}`,
  };
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
