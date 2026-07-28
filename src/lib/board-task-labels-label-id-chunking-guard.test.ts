import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, type Dirent } from "node:fs";
import { join, relative } from "node:path";

/**
 * Regression guard for a defect found in QA review of the "one board query
 * eating ~14% of all database time" fix (board task a1345112): the fix
 * itself (filtering `board_task_labels` by `label_id` instead of joining
 * through `board_tasks` by `idea_id`) reintroduces the ORIGINAL bug class
 * this whole incident traces back to — an unbounded `.in()` id list — if any
 * one call site's `labelIds` array isn't chunked. `src/lib/db-helpers.ts`'s
 * own comment on `chunkIds`/`IN_FILTER_CHUNK_SIZE` says it plainly: "a long
 * querystring URL... can silently return empty for authenticated requests at
 * scale." `src/actions/kits.ts`'s 4th-variant fix initially shipped without
 * chunking (dormant today — prod's largest idea has 67 labels, under the
 * 100-id chunk size — but not a bound to rely on staying true). The sibling
 * `board-task-labels-idea-join-guard.test.ts` guards the OLD shape
 * (`board_tasks!inner` + `idea_id` join); this guards the NEW one.
 *
 * WHAT THIS GUARD CAN CATCH: a `.in("label_id", <expr>)` call anywhere in the
 * scanned source with no `chunkIds(` call in the `WINDOW_CHARS` of source
 * immediately preceding it. Every real call site as of this fix
 * (`fetchTaskLabelsByLabelIds` in board-refetch.ts, and kits.ts's
 * retroactive auto-rule apply) chunks via `chunkIds(...).map((chunk) =>
 * ....in("label_id", chunk))` in that exact shape, so this passes today and
 * fails the moment a new one doesn't.
 *
 * WHAT THIS GUARD CANNOT CATCH — stated plainly, same convention as the
 * sibling guard, because this repo has been burned before by a guard test
 * whose limits weren't stated:
 *   - It only matches the literal `.in("label_id", …)` call shape. Three
 *     semantically-identical unchunked filters slip past it entirely (found
 *     in QA review of this guard, not currently used anywhere in the repo —
 *     confirmed by grep — but real PostgREST-JS shapes, not hypothetical):
 *       - `.filter("label_id", "in", "(...)")` — the untyped escape hatch
 *         `.in()` itself is built on.
 *       - `.in(dynamicColumnVar, ids)` where the column name is a variable,
 *         not the literal string `"label_id"`.
 *       - `.or(\`label_id.in.(${ids.join(",")})\`)` — PostgREST's
 *         comma-joined OR-filter syntax, which doesn't call `.in(` at all.
 *     None of these are AST-detectable by a regex scan; closing this gap for
 *     real would need a parser (or an eslint rule with type info), not a
 *     bigger regex.
 *   - It cannot verify the chunk size actually used is safe (a
 *     `chunkIds(ids, 5000)` call with an oversized explicit size would still
 *     "pass" this guard — it only checks that `chunkIds(` is present, not
 *     what size it's called with).
 *   - It cannot verify the array passed to `chunkIds(` is the SAME array
 *     later passed to `.in("label_id", ...)` — it is a textual proximity
 *     check, not data-flow analysis. A `chunkIds(someUnrelatedArray)` call
 *     that happens to sit in the window before an unchunked `.in("label_id",
 *     otherArray)` would incorrectly pass.
 *   - It does not verify board scope — it does not confirm the `.in(` call
 *     is even querying `board_task_labels` (no real call site outside that
 *     table uses a `label_id` filter today, confirmed by grep, but a future
 *     unrelated `label_id` column on another table filtered via `.in()`
 *     without chunking would also trip this guard as a false positive).
 *   - It proves nothing about production query performance — see the
 *     sibling guard's header for that limitation in full.
 *   - Same scan-surface limits as the sibling guard: `src/` and
 *     `mcp-server/src/` `.ts`/`.tsx` only, not `.sql`, not generated/build
 *     output.
 *   - It is a raw text scan, not an AST parse — it does not know the
 *     difference between real code and a comment. Writing the literal
 *     string `.in("label_id", …)` in a `//` comment (even to describe what
 *     NOT to do) trips it exactly like real code would; this was caught
 *     writing this guard's own companion comment in kits.ts and reworded to
 *     avoid the literal pattern rather than being allowlisted around.
 *   - `WINDOW_CHARS` (600) is a generous but arbitrary margin, not derived
 *     from anything structural. Measured `chunkIds(` → `.in("label_id",`
 *     distance in the two real call sites today: 174 chars
 *     (board-refetch.ts's `fetchTaskLabelsByLabelIds`), 170 chars
 *     (kits.ts). Comfortable headroom, but a future edit that inserts more
 *     than ~600 chars of code/comments between a `chunkIds(` call and its
 *     matching `.in("label_id", …)` would false-positive correctly-chunked
 *     code. If that ever happens, the fix is to shrink the gap (e.g. move
 *     explanatory comments elsewhere), not to widen the window — a wider
 *     window makes the "unrelated `chunkIds(` call happens to be nearby"
 *     false-negative risk (the bullet above) worse, not better.
 */

