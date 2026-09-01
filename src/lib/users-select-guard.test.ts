import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, type Dirent } from "node:fs";
import { join, relative } from "node:path";

/**
 * Regression guard for the `public.users` PII-exposure bug (card: anon-key
 * readable users table — encrypted_anthropic_key, admin flags, credits, PII
 * for all 298 rows via a bare `select("*")` PostgREST call).
 *
 * The DB-side fix is column-level grants (see
 * supabase/migrations/00151_restrict_anon_users_column_access.sql) — RLS and
 * grants aren't reachable from Vitest, so this test can't exercise the actual
 * access control. What it CAN pin down is the app-side half of the fix:
 * `src/app/(main)/profile/[id]/page.tsx` used to run `select("*")` against an
 * arbitrary route-param id and hand the whole row (including
 * encrypted_anthropic_key ciphertext, is_admin/is_super_admin,
 * ai_starter_credits) to every logged-in viewer via ProfileHeader /
 * EditProfileDialog, independent of any grant. This guards against that
 * exact shape reappearing — here or anywhere else new.
 *
 * Originally this guard only matched direct `.from("users").select("*")`
 * calls — which missed the embedded-join form (`"*, author:users!ideas_
 * author_id_fkey(*)"` on an `ideas`/`comments`/etc. query) entirely. That gap
 * is exactly how a second instance of the same bug class shipped in this
 * file (the ideas/collabIdeas author join) alongside the first review: the
 * pattern wasn't in scope for the scan, not an allowlist miss. The second
 * guard below (`users select() guard (embedded-join wildcard)`) closes that
 * coverage gap the same way — allowlist known pre-existing offenders, fail
 * on anything new.
 *
 * NOT COVERED — explicitly out of scope for this test and this fix:
 *   - RLS / column-grant enforcement itself (needs a live Postgres role to
 *     test against; not exercised here).
 *   - The ~10 pre-existing embedded-join wildcard files carried in the
 *     second guard's ALLOWLIST below (dashboard, ideas, discussions, board
 *     activity/comments, idea-team.ts, board-refetch.ts) — same class of
 *     over-fetch, but fixing all of them is a much larger diff than this
 *     security hotfix and is tracked separately, not attempted here.
 */

// Directories scanned for direct `.from("users").select("*")` calls.
const SCAN_DIRS = ["src", "mcp-server/src"];

/**
 * Files with a known, pre-existing `.from("users").select("*")` call that
 * this security fix did NOT touch (out of scope — see file header). Do not
 * add a new file here without a comment justifying why it's not the same bug.
 *
 * Empty as of migration 00165 (Phase 2b of the `public.users` PII hardening):
 * `src/lib/idea-team.ts` and `src/components/ideas/add-collaborator-popover.tsx`
 * (the two previous entries) were both narrowed to explicit column lists —
 * see idea-team.ts's `TEAM_USER_COLUMNS` and the popover's inline select().
 */
const ALLOWLIST: ReadonlyArray<string> = [];

const repoRoot = process.cwd();

function walk(dir: string): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return []; // directory may not exist in some checkouts
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(full));
    } else if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".test.tsx") &&
      !entry.name.endsWith(".d.ts")
    ) {
      files.push(full);
    }
  }
  return files;
}

