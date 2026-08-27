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

/**
 * FALLBACK `idea_project_paths.hostname` for a human-written row (the "Set
 * exact folder" dialog's Save, and the one-time pin migration) when this
 * browser's real machine hostname isn't known yet.
 *
 * CORRECTION (this rework): the investigation step that scoped this feature
 * concluded "the browser cannot know the hostname" and this sentinel was
 * built as the ONLY option for both writers. That premise is false —
 * `getMachineIdentity()` (`src/lib/terminal/machine-identity.ts`) already
 * gives the browser its real hostname, self-reported by the terminal bridge
 * the same way an agent's `hostname`/`uname -n` self-report does (see the
 * bridge's `bridge-version` control frame, `host` field). Both writers now
 * prefer that real hostname and fall back to this sentinel only when
 * `getMachineIdentity()` returns null (a browser that has never had a
 * terminal session, so it genuinely doesn't know its own machine yet).
 *
 * Landing a write under this ACCOUNT-WIDE sentinel instead of a real,
 * per-machine hostname is exactly the bug QA caught: every browser and
 * machine on the account reads the same fake row, so one person's manual
 * pin could become what a completely different machine resolves to. Using
 * the real hostname whenever it's available is what fixes that — this
 * sentinel is now the deliberately-narrow "we truly don't know" case, not
 * the default.
 *
 * Still chosen to read naturally in the dropdown's "This machine — <hostname>"
 * label when it IS used — it reproduces the exact copy ("This machine — set
 * manually") the old localStorage-pin path used to show.
 */
export const MANUAL_PIN_HOSTNAME = "set manually";

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

/**
 * Is `path` not just a syntactically valid absolute path, but plausibly a
 * PROJECT folder — i.e. not a "landing zone" like `/`, `/Users`, or a home
 * directory? `isValidAbsolutePath("/")` is true, and a launch session that
 * opens at `/` will happily record it via `record_project_path`; every later
 * launch on that machine then reopens at `/` too ("self-heal becomes
 * self-poison"). This check closes that loop on every write path, while
 * leaving `isValidAbsolutePath` itself unchanged.
 */
