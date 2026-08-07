import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, type Dirent } from "node:fs";
import { join, relative } from "node:path";

/**
 * Regression guard for the "one board query eating ~14% of all database
 * time" incident (board task a1345112).
 *
 * THE BUG: four call sites queried `board_task_labels` (which has no
 * `idea_id` column) by joining through `board_tasks!inner(...)` and
 * filtering `.eq("board_tasks.idea_id", …)` / `.in("board_tasks.idea_id",
 * …)`. Combined with `is_idea_team_member()` being VOLATILE (fixed
 * separately in migration 00155), this forced Postgres's RLS policy on
 * `board_task_labels` to run its per-row `EXISTS` check against every row of
 * the whole platform-wide table before the idea filter could narrow
 * anything — confirmed via prod `pg_stat_statements` at a 71x regression
 * (mean 1,067.61 ms vs 14.95 ms) over 13,756 calls, ~14% of all DB exec
 * time. The fix (see src/lib/board-refetch.ts `fetchTaskLabelsByLabelIds`,
 * and its three call sites plus src/actions/kits.ts's previously-undocumented
 * 4th variant) filters by `label_id` instead — bounded and safe because
 * every `board_labels` row belongs to exactly one idea.
 *
 * WHAT THIS GUARD CAN CATCH: a `board_task_labels` query whose source text,
 * within the same statement, both (a) joins `board_tasks!inner` and (b)
 * filters on `board_tasks.idea_id` via `.eq(...)`/`.in(...)` — the exact
 * textual shape of all four regressions. It is a static regex scan over
 * `.ts`/`.tsx` source.
 *
 * WHAT THIS GUARD CANNOT CATCH — stated plainly, because this repo has been
 * burned before by a guard test whose limits weren't stated:
 *   - It proves nothing about production query performance or RLS cost. A
 *     query can pass this guard and still be slow (e.g. a `label_id` filter
 *     without the migration 00154 index, or a fresh VOLATILE RLS helper
 *     added to a different table). Only `EXPLAIN (ANALYZE, BUFFERS)` against
 *     prod, under role `authenticated`, actually measures that — see the
 *     "Reproduce & Investigate" step's methodology on this same task.
 *   - It is purely syntactic. A semantically-identical scope-via-idea-join
 *     written through a raw SQL RPC, a differently-named join alias, string
 *     concatenation, or a helper function that builds the `.eq()` call
 *     dynamically would not be matched.
 *   - It only scans `src/` and `mcp-server/src/` `.ts`/`.tsx` files — not
 *     `.sql` migrations, not generated code, not the `.js` build output.
 *   - The window-based scan below (`WINDOW_CHARS`) can miss a match if the
 *     `board_tasks!inner` join and the `board_tasks.idea_id` filter are
 *     separated by more source than the window, or produce a false positive
 *     if two unrelated `.from("board_task_labels")` chains happen to sit
 *     within one window of each other (mitigated by stopping the window at
 *     the next `.from(`, not eliminated).
 */

const SCAN_DIRS = ["src", "mcp-server/src"];
const WINDOW_CHARS = 600;

/**
 * Files with a known, pre-existing `board_task_labels` query that joins
 * `board_tasks!inner` AND filters `board_tasks.idea_id`, but is NOT one of
 * the four pathological variants fixed on this task — each already drives
 * its scope primarily off a narrow `.eq("label_id", …)` filter (not off the
 * idea join), so it doesn't reproduce the "scan the whole table" bug. Not
 * touched by this fix; tracked as pre-existing, same pattern as
 * users-select-guard.test.ts's ALLOWLIST. Do not add a new file here
 * without a comment justifying why it's not the same bug class.
 */