const SCAN_DIRS = ["src", "mcp-server/src"];
const WINDOW_CHARS = 600;

/**
 * Files with a known, pre-existing `.in("label_id", …)` call on
 * `board_task_labels` that is NOT chunked via `chunkIds`, but is safe for a
 * stated reason (e.g. the array is provably bounded by something other than
 * chunking). Empty today — every real call site chunks. Do not add an entry
 * here without a comment justifying why it's safe unchunked.
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

const IN_LABEL_ID_RE = /\.in\(\s*["']label_id["']\s*,/g;
const CHUNK_IDS_CALL_RE = /\bchunkIds\(/;

/**
 * Find every `.in("label_id", …)` call in `content` with no `chunkIds(` call
 * in the `WINDOW_CHARS` of source immediately before it.
 */
function findUnchunkedLabelIdInOffsets(content: string): number[] {
  const offsets: number[] = [];
  let m: RegExpExecArray | null;
  IN_LABEL_ID_RE.lastIndex = 0;
  while ((m = IN_LABEL_ID_RE.exec(content)) !== null) {
    const windowStart = Math.max(0, m.index - WINDOW_CHARS);
    const window = content.slice(windowStart, m.index);
    if (!CHUNK_IDS_CALL_RE.test(window)) {
      offsets.push(m.index);
    }
  }
  return offsets;
}

describe("board_task_labels label_id chunking guard", () => {
  const allFiles = SCAN_DIRS.flatMap((d) => walk(join(repoRoot, d)));

  it("finds source files (sanity: the scan actually works)", () => {
    expect(allFiles.length).toBeGreaterThan(100);
  });

  it("detects unchunked and chunked forms in synthetic snippets (sanity: the matcher works)", () => {
    // Defect 1's exact shape: a raw .in("label_id", ideaLabelIds) with no
    // chunkIds anywhere nearby.
    expect(
      findUnchunkedLabelIdInOffsets(
        'const { data } = await supabase.from("board_task_labels").select("task_id, label_id").in("label_id", ideaLabelIds);'
      ).length
    ).toBe(1);

    // Chunked (the fixed shape, and fetchTaskLabelsByLabelIds's own shape):
    // must NOT trip.
    expect(
      findUnchunkedLabelIdInOffsets(
        'const results = await Promise.all(chunkIds(labelIds).map((chunk) => supabase.from("board_task_labels").select("task_id, label_id").in("label_id", chunk)));'
      ).length
    ).toBe(0);

    // A chunkIds() call far outside the window must NOT count as covering a
    // later .in("label_id", …) — regression check for the window itself.
    const farApart = `chunkIds(other);\n${" ".repeat(WINDOW_CHARS)}\nsupabase.from("board_task_labels").select("task_id").in("label_id", ids);`;
    expect(findUnchunkedLabelIdInOffsets(farApart).length).toBe(1);
  });

  it("no un-allowlisted file has an unchunked board_task_labels label_id .in() filter", () => {
    const violations: string[] = [];

    for (const file of allFiles) {
      const rel = relative(repoRoot, file).replace(/\\/g, "/");
      if (ALLOWLIST.includes(rel)) continue;
      if (findUnchunkedLabelIdInOffsets(readFileSync(file, "utf8")).length > 0) {
        violations.push(rel);
      }
    }

    expect(
      violations,
      `These files filter by .in("label_id", …) without a nearby chunkIds(...) ` +
        `call — the same silently-drops-rows-at-scale risk that motivated ` +
        `chunkIds/IN_FILTER_CHUNK_SIZE in the first place (src/lib/db-helpers.ts), ` +
        `now on the label_id filter instead of the old task_id one. Route the ` +
        `call through fetchTaskLabelsByLabelIds (src/lib/board-refetch.ts) or ` +
        `chunk it locally with chunkIds, or, if it's genuinely safe unchunked, ` +
        `add it to ALLOWLIST with a reason:\n` +
        violations.map((v) => `  - ${v}`).join("\n")
    ).toEqual([]);
  });

  it("the two real call sites (board-refetch.ts, kits.ts) are chunked", () => {
    for (const file of ["src/lib/board-refetch.ts", "src/actions/kits.ts"]) {
      const content = readFileSync(join(repoRoot, file), "utf8");
      expect(
        findUnchunkedLabelIdInOffsets(content),
        `expected ${file}'s .in("label_id", …) call(s) to be chunked via chunkIds(...)`
      ).toEqual([]);
      // Sanity: each file actually DOES filter by label_id — if this ever
      // goes to zero, the file stopped being a real call site and should be
      // dropped from this list, not silently pass for the wrong reason.
      expect(content.includes('.in("label_id",')).toBe(true);
    }
  });
});