export function isPlausibleProjectPath(path: string): boolean {
  if (!isValidAbsolutePath(path)) return false;
  // Strip trailing slashes/backslashes (not leading) after trimming.
  const p = path.trim().replace(/[\\/]+$/, "");

  if (p.startsWith("/")) {
    const segments = p.split("/").filter(Boolean);
    // `/`, `/tmp`, `/Users`, `/opt`, `/root` (root's home is 1 segment)
    if (segments.length < 2) return false;
    const [first] = segments;
    if (segments.length === 2 && (first === "Users" || first === "home")) {
      return false; // `/Users/<name>` or `/home/<name>` — a home directory
    }
    return true;
  }

  if (/^\\\\[^\\]+\\[^\\]+/.test(p)) {
    // UNC: \\server\share[\rest...] — reject if nothing after the share.
    const rest = p.replace(/^\\\\[^\\]+\\[^\\]+/, "");
    return rest.replace(/^[\\/]+/, "").length > 0;
  }

  // Windows drive letter: C:\... or C:/...
  const driveMatch = /^[A-Za-z]:[\\/]/.exec(p);
  if (driveMatch) {
    const remainder = p.slice(driveMatch[0].length);
    const segments = remainder.split(/[\\/]/).filter(Boolean);
    if (segments.length === 0) return false; // drive root
    if (segments.length === 2 && segments[0].toLowerCase() === "users") {
      return false; // C:\Users\<name>
    }
    return true;
  }

  return false;
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
 * Merge a single (optimistic) recorded row into a list, replacing any existing
 * row with the same hostname rather than appending a duplicate. Used to fold a
 * just-saved "Set exact folder" write (hostname `MANUAL_PIN_HOSTNAME`) into the
 * board-loaded `recordedProjectPaths` immediately client-side — the SSR list
 * won't see it until the next page load, but `resolveEffectiveLaunchTarget`
 * only reads `recordedPaths`, so display + launch must be updated the same way
 * the pin used to update instantly (this preserves that "just saved → the
 * dropdown/launch reflect it right away" property now that the write goes to
 * the server instead of localStorage).
 */
export function mergeRecordedPath(
  records: ReadonlyArray<RecordedProjectPath> | null | undefined,
  update: RecordedProjectPath | null | undefined
): RecordedProjectPath[] {
  const base = records ?? [];
  if (!update) return [...base];
  const withoutMatch = base.filter((r) => r.hostname !== update.hostname);
  return [...withoutMatch, update];
}

export type PinMigrationAction = "insert" | "update" | "skip";

export interface PinMigrationDecision {
  action: PinMigrationAction;
  /**
   * The hostname to upsert onto. See `decidePinMigration`'s doc for the full
   * precedence table this implements.
   */
  hostname?: string;
}

/**
 * Pure decision for the one-time browser-pin → `idea_project_paths` migration
 * (card: retire the localStorage pin for existing folders, with a migration
 * that never regresses resolution — see `chooseLaunchCwd`'s dedupe-by-path
 * contract). Takes the CURRENT server rows for (this idea, this user) plus
 * `realHostname` — this browser's actual machine hostname from
 * `getMachineIdentity()`, or null when it isn't known yet.
 *
 * CORRECTION (this rework): the original version of this function only ever
 * saw row COUNT, because the investigation step it was built from concluded
 * the browser can't know its own hostname. That conclusion was wrong —
 * `getMachineIdentity()` already exists and gives the real answer (see
 * `MANUAL_PIN_HOSTNAME`'s doc). Knowing the real hostname changes what
 * "update in place" should mean: it can now target the row that is
 * PROVABLY this machine's own, instead of guessing from "how many rows
 * exist" — which is exactly what the old >1-rows "skip" rule was a
 * stand-in for (it skipped not because >1 rows is inherently unfixable, but
 * because the code had no way to tell which one, if any, was ours).
 *
 * Precedence, checked in this order:
 *
 *  1. `realHostname` is known AND a row with that exact hostname already
 *     exists → **update** that row, regardless of how many OTHER rows exist.
 *     This is no longer a guess: a row recorded under this exact machine's
 *     real hostname (by a prior agent launch, or a prior real-hostname pin
 *     save/migration) IS this machine's row, full stop. Overwriting it with
 *     the pin's path can't corrupt anyone else's data — it never touches any
 *     other row — and it's what makes the "pin wins over the server record"
 *     decision (see the card) actually correct instead of a coincidence of
 *     row count.
 *  2. Otherwise, 0 existing rows → **insert** under `realHostname` when known,
 *     else the `MANUAL_PIN_HOSTNAME` fallback. Nothing to collide with either
 *     way; preferring the real hostname when we have it means a LATER agent
 *     launch on this same machine (`record_project_path` with the same
 *     self-reported hostname) upserts onto this same row instead of creating
 *     a second one — the real hostname is exactly what
 *     `idea_project_paths (idea_id, owner_user_id, hostname)` already keys
 *     agent-recorded rows on, so using it here is just using the table's own
 *     natural key instead of a synthetic one.
 *  3. Otherwise, exactly 1 existing row (with a hostname that, per rule 1,
 *     did NOT match `realHostname` — or `realHostname` is null) → **update**
 *     THAT row's path in place, keeping its own hostname. Unchanged from the
 *     original reasoning and deliberately NOT narrowed by hostname
 *     awareness: the pin already won over a lone recorded row before any of
 *     this hostname plumbing existed (the card's standing "pin wins"
 *     decision), and overwriting the one row that exists is what keeps
 *     `chooseLaunchCwd` resolving to exactly one distinct path afterwards —
 *     inserting a second, differently-hostnamed row here would flip a
 *     today-resolved idea to permanently ambiguous, strictly worse than the
 *     bug being fixed.
 *  4. Otherwise, >1 existing rows, none matching `realHostname`, but
 *     `realHostname` IS known → **insert** under `realHostname`. This used to
 *     be a skip, on the reasoning that adding a differently-hostnamed row to an
 *     already-ambiguous set couldn't help — true only while `chooseLaunchCwd`
 *     resolved purely by deduping paths, which made every extra row noise. It
 *     now prefers the row keyed to this machine over any amount of ambiguity
 *     (its rule 1), so the row we insert here is exactly the one the read will
 *     pick: a machine we can positively identify, carrying a path this browser
 *     was explicitly pinned to by the user. Nothing is overwritten — other
 *     machines' rows are untouched — and the previously permanent dead end
 *     (several machines on file, pin never lands anywhere, user re-asked every
 *     launch forever) resolves on the next page load instead.
 *  5. Otherwise, >1 existing rows and `realHostname` is UNKNOWN → **skip**.
 *     Genuinely unattributable: no hostname to insert under that would mean
 *     anything, and no basis to pick among existing rows. The SERVER rows are
 *     left exactly as `chooseLaunchCwd` already treats them (source "none");
 *     not reconciled here. That is only a claim about the rows this function
 *     decides over — it says nothing about the caller's browser-local pin,
 *     which is the one piece of state this function doesn't touch at all. A
 *     caller that then deletes the pin on `skip` (as `ok: true` might tempt it
 *     to, since nothing "failed") has destroyed the only surviving record of
 *     the folder for no server-side benefit — this exact bug shipped once
 *     already (see `useLaunchPathPinMigration`, which now keys clearing on
 *     `action !== "skip"` specifically because of it). Treat `skip` as "wrote
 *     nothing, pin must survive," not as "nothing happened."
 *
 * NOT keyed on `updated_at` — row identity (by hostname, or failing that by
 * "does exactly one exist") is the only signal that can't be second-guessed
 * by clock skew or an agent relaunch landing after the browser tab loads.
 */
export function decidePinMigration(
  existingRows: ReadonlyArray<Pick<RecordedProjectPath, "hostname">>,
  realHostname: string | null = null
): PinMigrationDecision {
  if (realHostname) {
    const ownRow = existingRows.find((r) => r.hostname === realHostname);
    if (ownRow) {
      return { action: "update", hostname: realHostname };
    }
  }
  if (existingRows.length === 0) {
    return { action: "insert", hostname: realHostname ?? MANUAL_PIN_HOSTNAME };
  }
  if (existingRows.length === 1) {
    return { action: "update", hostname: existingRows[0].hostname };
  }
  if (realHostname) {
    return { action: "insert", hostname: realHostname };
  }
  return { action: "skip" };
}

/**
 * Choose the cwd to inject into a no-repo launch deep link from the paths
 * recorded for (this user, this idea), given `realHostname` — this browser's
 * actual machine hostname from `getMachineIdentity()`, or null when it isn't
 * known yet (no bridge has ever announced one in this browser).
 *
 * `idea_project_paths` is keyed on (idea_id, owner_user_id, hostname), so a row
 * carrying THIS machine's hostname is, by the table's own natural key, this
 * machine's folder — there is nothing left to infer. Precedence:
 *
 *  1. `realHostname` known AND a usable row exists under it → **that row's
 *     path**, however many other rows exist and whatever they say. This is the
 *     multi-machine case resolving correctly for the first time: two Macs with
 *     the project checked out at different absolute paths each get their own
 *     folder instead of both falling to "ask again" (rule 3). It also beats a
 *     `MANUAL_PIN_HOSTNAME` row deliberately — that synthetic hostname only
 *     ever exists because a save happened while the machine was unknown, so a
 *     row we can positively attribute to this machine is strictly better
 *     evidence than one we can't attribute at all.
 *  2. Otherwise, 1 distinct path across all usable rows → that path, whether it
 *     came from one row or several. The common same-path-across-machines case
 *     (two hosts both checked out under /Users/nick/projects/<slug>): whichever
 *     machine the browser is on, the folder is at this path. Kept BELOW rule 1
 *     only for ordering tidiness — where both apply they agree by definition.
 *     This is the rule that carries browsers with no known identity at all.
 *  3. Otherwise (0 rows, or >1 distinct paths none of which we can attribute to
 *     this machine) → undefined: the safe first-launch flow that asks. Never
 *     inject a path we can't tie to the machine actually running the launch —
 *     opening Claude Code in someone else's checkout is worse than asking.
 *
 * A row is only usable if its absolute_path is a plausible project folder
 * (strict validation, plus not `/`, a home directory, or another top-level
 * landing zone); bad rows are ignored throughout, including under rule 1, so
 * a single corrupt or poisoned record can neither poison the choice nor block
 * a good row from resolving.
 */
export function chooseLaunchCwd(
  records: ReadonlyArray<RecordedProjectPath> | null | undefined,
  realHostname: string | null = null
): string | undefined {
  const usable = (records ?? []).filter((r) => isPlausibleProjectPath(r.absolute_path));
  if (realHostname) {
    const own = usable.find((r) => r.hostname === realHostname);
    if (own) return own.absolute_path.trim();
  }
  const distinctPaths = new Set(usable.map((r) => r.absolute_path.trim()));
  if (distinctPaths.size === 1) return usable[0].absolute_path.trim();
  return undefined;
}

/**
 * The single source of truth for "where will a launch open (if a folder is
 * already known), and what do we show the user?" — applies to repo-backed and
 * no-repo ideas alike. DISPLAY and LAUNCH must derive from this same result so
 * they can never diverge (the original bug: the dialog saved to localStorage
 * but the dropdown read only the DB; a repo-backed idea's known folder used to
 * be discarded here entirely).
 *
 * For an EXISTING folder, `idea_project_paths` (server, `recordedPaths`) is now
 * the ONLY store this reads. The localStorage pin the "Set exact folder"
 * dialog used to write is no longer consulted here — two independent,
 * never-compared stores for the same fact (this machine's project folder) let
 * a stale browser pin silently beat a correct, self-healing server record.
 * The dialog now writes existing-mode saves to the server too (see
 * `MANUAL_PIN_HOSTNAME`), and a one-time migration (`decidePinMigration`)
 * folds any pre-existing pin in before this ships, so no launch folder changes
 * as a result. `new`-mode pins are unaffected — see `resolveDefaultLaunchState`,
 * the only place that still reads them (there's no server equivalent for a
 * folder that doesn't exist yet).
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
  /** Hostname for the DB-sourced case (null when nothing is usable). */
  host: string | null;
  /**
   * Where the path came from. "none" → show no path line. "saved" is kept
   * only so callers that still pattern-match on it don't need a type change —
   * this function no longer returns it; a resolved path is always "recorded"
   * now (a manually-pinned row is just another `recordedPaths` entry, under
   * `MANUAL_PIN_HOSTNAME`).
   */
  source: "saved" | "recorded" | "none";
}