/** Matches `.from("users").select("*")` (any quote style, any whitespace/newlines between calls). */
const WILDCARD_USERS_SELECT_RE = /\.from\(\s*["']users["']\s*\)\s*\.select\(\s*["']\*["']/;

describe("users table select() guard", () => {
  const allFiles = SCAN_DIRS.flatMap((d) => walk(join(repoRoot, d)));

  it("finds source files (sanity: the scan actually works)", () => {
    // If this drops to zero the scan is broken and the guard below is vacuous.
    expect(allFiles.length).toBeGreaterThan(100);
  });

  it("detects the wildcard pattern in a synthetic snippet (sanity: the regex actually works)", () => {
    expect(WILDCARD_USERS_SELECT_RE.test('supabase.from("users").select("*")')).toBe(true);
    expect(
      WILDCARD_USERS_SELECT_RE.test('supabase\n  .from("users")\n  .select("*")\n  .eq("id", id)')
    ).toBe(true);
    // Narrow, explicit selects must NOT trip the guard.
    expect(
      WILDCARD_USERS_SELECT_RE.test('supabase.from("users").select("id, full_name")')
    ).toBe(false);
  });

  it("no un-allowlisted file calls .from(\"users\").select(\"*\")", () => {
    const violations: string[] = [];

    for (const file of allFiles) {
      const rel = relative(repoRoot, file).replace(/\\/g, "/");
      if (ALLOWLIST.includes(rel)) continue;
      if (WILDCARD_USERS_SELECT_RE.test(readFileSync(file, "utf8"))) {
        violations.push(rel);
      }
    }

    expect(
      violations,
      `These files run a wildcard select("*") against the users table — every ` +
        `column (including encrypted_anthropic_key, is_admin/is_super_admin, ` +
        `ai_starter_credits) flows into the row for an id that may not be the ` +
        `caller. Either scope the select to the columns actually rendered, or, ` +
        `if this is a pre-existing instance of the tracked-but-not-yet-fixed ` +
        `pattern, add it to ALLOWLIST with a reason:\n` +
        violations.map((v) => `  - ${v}`).join("\n")
    ).toEqual([]);
  });

  it("profile/[id]/page.tsx (the fixed file) is not in the allowlist", () => {
    // Pins the fix itself: this file used to be the 5th offender. If it's
    // back in ALLOWLIST, the fix regressed rather than being removed.
    expect(ALLOWLIST).not.toContain("src/app/(main)/profile/[id]/page.tsx");
  });
});

/** Matches a wildcard embedded-resource select on `users`, e.g.
 *  `users!ideas_author_id_fkey(*)` or `users(*)`, however it's labelled
 *  (`author:`, `assignee:`, `user:`, ...) and wherever it's nested inside a
 *  larger select() string. This is the pattern the first guard's regex
 *  couldn't see — it only matched a direct `.from("users").select("*")`. */
const EMBEDDED_USERS_WILDCARD_RE = /users(?:![A-Za-z0-9_]+)?\(\s*\*\s*\)/;

/**
 * Files with a known, pre-existing embedded `users(...)(*)` join that this
 * security fix did NOT touch (out of scope — see file header). Do not add a
 * new file here without a comment justifying why it's not the same bug.
 *
 * Empty as of migration 00165 (Phase 2b of the `public.users` PII hardening):
 * every file previously listed here (dashboard, ideas, idea detail/board/
 * discussions pages, activity-timeline.tsx, task-comments-section.tsx,
 * board-refetch.ts, idea-team.ts) had its embedded `users(...)` joins
 * narrowed to explicit column lists — see each file's select() comment for
 * the exact fields and why.
 */
const EMBEDDED_WILDCARD_ALLOWLIST: ReadonlyArray<string> = [];

describe("users select() guard (embedded-join wildcard)", () => {
  const allFiles = SCAN_DIRS.flatMap((d) => walk(join(repoRoot, d)));

  it("detects the embedded wildcard pattern in a synthetic snippet (sanity: the regex actually works)", () => {
    expect(
      EMBEDDED_USERS_WILDCARD_RE.test('.select("*, author:users!ideas_author_id_fkey(*)")')
    ).toBe(true);
    expect(EMBEDDED_USERS_WILDCARD_RE.test('.select("*, assignee:users(*)")')).toBe(true);
    // Narrow, explicit embedded selects must NOT trip the guard.
    expect(
      EMBEDDED_USERS_WILDCARD_RE.test(
        '.select("*, author:users!ideas_author_id_fkey(id, full_name, avatar_url, is_admin)")'
      )
    ).toBe(false);
  });

  it("no un-allowlisted file embeds a wildcard users(...) join", () => {
    const violations: string[] = [];

    for (const file of allFiles) {
      const rel = relative(repoRoot, file).replace(/\\/g, "/");
      if (EMBEDDED_WILDCARD_ALLOWLIST.includes(rel)) continue;
      if (EMBEDDED_USERS_WILDCARD_RE.test(readFileSync(file, "utf8"))) {
        violations.push(rel);
      }
    }

    expect(
      violations,
      `These files embed a wildcard users(...) join in a select() — every ` +
        `column of the joined author/assignee/actor row (including ` +
        `encrypted_anthropic_key) flows into the response for a user who is, ` +
        `by definition, someone other than the querying viewer. Either scope ` +
        `the embedded select to the columns actually rendered, or, if this is ` +
        `a pre-existing instance of the tracked-but-not-yet-fixed pattern, add ` +
        `it to EMBEDDED_WILDCARD_ALLOWLIST with a reason:\n` +
        violations.map((v) => `  - ${v}`).join("\n")
    ).toEqual([]);
  });

  it("profile/[id]/page.tsx is not in the embedded-wildcard allowlist", () => {
    // Pins this session's second fix: the ideas/collabIdeas author join used
    // to embed users!ideas_author_id_fkey(*). If it's back in the allowlist,
    // that fix regressed rather than being removed.
    expect(EMBEDDED_WILDCARD_ALLOWLIST).not.toContain("src/app/(main)/profile/[id]/page.tsx");
  });
});

describe("profile/[id]/page.tsx: users select is column- AND viewer-scoped", () => {
  const PROFILE_PAGE = "src/app/(main)/profile/[id]/page.tsx";
  const content = readFileSync(join(repoRoot, PROFILE_PAGE), "utf8");

  // The settings-only columns (see SETTINGS_ONLY_COLUMNS below) used to be
  // fetched from HERE, inside an `if (isOwnProfile)` guard. Task 32cf1ee5
  // ("Move profile page settings into a dedicated Settings area") moved that
  // query — and the settings UI it fed — out of this file entirely, onto its
  // own route (`src/app/(main)/settings/page.tsx`), which has no route-param
  // id to guard against: `requireAuth()` there always returns the caller's
  // own row. The guard on those two things moving together now lives in the
  // "settings/page.tsx" describe block below; this file should no longer
  // mention them at all, which the "excludes the settings-only columns" test
  // above already covers for the public query — this just pins that the old
  // isOwnProfile-guarded second query is gone, not just narrowed.
  it("no longer runs a second, isOwnProfile-guarded users query for the settings-only columns", () => {
    expect(content).not.toMatch(/if \(isOwnProfile\) \{\s*const \{ data \} = await supabase/);
    expect(content).not.toContain("ownSettings");
  });

  // The four "settings" columns must NEVER appear in the public query — they
  // regressed once already (a long explicit column list still fetched them
  // unconditionally, so they landed in the RSC payload for every viewer, not
  // just the profile owner) even after `select("*")` was first narrowed.
  //
  // `has_anthropic_key` replaces `encrypted_anthropic_key` here (migration
  // 00152 revoked `authenticated`'s SELECT on the ciphertext column
  // entirely — this page only ever needed the BYOK/Platform truthiness, now
  // served by the generated column instead).
  const SETTINGS_ONLY_COLUMNS = [
    "notification_preferences",
    "default_board_columns",
    "has_anthropic_key",
    "model_tier_map",
  ];

  it("the public profileUser query is column-scoped and excludes the settings-only columns", () => {
    const match = content.match(
      /const \{ data: profileUser \} = await supabase\s*\.from\("users"\)\s*\.select\(\s*"([^"]+)"\s*\)\s*\.eq\("id", id\)\s*\.single\(\)/
    );
    expect(match, "expected to find the public profileUser query in the file").not.toBeNull();

    const columns = match![1].split(",").map((c) => c.trim());

    // Every column ProfileHeader/EditProfileDialog/showDeleteButton actually render.
    for (const required of [
      "id",
      "full_name",
      "avatar_url",
      "bio",
      "github_username",
      "contact_info",
      "created_at",
      "is_admin",
    ]) {
      expect(columns, `expected profileUser select to include "${required}"`).toContain(required);
    }

    // Columns this page never renders and must not fetch for an arbitrary
    // route-param id — the exact list the pre-fix `select("*")` leaked, and
    // that a merely-narrowed-but-still-unconditional select also leaked.
    for (const forbidden of [
      ...SETTINGS_ONLY_COLUMNS,
      "email",
      "is_super_admin",
      "ai_starter_credits",
      "ai_daily_limit",
      "ai_enabled",
      "is_bot",
      "mcp_connected_at",
      "onboarding_completed_at",
      "updated_at",
    ]) {
      expect(columns, `expected profileUser select NOT to include "${forbidden}"`).not.toContain(
        forbidden
      );
    }
  });

});

describe("settings/page.tsx: users select is column- and self-scoped", () => {
  const SETTINGS_PAGE = "src/app/(main)/settings/page.tsx";
  const content = readFileSync(join(repoRoot, SETTINGS_PAGE), "utf8");

  // Same list as the profile-page describe block above — the settings-only
  // columns this new page now owns fetching, and the only file that should.
  const SETTINGS_ONLY_COLUMNS = [
    "notification_preferences",
    "default_board_columns",
    "has_anthropic_key",
    "model_tier_map",
  ];

  it("fetches the settings-only columns scoped to the authenticated user's own id", () => {
    // /settings has no route-param id to guard against — `requireAuth()`
    // always hands back the caller's own row, so `.eq("id", user.id)` here
    // (not some route param) is what keeps this self-scoped by construction.
    const match = content.match(
      /const \{ data: settings \} = await supabase\s*\.from\("users"\)\s*\.select\(\s*"([^"]+)"\s*\)\s*\.eq\("id", user\.id\)\s*\.single\(\)/
    );
    expect(match, "expected to find the self-scoped settings query in the file").not.toBeNull();

    const columns = match![1].split(",").map((c) => c.trim());
    for (const required of SETTINGS_ONLY_COLUMNS) {
      expect(columns, `expected the settings query to include "${required}"`).toContain(required);
    }
  });

  it("the query's viewer id comes from requireAuth(), not a route param", () => {
    expect(content).toContain("const { user, supabase } = await requireAuth();");
  });
});

/**
 * Regression guard for the `encrypted_anthropic_key` cross-user-readable
 * ciphertext bug (migration 00152): 9 call sites read the column across 8
 * files, but 7 only ever tested truthiness. Migration 00152 revoked
 * `authenticated`'s SELECT on the raw column entirely and added a
 * `has_anthropic_key` generated column for the boolean-only readers;
 * `resolveAiProvider` (src/lib/ai-helpers.ts) is the ONE legitimate holdout,
 * reading the ciphertext through a narrowly-scoped service-role client to
 * decrypt it.
 *
 * This guards the fix from regressing: any NEW `.select()` naming
 * `encrypted_anthropic_key` outside ai-helpers.ts either (a) will fail at
 * runtime once `authenticated` can no longer read the column, or (b) is a
 * sign a future feature reached for the raw ciphertext instead of
 * `has_anthropic_key` — both worth catching in review before they ship.
 */
describe("encrypted_anthropic_key select() guard", () => {
  // The one file allowed to select the raw ciphertext column — it reads
  // through a service-role client specifically to decrypt it for BYOK use.
  const ALLOWED_FILE = "src/lib/ai-helpers.ts";

  const allFiles = SCAN_DIRS.flatMap((d) => walk(join(repoRoot, d)));

  /** Matches `.select("...")` calls whose column-list argument names
   *  `encrypted_anthropic_key` — scoped to select() call arguments (not raw
   *  text) so comments/docs mentioning the column by name don't false-positive. */
  const SELECT_WITH_KEY_RE = /\.select\(\s*"[^"]*\bencrypted_anthropic_key\b[^"]*"\s*\)/;

  it("detects the pattern in a synthetic snippet (sanity: the regex actually works)", () => {
    expect(
      SELECT_WITH_KEY_RE.test('.select("encrypted_anthropic_key, ai_starter_credits")')
    ).toBe(true);
    // A doc comment mentioning the column by name must NOT trip the guard.
    expect(
      SELECT_WITH_KEY_RE.test("// encrypted_anthropic_key is sensitive, don't select it")
    ).toBe(false);
    // Narrow selects using the generated boolean flag must NOT trip the guard.
    expect(SELECT_WITH_KEY_RE.test('.select("has_anthropic_key, ai_starter_credits")')).toBe(
      false
    );
  });

  it("no file outside ai-helpers.ts calls .select() naming encrypted_anthropic_key", () => {
    const violations: string[] = [];

    for (const file of allFiles) {
      const rel = relative(repoRoot, file).replace(/\\/g, "/");
      if (rel === ALLOWED_FILE) continue;
      if (SELECT_WITH_KEY_RE.test(readFileSync(file, "utf8"))) {
        violations.push(rel);
      }
    }

    expect(
      violations,
      `These files select() the raw encrypted_anthropic_key column, which ` +
        `\`authenticated\` no longer has SELECT on (migration 00152) — the query ` +
        `will fail at runtime. Use the generated \`has_anthropic_key\` boolean ` +
        `column instead unless you genuinely need to decrypt the ciphertext, in ` +
        `which case route the read through a service-role client the way ` +
        `resolveAiProvider() does:\n` +
        violations.map((v) => `  - ${v}`).join("\n")
    ).toEqual([]);
  });

  it("ai-helpers.ts itself still selects encrypted_anthropic_key (sanity: the allowlist target is real)", () => {
    const content = readFileSync(join(repoRoot, ALLOWED_FILE), "utf8");
    expect(SELECT_WITH_KEY_RE.test(content)).toBe(true);
  });
});

/**
 * Regression guard for the narrowing work above (migration 00165, re-applying
 * the `authenticated` column-level revoke that 00153 rolled back): every call
 * site that used to run a wildcard `users` select must still fetch every
 * column its UI actually renders, and must never fetch `encrypted_anthropic_key`
 * (which `authenticated` can no longer SELECT at all — that query would now
 * fail at runtime). These pin the specific column lists chosen during the
 * narrowing so a future edit can't silently widen (security regression) or
 * narrow (functionality regression) one of them without a test failing.
 */
describe("narrowed users select()/join column lists (migration 00165 regression guard)", () => {
  const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

  // A file must select every column in `required` (in the given select()/join
  // fragment) and none of `forbidden`. `pattern` locates the specific
  // select()/join call within the file's source so unrelated selects in the
  // same file can't accidentally satisfy the assertion.
  function expectColumns(content: string, pattern: RegExp, required: string[], forbidden: string[] = []) {
    const match = content.match(pattern);
    expect(match, `expected to find a match for ${pattern}`).not.toBeNull();
    const fragment = match![0];
    for (const col of required) {
      expect(fragment, `expected "${col}" in: ${fragment}`).toContain(col);
    }
    for (const col of [...forbidden, "encrypted_anthropic_key"]) {
      expect(fragment, `did not expect "${col}" in: ${fragment}`).not.toContain(col);
    }
  }

  it("idea-team.ts: TEAM_USER_COLUMNS covers every field teamMembers/allMentionable consumers render", () => {
    const content = read("src/lib/idea-team.ts");
    expectColumns(
      content,
      /const TEAM_USER_COLUMNS = "([^"]+)"/,
      ["id", "full_name", "avatar_url", "email", "is_bot", "notification_preferences"]
    );
    // All three fetches (author, embedded collaborators join, bot users) reuse the constant.
    expect(content.match(/TEAM_USER_COLUMNS/g)?.length).toBeGreaterThanOrEqual(4); // 1 declaration + 3 uses
  });

  it("add-collaborator-popover.tsx: search select covers rendered fields + the is_bot filter column", () => {
    const content = read("src/components/ideas/add-collaborator-popover.tsx");
    expectColumns(
      content,
      /\.from\("users"\)\s*\.select\("([^"]+)"\)/,
      ["id", "full_name", "avatar_url", "email", "is_bot"]
    );
  });

  it("ideas/page.tsx and dashboard/page.tsx: idea author joins cover exactly what IdeaCard renders", () => {
    for (const file of ["src/app/(main)/ideas/page.tsx", "src/app/(main)/dashboard/page.tsx"]) {
      const content = read(file);
      const matches = [...content.matchAll(/author:users!ideas_author_id_fkey\(([^)]+)\)/g)];
      expect(matches.length, `expected at least one author join in ${file}`).toBeGreaterThan(0);
      for (const m of matches) {
        expect(m[1]).toContain("id");
        expect(m[1]).toContain("full_name");
        expect(m[1]).toContain("avatar_url");
        expect(m[1]).toContain("is_admin");
        expect(m[1]).not.toContain("encrypted_anthropic_key");
      }
    }
  });

  it("dashboard/page.tsx: unused board_tasks assignee join is scoped to id only", () => {
    const content = read("src/app/(main)/dashboard/page.tsx");
    expectColumns(
      content,
      /assignee:users!board_tasks_assignee_id_fkey\(([^)]+)\)/,
      ["id"]
    );
    const match = content.match(/assignee:users!board_tasks_assignee_id_fkey\(([^)]+)\)/);
    expect(match![1].trim()).toBe("id");
  });

  it("board_tasks assignee joins (board page + board-refetch.ts) cover what board-task-card.tsx renders", () => {
    for (const file of ["src/app/(main)/ideas/[id]/board/page.tsx", "src/lib/board-refetch.ts"]) {
      const content = read(file);
      expectColumns(
        content,
        /assignee:users!board_tasks_assignee_id_fkey\(([^)]+)\)/,
        ["id", "full_name", "email", "avatar_url", "is_bot"]
      );
    }
  });

  it("ideas/[id]/page.tsx: author/comments/collaborators/requester joins are column-scoped", () => {
    const content = read("src/app/(main)/ideas/[id]/page.tsx");
    // `\*, author:...` (not the separate generateMetadata query, which only
    // selects `full_name` and is intentionally minimal — not part of this fix).
    expectColumns(content, /\*, author:users!ideas_author_id_fkey\(([^)]+)\)/, ["id", "full_name", "avatar_url"]);
    expectColumns(content, /author:users!comments_author_id_fkey\(([^)]+)\)/, ["id", "full_name", "avatar_url"]);
    expectColumns(content, /user:users!collaborators_user_id_fkey\(([^)]+)\)/, ["id", "full_name", "avatar_url"]);
    expectColumns(content, /requester:users!collaboration_requests_requester_id_fkey\(([^)]+)\)/, ["id", "full_name", "avatar_url"]);
    // RecentDiscussionsPreview never reads the discussion author — scoped to id only.
    const discussionAuthor = content.match(/author:users!idea_discussions_author_id_fkey\(([^)]+)\)/);
    expect(discussionAuthor![1].trim()).toBe("id");
  });

  it("discussions list/detail pages: author/reply joins cover displayName()/avatar/bot-badge fields", () => {
    expectColumns(
      read("src/app/(main)/ideas/[id]/discussions/page.tsx"),
      /author:users!idea_discussions_author_id_fkey\(([^)]+)\)/,
      ["id", "full_name", "email", "avatar_url", "is_bot"]
    );
    const discussionDetail = read("src/app/(main)/ideas/[id]/discussions/[discussionId]/page.tsx");
    expectColumns(
      discussionDetail,
      /author:users!idea_discussions_author_id_fkey\(([^)]+)\)/,
      ["id", "full_name", "email", "avatar_url", "is_bot"]
    );
    expectColumns(
      discussionDetail,
      /author:users!idea_discussion_replies_author_id_fkey\(([^)]+)\)/,
      ["id", "full_name", "avatar_url", "is_bot"]
    );
  });

  it("activity-timeline.tsx: actor join covers displayName()/bot-badge fields, no unused avatar_url", () => {
    const content = read("src/components/board/activity-timeline.tsx");
    const matches = [...content.matchAll(/actor:users!board_task_activity_actor_id_fkey\(([^)]+)\)/g)];
    expect(matches.length).toBe(2); // initial fetch + realtime re-fetch
    for (const m of matches) {
      expect(m[1]).toContain("id");
      expect(m[1]).toContain("full_name");
      expect(m[1]).toContain("email");
      expect(m[1]).toContain("is_bot");
      expect(m[1]).not.toContain("encrypted_anthropic_key");
    }
  });

  it("task-comments-section.tsx: author join covers avatar/displayName()/bot-badge fields", () => {
    const content = read("src/components/board/task-comments-section.tsx");
    const matches = [...content.matchAll(/author:users!board_task_comments_author_id_fkey\(([^)]+)\)/g)];
    expect(matches.length).toBe(2); // initial fetch + realtime re-fetch
    for (const m of matches) {
      expect(m[1]).toContain("id");
      expect(m[1]).toContain("full_name");
      expect(m[1]).toContain("email");
      expect(m[1]).toContain("avatar_url");
      expect(m[1]).toContain("is_bot");
    }
  });
});