const ALLOWLIST: ReadonlyArray<string> = [
  // applyAutoRuleRetroactively (removeRelatedWorkflows cleanup) and
  // applyAutoRuleRetroactively (server action): both filter
  // `.eq("label_id", rule.label_id)` first — the idea_id join is
  // supplementary, not the driving predicate.
  "src/actions/workflow-templates.ts",
  // applyAutoRuleRetroactively (MCP tool): same shape, filters
  // `.eq("label_id", rule.label_id)` first.
  "mcp-server/src/tools/workflows.ts",
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

const FROM_BOARD_TASK_LABELS_RE = /\.from\(\s*["']board_task_labels["']\)/g;
const HAS_INNER_JOIN_RE = /board_tasks!inner/;
const HAS_IDEA_ID_FILTER_RE = /\.(?:eq|in)\(\s*["']board_tasks\.idea_id["']/;

/**
 * Find every `.from("board_task_labels")` call in `content` that, within
 * `WINDOW_CHARS` (and before the next `.from(` call, so unrelated chains
 * don't bleed together), both joins `board_tasks!inner` and filters on
 * `board_tasks.idea_id`.
 */
function findIdeaJoinOffsets(content: string): number[] {
  const offsets: number[] = [];
  let m: RegExpExecArray | null;
  FROM_BOARD_TASK_LABELS_RE.lastIndex = 0;
  while ((m = FROM_BOARD_TASK_LABELS_RE.exec(content)) !== null) {
    const windowEnd = Math.min(content.length, m.index + WINDOW_CHARS);
    let window = content.slice(m.index, windowEnd);
    const nextFromIdx = window.indexOf(".from(", 6);
    if (nextFromIdx !== -1) window = window.slice(0, nextFromIdx);
    if (HAS_INNER_JOIN_RE.test(window) && HAS_IDEA_ID_FILTER_RE.test(window)) {
      offsets.push(m.index);
    }
  }
  return offsets;
}

describe("board_task_labels idea-join guard", () => {
  const allFiles = SCAN_DIRS.flatMap((d) => walk(join(repoRoot, d)));

  it("finds source files (sanity: the scan actually works)", () => {
    expect(allFiles.length).toBeGreaterThan(100);
  });

  it("detects the regressed shape in synthetic snippets (sanity: the matcher works)", () => {
    expect(
      findIdeaJoinOffsets(
        '.from("board_task_labels").select("task_id, label:board_labels!board_task_labels_label_id_fkey(*), board_tasks!inner(idea_id)").eq("board_tasks.idea_id", id)'
      ).length
    ).toBe(1);

    // The dashboard's multi-idea .in(...) form must also be caught.
    expect(
      findIdeaJoinOffsets(
        '.from("board_task_labels").select("task_id, board_tasks!inner(idea_id)").in("board_tasks.idea_id", allUserIdeaIds)'
      ).length
    ).toBe(1);

    // Undocumented 4th variant shape: idea_id filter applied even though the
    // embed only names a different column (archived).
    expect(
      findIdeaJoinOffsets(
        '.from("board_task_labels").select("task_id, label_id, board_tasks!inner(archived)").eq("board_tasks.idea_id", ideaId).eq("board_tasks.archived", false)'
      ).length
    ).toBe(1);

    // The fixed shape (label_id filter, no idea_id join) must NOT trip it.
    expect(
      findIdeaJoinOffsets(
        '.from("board_task_labels").select("task_id, label:board_labels!board_task_labels_label_id_fkey(*)").in("label_id", labelIds)'
      ).length
    ).toBe(0);

    // A board_tasks!inner join that exists for a DIFFERENT reason (no
    // idea_id filter alongside it) must NOT trip it either.
    expect(
      findIdeaJoinOffsets(
        '.from("board_task_labels").select("task_id, label_id, board_tasks!inner(archived)").in("label_id", ideaLabelIds).eq("board_tasks.archived", false)'
      ).length
    ).toBe(0);
  });

  it("no un-allowlisted file re-introduces the idea-join scope shape on board_task_labels", () => {
    const violations: string[] = [];

    for (const file of allFiles) {
      const rel = relative(repoRoot, file).replace(/\\/g, "/");
      if (ALLOWLIST.includes(rel)) continue;
      if (findIdeaJoinOffsets(readFileSync(file, "utf8")).length > 0) {
        violations.push(rel);
      }
    }

    expect(
      violations,
      `These files query board_task_labels by joining board_tasks!inner and ` +
        `filtering on board_tasks.idea_id — the exact shape that made this ` +
        `table's RLS policy scan every row of the platform-wide table (71x ` +
        `regression, ~14% of prod DB time). Filter by label_id instead (see ` +
        `fetchTaskLabelsByLabelIds in src/lib/board-refetch.ts), or, if this ` +
        `is a pre-existing instance already driven primarily by a narrow ` +
        `label_id filter, add it to ALLOWLIST with a reason:\n` +
        violations.map((v) => `  - ${v}`).join("\n")
    ).toEqual([]);
  });

  it("the four fixed call sites are not in the allowlist (pins the fix itself)", () => {
    // If any of these come back, the fix regressed rather than being kept.
    for (const fixed of [
      "src/app/(main)/ideas/[id]/board/page.tsx",
      "src/lib/board-refetch.ts",
      "src/app/(main)/dashboard/page.tsx",
      "src/actions/kits.ts",
    ]) {
      expect(ALLOWLIST).not.toContain(fixed);
    }
  });

  it("the four fixed call sites no longer trip the guard", () => {
    for (const fixed of [
      "src/app/(main)/ideas/[id]/board/page.tsx",
      "src/lib/board-refetch.ts",
      "src/app/(main)/dashboard/page.tsx",
      "src/actions/kits.ts",
    ]) {
      const content = readFileSync(join(repoRoot, fixed), "utf8");
      expect(
        findIdeaJoinOffsets(content),
        `expected ${fixed} not to contain the idea-join scope shape on board_task_labels`
      ).toEqual([]);
    }
  });
});