export interface ResolveEffectiveLaunchTargetArgs {
  /**
   * Whether the idea has a GitHub repo. Kept for callers (they already track
   * it for the prompt builders) but no longer gates anything HERE: a
   * repo-backed idea with a known folder (agent-recorded for this machine, or
   * manually pinned via the dialog — both land in `recordedPaths`) resolves
   * that folder exactly like a no-repo idea does. `resolveDefaultLaunchState`
   * is what still treats repo-backed differently when NO folder is known
   * (empty-path existing mode instead of a fresh ~/projects/<slug>).
   */
  hasRepo: boolean;
  /**
   * Paths recorded in the DB for this user + idea — both agent-self-reported
   * rows (`record_project_path`, one per real hostname) and human-set rows
   * (dialog Save / pin migration, hostname `MANUAL_PIN_HOSTNAME`). This is now
   * the ONLY source an existing folder resolves from.
   */
  recordedPaths: ReadonlyArray<RecordedProjectPath> | null | undefined;
  /**
   * This browser's real machine hostname (`getMachineIdentity()`), or null when
   * no bridge has announced one yet. Lets `chooseLaunchCwd` pick the row keyed
   * to THIS machine instead of only resolving when every machine agrees on the
   * path — see its rule 1. Optional so non-browser callers (and tests written
   * before this existed) keep the hostname-blind behaviour unchanged.
   */
  realHostname?: string | null;
}

/**
 * Resolve the effective launch target from the server-recorded paths alone, via
 * `chooseLaunchCwd`: a row keyed to THIS machine's hostname wins outright;
 * failing that, records agreeing on one path dedupe to it even across different
 * hostnames (labelled "This machine — <host>"; a manually-pinned row is just
 * another hostname, `MANUAL_PIN_HOSTNAME`, in that same set). Nothing usable →
 * source "none" (first-launch / repo-slug-resolves-it flow; no path line).
 *
 * Callers in the browser MUST pass `realHostname` (`getMachineIdentity()`) —
 * omitting it silently gives up rule 1 and reverts that caller to the old
 * "every machine must agree" behaviour.
 */