/**
 * Regression guard for migration 00165 itself: pins the exact `authenticated`
 * column grant list. This can't exercise real Postgres GRANT enforcement
 * (that needs a live database — verified separately), but it CAN catch the
 * two ways this specific migration breaks the app if edited carelessly:
 * (1) dropping a real column from the grant list breaks every query naming
 * it (the exact shape of the 00153 incident, just from a missing grant
 * instead of a missing wildcard-narrowing), and (2) re-adding
 * `encrypted_anthropic_key` reopens the hole 00152 closed.
 */
describe("migration 00165: authenticated column grant", () => {
  const MIGRATION_FILE = "supabase/migrations/00165_reapply_authenticated_users_column_grant.sql";
  const content = readFileSync(join(repoRoot, MIGRATION_FILE), "utf8");

  // Every real column of public.users as of this migration, verified against
  // the live schema (information_schema.columns) — not copied from 00152's
  // now-stale list, which predates terminal_model/terminal_auto_accept/
  // feed_preferences.
  const EXPECTED_GRANTED_COLUMNS = [
    "id",
    "email",
    "full_name",
    "avatar_url",
    "bio",
    "github_username",
    "contact_info",
    "notification_preferences",
    "default_board_columns",
    "feed_preferences",
    "model_tier_map",
    "terminal_model",
    "terminal_auto_accept",
    "is_admin",
    "is_super_admin",
    "is_bot",
    "ai_enabled",
    "has_anthropic_key",
    "ai_daily_limit",
    "ai_starter_credits",
    "onboarding_completed_at",
    "mcp_connected_at",
    "created_at",
    "updated_at",
  ];

  it("revokes the table-level grant before re-granting columns", () => {
    expect(content).toMatch(/revoke select on table public\.users from authenticated;/);
  });

  it("grants exactly the expected column list to authenticated, excluding encrypted_anthropic_key", () => {
    const match = content.match(/grant select \(([\s\S]*?)\) on public\.users to authenticated;/);
    expect(match, "expected to find the authenticated column grant").not.toBeNull();

    const columns = match![1]
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);

    expect(columns.sort()).toEqual([...EXPECTED_GRANTED_COLUMNS].sort());
    expect(columns).not.toContain("encrypted_anthropic_key");
  });

  it("does not touch the anon role's grants or any RLS policy", () => {
    // Only checks actual SQL statements, not prose — the migration's header
    // comments legitimately discuss `anon` (why it's out of scope) and
    // "policy" (why RLS isn't the mechanism here).
    const sqlStatements = content
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(sqlStatements).not.toMatch(/\banon\b/);
    expect(sqlStatements.toLowerCase()).not.toContain("policy");
  });
});
