/**
 * Launch Claude Code — pure logic for deep links, prompt builders, and per-idea
 * path persistence. See docs/launch-claude-code-design.html (approved design).
 *
 * All functions here are framework-agnostic and unit-tested. The deep link opens
 * the user's local, subscription-authed Claude Code via the `claude-cli://` scheme;
 * the prompt it pre-fills bootstraps the `vibecodes-remote` MCP connector and then
 * picks up board work. The human reviews + presses Enter (human-in-the-loop).
 */

/**
 * Hard cap on the deep-link `q` (prompt) length, measured on the URL-ENCODED
 * value (acceptance criterion #6: `encodeURIComponent(q).length <= 5000`).
 * The work-context tail is trimmed until the encoded prompt fits.
 */
export const MAX_DEEP_LINK_PROMPT_LENGTH = 5000;

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
 * Enforce the ≤ MAX_DEEP_LINK_PROMPT_LENGTH guard on the URL-ENCODED prompt
 * (acceptance criterion #6). The MCP-setup `head` is load-bearing (without it
 * the agent can't connect), so it is ALWAYS preserved verbatim — we trim only
 * the variable `tail` until `encodeURIComponent(head + tail).length <= cap`.
 *
 * `head` must already contain whatever joins it to the tail (e.g. a trailing
 * newline); `tail` is appended as-is. If the head alone exceeds the cap we keep
 * the whole head (correctness of the bootstrap beats the cap; an extreme edge).
 */
export function enforcePromptLength(head: string, tail: string): string {
  const full = head + tail;
  if (encodedLength(full) <= MAX_DEEP_LINK_PROMPT_LENGTH) return full;

  // Never sacrifice the head, even if it alone overflows the cap.
  if (encodedLength(head) >= MAX_DEEP_LINK_PROMPT_LENGTH) return head;

  const ellipsis = "\n…(truncated)";
  // Largest tail length whose encoded (head + tail + ellipsis) fits. Binary
  // search on the raw tail length — encodedLength is monotonic in it.
  let lo = 0;
  let hi = tail.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = head + tail.slice(0, mid) + ellipsis;
    if (encodedLength(candidate) <= MAX_DEEP_LINK_PROMPT_LENGTH) {
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

/** Compose `parent/name` into a single path, normalising the joining slash. */
export function composeNewProjectPath(parent: string, name: string): string {
  const base = parent.trim().replace(/\/+$/, "");
  return `${base}/${name.trim()}`;
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
  return `First, ensure the VibeCodes MCP connector is available.

1. Run \`claude mcp list\`; if "vibecodes-remote" is not listed, add it:
     claude mcp add -s user --transport http vibecodes-remote ${mcpEndpoint(appUrl)}
   Then connect (you'll be prompted to authorise via your browser the first time) and reconnect if needed.`;
}

/**
 * The create-new bootstrap steps (mkdir + clone/init). Idempotent intent.
 * Numbered to follow the MCP-setup head (step 1), so it reads as one sequence.
 */
function newProjectSteps(newProjectPath: string, repoUrl?: string | null): string {
  const repo = parseRepoFromGithubUrl(repoUrl);
  const setupStep = repo
    ? `3. Then set up its contents based on what you find — do NOT overwrite existing work:
     • Empty / just-created → clone the repo: git clone https://github.com/${repo}.git .
     • Already a git checkout → leave it; optionally fast-forward: git pull --ff-only || true
     • Has files but no git → use them as-is; do NOT clone over them.`
    : `3. Then set up git based on what you find — do NOT overwrite existing work:
     • Empty / just-created → initialise: git init
     • Already a git repo, or already has files → leave it as-is.`;

  return `Set up the local project directory for this idea at ${newProjectPath}:

2. Check whether ${newProjectPath} already exists.
     • If it EXISTS, cd into it and reuse it as-is — do NOT re-clone, re-init, or overwrite existing files.
     • If it does NOT exist, create it: mkdir -p ${newProjectPath} && cd ${newProjectPath}
${setupStep}`;
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
  mode,
  repoUrl,
  newProject,
}: Pick<CommonPromptArgs, "mode" | "repoUrl" | "newProject">): string {
  if (mode === "new" && newProject) {
    return newProjectSteps(newProject.newProjectPath, repoUrl);
  }
  const repo = parseRepoFromGithubUrl(repoUrl);
  if (repo) {
    return `Work in this idea's repository (${repo}):
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
  const head = mcpSetupHead(appUrl);
  const work = `Once connected, pick up my work on the VibeCodes board for this idea:
  • Idea: "${ideaTitle}"  (idea_id: ${ideaId})
  • Call get_my_tasks (or claim_next_step) and start the top item.

Use the MCP tools (get_task / claim_next_step / set_agent_identity / move_task / …) to do the work. Move the task to In Progress and comment as you go.`;

  // Head (MCP setup) is ALWAYS first so the length guard never trims it. The
  // directory block + work form the trimmable tail.
  const dir = directoryBlock({ mode, repoUrl, newProject });
  const tail = dir ? `\n\n${dir}\n\nThen ${lowerFirst(work)}` : `\n\n${work}`;
  return enforcePromptLength(head, tail);
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
  const head = mcpSetupHead(appUrl);
  const work = `Once connected, pick up this specific task on the VibeCodes board:
  • Task: "${taskTitle}"  (task_id: ${taskId}, idea_id: ${ideaId})

Use the MCP tools (get_task / set_agent_identity / move_task / …) to do the work. Move the task to In Progress and comment as you go.`;

  // Head (MCP setup) is ALWAYS first so the length guard never trims it. The
  // directory block + work form the trimmable tail.
  const dir = directoryBlock({ mode, repoUrl, newProject });
  const tail = dir ? `\n\n${dir}\n\nThen ${lowerFirst(work)}` : `\n\n${work}`;
  return enforcePromptLength(head, tail);
}

function lowerFirst(s: string): string {
  return s.length === 0 ? s : s[0].toLowerCase() + s.slice(1);
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
