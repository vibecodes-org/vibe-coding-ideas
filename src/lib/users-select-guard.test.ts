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
 */
const ALLOWLIST: ReadonlyArray<string> = [
  // Idea team roster (author/collaborators) — same "full row to arbitrary
  // idea page" pattern as the profile page bug, not fixed by this hotfix.
  "src/lib/idea-team.ts",
  // NOTE: the discussion pages' direct `.from("users").select("*")` for
  // `currentUser` (previously allowlisted here) was narrowed to an explicit
  // column list as part of the encrypted_anthropic_key migration (00152) —
  // it was a cheap fix to make alongside the column-grant change, so it's
  // no longer in this allowlist. Their SEPARATE embedded-join wildcard
  // (`author:users!...(*)`) is a different call site, still out of scope,
  // and remains in EMBEDDED_WILDCARD_ALLOWLIST below.
  //
  // Collaborator-add autocomplete search — same pattern, not fixed by this hotfix.
  "src/components/ideas/add-collaborator-popover.tsx",
];

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
 */
const EMBEDDED_WILDCARD_ALLOWLIST: ReadonlyArray<string> = [
  "src/app/(main)/dashboard/page.tsx",
  "src/app/(main)/ideas/page.tsx",
  "src/app/(main)/ideas/[id]/page.tsx",
  "src/app/(main)/ideas/[id]/board/page.tsx",
  "src/app/(main)/ideas/[id]/discussions/page.tsx",
  "src/app/(main)/ideas/[id]/discussions/[discussionId]/page.tsx",
  "src/components/board/activity-timeline.tsx",
  "src/components/board/task-comments-section.tsx",
  "src/lib/board-refetch.ts",
  "src/lib/idea-team.ts",
];

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

  it("the settings-only columns are only ever fetched inside an isOwnProfile guard", () => {
    // Anchors the select to being lexically nested inside `if (isOwnProfile) {`
    // — a narrow column list alone doesn't prove the FETCH itself is
    // conditional, which is what actually stops the ciphertext/preferences
    // from ever reaching a viewer who isn't the profile owner.
    const match = content.match(
      /if \(isOwnProfile\) \{\s*const \{ data \} = await supabase\s*\.from\("users"\)\s*\.select\(\s*"([^"]+)"\s*\)\s*\.eq\("id", id\)\s*\.single\(\)/
    );
    expect(
      match,
      "expected an isOwnProfile-guarded users query for the settings-only columns"
    ).not.toBeNull();

    const columns = match![1].split(",").map((c) => c.trim());
    for (const required of SETTINGS_ONLY_COLUMNS) {
      expect(columns, `expected the own-profile query to include "${required}"`).toContain(
        required
      );
    }
  });

  it("the settings-only columns don't appear in any users select() call OUTSIDE the isOwnProfile guard", () => {
    // Belt-and-suspenders: find every `.select("...")` call in the file (not
    // just the two anchored above — catches a future THIRD users query too),
    // and confirm the only one naming a settings-only column is the one
    // lexically inside the isOwnProfile-guarded block. Scoped to select()
    // call arguments (not raw text) so doc comments mentioning these column
    // names by name — like the ones in this file — don't false-positive.
    const guardedBlockMatch = content.match(
      /if \(isOwnProfile\) \{\s*const \{ data \} = await supabase\s*\.from\("users"\)[\s\S]*?\.single\(\);\s*ownSettings = data;\s*\}/
    );
    expect(
      guardedBlockMatch,
      "expected the isOwnProfile-guarded block to be found for this check"
    ).not.toBeNull();
    const guardedStart = guardedBlockMatch!.index!;
    const guardedEnd = guardedStart + guardedBlockMatch![0].length;

    const selectCallRe = /\.select\(\s*"([^"]+)"\s*\)/g;
    let call: RegExpExecArray | null;
    while ((call = selectCallRe.exec(content)) !== null) {
      const isInsideGuardedBlock = call.index >= guardedStart && call.index < guardedEnd;
      if (isInsideGuardedBlock) continue;

      const columns = call[1].split(",").map((c) => c.trim());
      for (const col of SETTINGS_ONLY_COLUMNS) {
        expect(
          columns.includes(col),
          `expected the select() at offset ${call.index} (outside the isOwnProfile guard) NOT to include "${col}"`
        ).toBe(false);
      }
    }
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