export function resolveEffectiveLaunchTarget({
  recordedPaths,
  realHostname = null,
}: ResolveEffectiveLaunchTargetArgs): EffectiveLaunchTarget {
  const recordedCwd = chooseLaunchCwd(recordedPaths, realHostname);
  if (recordedCwd) {
    // Label from the row we actually resolved FROM where we can: with several
    // rows sharing the resolved path (rule 2), the one under this machine's own
    // hostname is the honest thing to name in "This machine — <host>". Falling
    // back to the first path-match keeps the old label for unknown-identity
    // browsers rather than dropping to the bare "This machine".
    const pathMatches = (recordedPaths ?? []).filter(
      (r) => r.absolute_path.trim() === recordedCwd
    );
    const match =
      pathMatches.find((r) => r.hostname === realHostname) ?? pathMatches[0];
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
  • ⚠️ If \`pwd\` shows \`/\` (the filesystem root) or your home directory, STOP — you are not in the project folder; cd into it before doing anything else, and NEVER record that path.
  • Get the machine name: run \`hostname\` (or \`uname -n\`).
  • As SOON as the vibecodes board tools are available (you connect them in the MCP step below), call record_project_path with idea_id "${ideaId}", that hostname, and the \`pwd\` output — do this BEFORE picking up any task. Repeat it on EVERY launch (self-heal) — but only ever from inside the project folder; recording \`/\` or home would send every future launch to the wrong place.
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
 *  - existing mode WITHOUT a repo → rely on the deep link's cwd, if any — this
 *    is the "launches that inject a cwd" case the concurrent-terminal design
 *    targets: a real local shell about to sit in a possibly-shared folder.
 *    (This verbose/copy-command prompt has no isolation mechanism of its own
 *    — see the compact path's `isolate` flag for where `--worktree` is
 *    actually wired in.)
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
  // Concurrent-session isolation for existing-mode/no-repo launches (the deep
  // link's cwd, if any — a real local shell about to sit in a possibly-shared
  // folder) used to be advisory prose injected here (buildWorktreeIsolationProtocol,
  // removed). It is now handled by the launched `claude` process's OWN native
  // `--worktree <name>` flag (see terminal/bridge/src/resume-cmd.js), which is
  // enforced by Claude Code itself rather than a text instruction an agent could
  // ignore or a URL budget could silently drop — so there is nothing left to say
  // here. This verbose (copy-command) prompt path has no bridge/CLI-flag
  // plumbing of its own (the user runs the printed command in their OWN
  // terminal), so it stays a no-op; see the compact/deep-link path
  // (buildCompactStepPieces's `isolate` flag) for where the flag is actually
  // threaded through to a real `claude --worktree` invocation.
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
  const work = `Then, pick up my work on the VibeCodes board for this idea — but ASK me first, don't just start:
  • Idea: "${ideaTitle}"  (idea_id: ${ideaId})
  • Call get_board with idea_id ${ideaId} to see the columns and tasks. Do NOT use get_my_tasks here — it only returns tasks already ASSIGNED to you, and a freshly created board has none, so it would look (wrongly) like there's no work.
  • Identify the top unstarted task (e.g. the first item in To Do, then Backlog). Only ever pick a task from To Do or Backlog — NEVER touch a task already in In Progress, Blocked, or Verify, even if it looks interrupted or interesting. Another live session may be actively working it right now.
  • Then STOP and ask me: tell me which task is next up and ask whether you should pick it up, or whether I want something else (report a new bug, continue work in flight, a question, …). Wait for my reply. Do NOT call get_task, assign, move or start anything before I answer.
  • If I say yes: read it with get_task, assign it to yourself, and move it to In Progress. If that task has a workflow attached, use claim_next_step to claim its next step and follow the orchestration loop instead.

Use the MCP tools (get_board / get_task / claim_next_step / move_task / add_task_comment / …) to do the work. Move the task to In Progress and comment as you go.`;

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
  • If that task has a workflow attached, use claim_next_step to claim its next step and follow the orchestration loop instead.

Use the MCP tools (get_task / claim_next_step / move_task / add_task_comment / …) to do the work. Move the task to In Progress and comment as you go.`;

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
   * Existing-mode launches with a known folder — no-repo OR repo-backed: the
   * absolute folder the deep-link cwd will open in (a recorded DB path for
   * this machine, or a user-pinned localStorage path). When set, the compact
   * prompt emits a "you're already here, just confirm" verify-folder step
   * INSTEAD of the create-folder/mkdir (no-repo) or clone (repo-backed) block
   * — the session already lands here via the deep link's cwd; for a
   * repo-backed idea the verify step also confirms it's the right clone
   * rather than re-cloning. Omitted → no directory step (no-repo first-launch)
   * or the clone/cd step (repo-backed with no known folder yet).
   */
  existingPath?: string;
  /**
   * Fold an advisory worktree-isolation NOTE into the prompt TEXT when
   * `isolate` ends up true (existing-mode/known-folder launches — see
   * `isolate`'s doc). Scoped to the `claude-cli://` deep-link callers only
   * (`openInClaudeCode` in launch-claude-code-button.tsx): that scheme is
   * consumed by a third-party handler VibeCodes doesn't control, so unlike
   * the `vibecodes://` destination (which threads `isolate` into a REAL,
   * enforced `claude --worktree` flag — see terminal/bridge/src/resume-cmd.js)
   * there is no CLI-flag plumbing to lean on; the prompt text VibeCodes fully
   * owns is the only lever left. This is safe as advisory prose (unlike the
   * OLD worktree-isolation protocol removed from the in-app terminal, which
   * had no human review step and could silently no-op) because this scheme
   * always shows the user the prefilled prompt before Claude Code runs it —
   * a human reviews it, so an instruction that gets ignored is a visible,
   * honest gap, not a silent one. Defaults to false so the `vibecodes://`
   * destination (which builds essentials from the same shared pieces but
   * never sets this) never gets the note duplicated alongside its real flag.
   */
  includeIsolationAdvisory?: boolean;
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
 * buildCompactBootstrapPromptParts (used by the no-budget/content-inspection
 * builder and by callers with no URL ceiling of their own) and
 * buildCompactPromptEssentials (BUG1 fix — keeps the raw-cwd echo OUT of the
 * protected head so a URL-capped caller can decide inclusion against its own
 * budget). Single source of the step text so the two builders can never
 * drift apart. `isolate` (whether this launch should carry `--worktree`) is
 * consumed by neither builder's TEXT — only by the deep-link-building caller.
 */
interface CompactStepPieces {
  header: string;
  /** Directory-create/clone step for newProject/repo modes. Doesn't duplicate
   * the deep-link's cwd param (new-project/repo launches don't carry one the
   * same way existing-mode does), so it's fine to leave in the protected head
   * — out of BUG1's scope. Empty for existingPath / first-launch (no step). */
  leadingSteps: string[];
  /**
   * Existing mode with a known folder ONLY (repo-backed or not): echoes the
   * raw cwd. This DUPLICATES the deep link's `cwd` URL param, so a long
   * recorded/pinned path grows both the fixed URL overhead AND (if this sat
   * in the protected head) the head itself — the mechanism behind BUG1's
   * overflow. Kept out of any `head`/essentials text; callers place it in the
   * trimmable tail.
   */
  directoryEcho?: string;
  /**
   * Whether this launch should get concurrent-session isolation via the
   * launched `claude`'s own native `--worktree <name>` flag (see
   * terminal/bridge/src/resume-cmd.js) — same existing-mode/known-folder
   * scope as directoryEcho (repo-backed or not: the deep link's cwd is what
   * puts either kind of idea in a possibly-shared folder). This used to be an
   * advisory text protocol folded into the prompt (buildWorktreeIsolationProtocol,
   * removed); now it is a plain boolean the deep-link-building caller reads
   * to decide whether to fire the link with `worktree: true` — nothing rides
   * in the prompt itself.
   */
  isolate?: boolean;
  /**
   * The claude-cli:// advisory text companion to `isolate` (see
   * `CompactBootstrapArgs.includeIsolationAdvisory`) — present only when both
   * `isolate` is true AND the caller opted in. Placed in the TRIMMABLE tail
   * (like `directoryEcho`, which it always accompanies): it's genuinely
   * disposable advisory prose, not something an agent needs to self-heal
   * anything, so it's fine for a tight URL budget to drop it first.
   */
  isolationNote?: string;
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
  includeIsolationAdvisory,
}: CompactBootstrapArgs): CompactStepPieces {
  const title = ideaTitle.length > 80 ? `${ideaTitle.slice(0, 79)}…` : ideaTitle;
  const repo = parseRepoFromGithubUrl(repoUrl);
  const leadingSteps: string[] = [];
  let directoryEcho: string | undefined;
  let isolate: boolean | undefined;
  let isolationNote: string | undefined;

  // Directory step. In create-new mode → mkdir/init the folder. Existing WITH a
  // known folder (recorded/pinned path the deep link's cwd already opens in) →
  // a "confirm you're already here" step, NOT a create/clone step — checked
  // BEFORE the bare `repo` branch below so a repo-backed idea with a known
  // folder gets verify-and-reuse wording (don't re-clone) instead of the
  // fresh-machine clone instructions. Repo-backed with NO known folder → clone/
  // cd. Existing-no-repo with NO known folder → nothing (first-launch).
  if (newProject) {
    const p = newProject.newProjectPath;
    const git = repo
      ? `if empty, \`git clone https://github.com/${repo}.git .\`, else keep existing files`
      : "if empty, `git init`";
    leadingSteps.push(
      `Project folder FIRST, before anything else (even planning/research): if ${p} exists, cd in and reuse it as-is; else \`mkdir -p ${p} && cd ${p}\`. Never work in your home directory (${git}).`
    );
  } else if (existingPath) {
    // Repo-backed + known folder: verify it's the right clone, don't re-clone.
    // No-repo + known folder: plain reuse-the-folder wording (unchanged).
    const repoNote = repo
      ? ` It should already be a clone of ${repo} — confirm with \`git remote -v\`; don't re-clone.`
      : "";
    directoryEcho = `You should already be in ${existingPath} (recorded from a previous session).${repoNote} Confirm with \`pwd\`; \`cd\` there if not. Don't re-init or re-clone — reuse the folder as-is.`;
    // Concurrent-session isolation — the deep link's cwd is what puts this
    // session in a possibly-shared folder, whether or not the idea is
    // repo-backed (a repo-backed idea with NO known folder resolves via the
    // `repo` slug in the branch below instead and never reaches here). Signal
    // it via the boolean flag the deep-link builder reads (see `isolate`'s
    // doc) so the caller fires the launch with `claude --worktree <name>`
    // (terminal/bridge/src/resume-cmd.js) rather than folding a text protocol
    // into the prompt.
    isolate = true;
    // claude-cli:// only (see includeIsolationAdvisory's doc): that scheme
    // can't carry the real --worktree flag, so the prompt text VibeCodes
    // fully owns is the only lever left. Advisory, not enforced — the user
    // reviews this prompt before Claude Code runs it, so an ignored note is
    // a visible gap, not a silent one.
    if (includeIsolationAdvisory) {
      isolationNote =
        "Heads up: another session may already be working in this folder. Before making changes, consider running `git worktree add ../<name> -b <branch>` and working there instead, to avoid colliding with it.";
    }
  } else if (repo) {
    leadingSteps.push(
      `Get into the repo ${repo} first: cd your local clone, or \`git clone https://github.com/${repo}.git ${DEFAULT_NEW_PROJECT_PARENT}/${repo.split("/")[1]}\` and cd in. Never work in your home directory.`
    );
  }

  const essentialSteps = [
    `Connect the board tools (if they're already available, skip this step): run \`claude mcp add -s local --transport http vibecodes ${mcpEndpoint(appUrl)}\`, then \`/mcp\` → vibecodes → Authenticate in the browser. Use the built-in /mcp flow; do NOT hand-build the OAuth URL.`,
    `Re-confirm the folder (never \`/\` or home — cd in first): call record_project_path (idea_id ${ideaId}, machine \`hostname\`, \`pwd\`) so future launches reopen here.`,
  ];

  const work = taskId
    ? `Work this task: get_task (task_id ${taskId}, idea_id ${ideaId}), move it to In Progress, then start. Comment as you go.`
    : `Find work, but ASK first: call get_board (idea_id ${ideaId}), NOT get_my_tasks. Only To Do/Backlog, never In Progress/Blocked/Verify (may be live). Name the top one, ask before starting it, and wait for my reply. Then get_task, assign to yourself, move to In Progress, start. Comment as you go.`;

  const header = taskId
    ? `Set up VibeCodes and work a board task for "${title}".`
    : `Set up VibeCodes and pick up board work for "${title}".`;

  return { header, leadingSteps, directoryEcho, isolate, isolationNote, essentialSteps, work };
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
 * The concurrent-session isolation decision (`isolate`, when in scope) itself
 * rides as the plain `isolate` boolean the deep-link-building caller reads to
 * fire `claude --worktree` (see terminal/bridge/src/resume-cmd.js) — nothing
 * in this text depends on it directly. `isolationNote`, the claude-cli:// text
 * companion to that flag (see `CompactBootstrapArgs.includeIsolationAdvisory`),
 * IS folded in here when present, same as `buildCompactPromptEssentials`.
 */
export function buildCompactBootstrapPromptParts(args: CompactBootstrapArgs): CompactPromptParts {
  const { header, leadingSteps, directoryEcho, isolationNote, essentialSteps, work } =
    buildCompactStepPieces(args);
  const steps = [...leadingSteps];
  if (directoryEcho) steps.push(directoryEcho);
  if (isolationNote) steps.push(isolationNote);
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
   * callers (fitCompactEssentials) do NOT consume this string directly — see
   * `header`/`headSteps` below.
   */
  head: string;
  /**
   * Back-compat, UNCONDITIONAL join of `directoryEcho` (if any) + `work` —
   * kept for callers with no atomic step breakdown (see `work`/`directoryEcho`
   * below), which `fitCompactEssentials` still char-trims via
   * enforcePromptLength exactly as before. Real callers (via
   * `buildCompactPromptEssentials`, which always also supplies `work`) are no
   * longer read through this field for assembly — see `work` for why.
   */
  tail: string;
  /**
   * Whether this launch should get concurrent-session isolation via the
   * launched `claude`'s own native `--worktree <name>` flag (existing-mode
   * with a known cwd only — repo-backed or not); undefined when out of scope
   * (no known folder yet: new-project / first-launch, or repo-backed with
   * nothing recorded). Consumed by the deep-link-building caller (see
   * terminal/shared/deep-link.mjs's `worktree` param and
   * terminal/bridge/src/resume-cmd.js), NOT by anything in the prompt text —
   * unlike the old advisory protocol this replaced, there is nothing here for
   * fitCompactEssentials to budget against.
   */
  isolate?: boolean;
  /**
   * The claude-cli:// advisory companion to `isolate` — see
   * `CompactBootstrapArgs.includeIsolationAdvisory` and
   * `CompactStepPieces.isolationNote`. Present only when both `isolate` is
   * true and the builder was asked for it; undefined for the `vibecodes://`
   * destination (which never asks, since it has the real `--worktree` flag
   * instead). Given the SAME atomic, whole-step-or-omit treatment as
   * `directoryEcho` in the trimmable tail — see `assembleAtomicTail`'s degrade
   * ladder — dropped before `work` but after `directoryEcho` (the actual
   * mitigation text outranks the merely-redundant cwd echo).
   */
  isolationNote?: string;
  /**
   * BUG C fix (6th rework cycle, QA-confirmed): the "find work" / "work this
   * task" step, carrying the `idea_id`/`task_id` the agent needs to actually
   * pick up work — the ONE thing in the whole compact prompt with no recovery
   * path if it's lost (unlike the head steps, which the agent can self-heal
   * via the board once connected). ALWAYS present (`buildCompactPromptEssentials`
   * always supplies it). Given the SAME atomic, whole-step-or-omit protection
   * as `headSteps`: `fitCompactEssentials` never character-truncates it — it
   * either rides intact or (only when even `head` + this alone can't fit the
   * budget) is cleanly omitted, never a mid-sentence/mid-UUID fragment.
   * Optional only for back-compat with a caller that supplies no step
   * breakdown at all, in which case `tail`'s old char-trim behaviour applies.
   */
  work?: string;
  /**
   * The existing-folder confirm-echo tail step (duplicates the deep link's
   * `cwd` param, so it's genuinely disposable — unlike `work`). LOWEST
   * priority of everything in the trimmable tail: `fitCompactEssentials`
   * drops this before ever touching `work`. Whole-or-omitted, same as the
   * other atomic pieces — never a character fragment.
   */
  directoryEcho?: string;
  /**
   * BUG B fix (5th rework cycle): the title-header line, ALONE (no steps).
   * Optional — omitted (with `headSteps`) by any caller that doesn't have a
   * natural step breakdown, in which case `fitCompactEssentials` falls back
   * to treating `head` as one indivisible unit (its pre-BUG-B behaviour).
   * `buildCompactPromptEssentials` always supplies both.
   */
  header?: string;
  /**
   * BUG B fix (5th rework cycle, QA BUG B): the essential steps that make up
   * `head`, as ATOMIC, individually-addressable units, in PRIORITY order
   * (index 0 = highest priority — for the real prompt this is MCP-connect,
   * since an agent that can't reach the board can't self-heal anything else;
   * record_project_path follows). When the full head doesn't fit a budget,
   * `fitCompactEssentials` greedily includes whole steps from this list in
   * order and OMITS any step that doesn't fit in its entirety — it NEVER
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
 * cwd length (no raw-path echo). Concurrent-session isolation rides as the
 * plain `isolate` boolean (see its doc) rather than prompt text, so there is
 * nothing for fitCompactEssentials to budget against there any more.
 */
export function buildCompactPromptEssentials(args: CompactBootstrapArgs): CompactPromptEssentials {
  const { header, leadingSteps, directoryEcho, isolate, isolationNote, essentialSteps, work } =
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
  if (isolationNote) tailSteps.push(isolationNote);
  tailSteps.push(work);
  const numberedTail = tailSteps
    .map((s, i) => `${headSteps.length + i + 1}. ${s}`)
    .join("\n");

  return {
    header,
    headSteps,
    head: `${header}\n\n${numbered}\n`,
    tail: numberedTail,
    isolate,
    work,
    directoryEcho,
    isolationNote,
  };
}

/**
 * The pure, shared assembly of the compact essentials prompt against a
 * URL-capped launch's `budget`. Used by BOTH `openInClaudeCode`
 * (launch-claude-code-button.tsx) and `useLaunchClaudeCode`'s `launch()`
 * (use-launch-claude-code.ts) so the two entry points can never diverge.
 *
 * Formerly `fitCompactWorktreeProtocol` — it also decided whether an advisory
 * worktree-isolation text protocol rode the prompt. That protocol is gone
 * (isolation is now the launched `claude`'s own native `--worktree` flag,
 * decided from `essentials.isolate` by the deep-link-building caller, not
 * from prompt text), so this function is left with exactly what its name
 * says: fit the essentials (head + work + directoryEcho) into `budget`.
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
 *
 * BUG C fix (6th rework cycle, QA-confirmed): the "find work" step (carrying
 * `idea_id`/`task_id`, the one piece with no MCP-side recovery path) gets the
 * SAME atomic, whole-step-or-omit treatment headSteps already have — see
 * assembleAtomicTail's degrade ladder — rather than being char-trimmed
 * alongside the genuinely disposable directory-echo. A caller with no step
 * breakdown at all (`work` undefined — synthetic test fixtures only) keeps
 * the pre-fix char-trim behaviour unchanged.
 */
export function fitCompactEssentials(
  essentials: CompactPromptEssentials,
  budget: number
): string {
  const head = resolveEssentialHead(essentials, budget);

  if (essentials.work === undefined) {
    // Back-compat path — no atomic work-step breakdown supplied. Preserve the
    // exact pre-fix behaviour: the whole tail is one char-trimmable blob.
    const { tail } = essentials;
    const withoutTail = enforcePromptLength(head, tail, budget);
    return encodedLength(withoutTail) <= budget ? withoutTail : "";
  }

  return assembleAtomicTail(essentials, head, budget);
}

/**
 * BUG C fix (6th rework cycle) — assembles the tail (directory-echo +
 * isolation-note + work) atomically against `budget`, in a fixed priority
 * DEGRADE LADDER, never fragmenting the "find work" step (`work`) at the
 * character level:
 *
 *  1. directoryEcho + isolationNote + work, whole.
 *  2. isolationNote + work, whole (directoryEcho dropped first — it only
 *     duplicates the URL's own `cwd=` param, so it's the least valuable thing
 *     here).
 *  3. work alone, whole (isolationNote dropped next — real advisory content,
 *     but the mitigation this note carries is honest-gap-on-drop by design;
 *     losing it before `work`, which carries the idea/task id with no
 *     recovery path, is the correct trade).
 *  4. Absolute floor: even `head` + `work` alone doesn't fit. `work` is still
 *     never fragmented — it's dropped entirely, and `head` runs through
 *     enforcePromptLength as the final, already-battle-tested safety net
 *     (guaranteed <= budget in every case, per its own BUG 6 fix).
 *
 * Each rung is tried in FULL before falling back to the next — this is what
 * guarantees `work` either rides byte-for-byte intact or is cleanly absent,
 * exactly like the `headSteps` atomic degrade (fitEssentialHead) above it.
 */
function assembleAtomicTail(
  essentials: CompactPromptEssentials,
  head: string,
  budget: number
): string {
  const { directoryEcho, isolationNote, work, headSteps } = essentials;
  const stepOffset = headSteps?.length ?? 0;

  const buildTail = (includeDirectoryEcho: boolean, includeIsolationNote: boolean): string => {
    const steps: string[] = [];
    if (includeDirectoryEcho && directoryEcho) steps.push(directoryEcho);
    if (includeIsolationNote && isolationNote) steps.push(isolationNote);
    steps.push(work as string);
    return steps.map((s, i) => `${stepOffset + i + 1}. ${s}`).join("\n");
  };

  const full = `${head}${buildTail(true, true)}`;
  if (encodedLength(full) <= budget) return full;

  const withoutDirectoryEcho = `${head}${buildTail(false, true)}`;
  if (encodedLength(withoutDirectoryEcho) <= budget) return withoutDirectoryEcho;

  const workOnly = `${head}${buildTail(false, false)}`;
  if (encodedLength(workOnly) <= budget) return workOnly;

  // Even the work step alone doesn't fit alongside the head — omit it rather
  // than fragment it. `head` itself already fits `budget` (resolveEssentialHead
  // guarantees this), so this is a genuine no-op in practice; the
  // enforcePromptLength pass is defensive belt-and-suspenders only.
  const headOnly = enforcePromptLength(head, "", budget);
  return encodedLength(headOnly) <= budget ? headOnly : "";
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
 *     drop it. The essentials/tail now budget against the FULL
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
    const prompt = fitCompactEssentials(essentials, budgetWithCwd);
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
    // enforcePromptLength's tail/head trims — AND (BUG C fix) the essentials
    // + work step also survive whole. Pre-BUG-C this only checked the cd
    // line, so a cwd long enough to squeeze the work step out at tier 1 could
    // squeeze it out here too (the cd line eats into the SAME head+tail
    // budget) and still be accepted as "ok" — landing the agent in the right
    // folder with no idea what to do next. Reject that and fall through to
    // tier 3, which drops the path entirely and gives the work step its full,
    // path-length-independent budget back.
    const cdLine = buildCdLine(cwd);
    const withCd = foldCdIntoEssentials(essentials, cdLine);
    const prompt = fitCompactEssentials(withCd, budgetNoCwd);
    if (prompt.includes(cwd) && essentialsSurviveWhole(essentials, prompt)) {
      const url = buildLink({ prompt });
      if (url.length <= cap) return { ok: true, url, droppedCwd: true };
    }
  }

  // Tier 3 — folder-less minimal launch: essentials only, no directory info.
  const prompt = fitCompactEssentials(essentials, budgetNoCwd);
  const url = buildLink({ prompt });
  if (url.length <= cap) return { ok: true, url, droppedCwd: !!cwd };

  return { ok: false };
}

/**
 * Whether every essential step (essentials.headSteps) AND the work step
 * (essentials.work) are present, WHOLE, in `prompt`. A caller with no step
 * breakdown (back-compat — see CompactPromptEssentials.headSteps) can't be
 * checked this way, so each half degrades to `true` for it — tier 1's gate
 * then reduces to its pre-FIX-A `budgetWithCwd > 0` check alone, unchanged
 * for that caller.
 *
 * BUG C fix (6th rework cycle): previously this only checked `headSteps`, so
 * a tier-1 build that squeezed the cwd param in at the cost of silently
 * dropping (or, pre-fix, fragmenting) the work step still passed as "ok" —
 * the agent would land in the right folder with no idea what to do next.
 * Requiring `work` to survive whole here forces the ladder to fall through to
 * tier 2/3 (drop the cwd param, retry against the full, path-length-
 * independent budget) whenever a long cwd would otherwise cost the work step.
 */
function essentialsSurviveWhole(essentials: CompactPromptEssentials, prompt: string): boolean {
  const headStepsOk =
    !essentials.headSteps || essentials.headSteps.every((step) => prompt.includes(step));
  const workOk = essentials.work === undefined || prompt.includes(essentials.work);
  return headStepsOk && workOk;
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
 * Remove the saved launch config for an idea. Used once a browser pin has been
 * migrated into `idea_project_paths` (existing-mode pins only — see
 * `decidePinMigration`) so it stops being read/re-migrated on every load. Also
 * SSR-safe / no-op if storage is unavailable, matching `writeLaunchPath`.
 */
export function clearLaunchPathPin(ideaId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(launchPathKey(ideaId));
  } catch {
    // Storage disabled — nothing to clean up.
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
 *  - saved localStorage config for this idea, in CREATE-NEW mode → use it
 *    verbatim. This is the ONLY case the browser store still drives: a
 *    not-yet-created folder (parent + name) has no server equivalent, so
 *    localStorage remains its home. A saved EXISTING-mode entry is no longer
 *    read here — `idea_project_paths` (via `effectiveTarget`) is the single
 *    source of truth for a folder that already exists (see
 *    `resolveEffectiveLaunchTarget` for why: the pin and the server record
 *    could silently disagree, and the pin always won, even when stale).
 *  - a known folder is on file (recorded/manually-pinned DB path for THIS
 *    machine — surfaced via `effectiveTarget`) → existing mode at that
 *    absolute path, so the bootstrap prompt SKIPS the create-folder/
 *    mkdir/git-init block (the deep link's cwd already lands the session
 *    there). This applies WHETHER OR NOT the idea has a repo — a repo-backed
 *    idea with a known folder gets the same treatment as a no-repo one (this
 *    is the fix for the "repo-backed idea's recorded folder never surfaces"
 *    bug: `effectiveTarget` must be checked before the repo check below, or
 *    the repo branch always wins and the recorded path is dead code).
 *  - idea has a GitHub repo, no known folder → existing mode, empty path; the
 *    repo slug resolves the working copy locally (the fresh-machine flow).
 *  - no repo, no known folder → a brand-new project under ~/projects/<slug>;
 *    the agent mkdir's it.
 *
 * `effectiveTarget` is optional so callers without recorded paths (the terminal
 * dock's payload-less fallback) keep working unchanged — they pass nothing and
 * fall through to the create-new/repo-empty-path default exactly as before.
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
  // Browser store survives ONLY for create-new-project mode — a folder that
  // doesn't exist yet has no server-side row to be "the" record of. An
  // existing-mode pin falls through to the server-only resolution below.
  if (saved && saved.mode === "new") return saved;
  // A known folder (recorded/manually-pinned via resolveEffectiveLaunchTarget)
  // opens THERE as existing mode so the prompt matches the cwd — checked
  // BEFORE the repo fallback below so a repo-backed idea's known folder isn't
  // shadowed by the empty-path repo default.
  if (effectiveTarget && effectiveTarget.source !== "none" && effectiveTarget.cwd) {
    return { mode: "existing", path: effectiveTarget.cwd };
  }
  if (ideaGithubUrl) return { mode: "existing", path: "" };
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
 *  - existing mode with a non-empty absolute path → use it. This covers a
 *    user-pinned path AND a recorded/pinned folder that
 *    `resolveDefaultLaunchState` promoted into existing mode for a
 *    repo-backed idea (state carries no repo flag of its own — the path being
 *    non-empty is what makes this branch fire either way).
 *  - new (no-repo) mode → the caller's effective cwd (the saved path or the
 *    agent-recorded path for THIS machine — resolveEffectiveLaunchTarget.cwd).
 *    Callers without the recorded paths (the dock's payload-less fallback) pass
 *    undefined, and the bootstrap prompt's directory step creates
 *    ~/projects/<slug> instead. (`~`-paths don't expand in the cwd param.)
 *  - repo-backed, no known folder (existing mode, empty path) → no cwd; the
 *    repo slug / prompt directory step resolves the working copy.
 */
export function resolveLaunchCwd(
  state: LaunchPathState,
  effectiveCwd: string | undefined
): string | undefined {
  if (state.mode === "existing" && state.path.trim()) return state.path.trim();
  if (state.mode === "new") return effectiveCwd;
  return undefined;
}
