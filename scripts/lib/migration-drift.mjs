//
// Pure logic for the migration drift check (scripts/check-migration-drift.mjs).
// No file system, no network — everything here is unit-tested in
// migration-drift.test.mjs.
//
// The hold list (`supabase/migrations/.held`) names repo migrations that are
// deliberately NOT applied to production yet (e.g. a destructive drop waiting
// for a code release to bake). One migration stem per line; `#` starts a
// comment (whole-line or trailing); blank lines are ignored. A trailing `.sql`
// is tolerated. See docs/release-process.md → "Holding a migration on purpose".

const STEM_RE = /^\d{5}_[A-Za-z0-9_]+$/;

/**
 * Parse the contents of a `.held` file.
 * @param {string} text
 * @returns {{ stems: string[], errors: { line: number, text: string, reason: string }[] }}
 */
export function parseHeldList(text) {
  const stems = [];
  const errors = [];
  const seen = new Set();
  const lines = (text ?? "").split(/\r?\n/);
  lines.forEach((raw, i) => {
    const hash = raw.indexOf("#");
    const content = (hash === -1 ? raw : raw.slice(0, hash)).trim();
    if (!content) return;
    const stem = content.replace(/\.sql$/, "");
    if (!STEM_RE.test(stem)) {
      errors.push({
        line: i + 1,
        text: raw,
        reason: /\s/.test(stem)
          ? "one migration per line (put a reason after `#`)"
          : "not a migration stem like 00161_description",
      });
      return;
    }
    if (seen.has(stem)) return;
    seen.add(stem);
    stems.push(stem);
  });
  return { stems, errors };
}

/**
 * Build the "is this repo migration recorded remotely?" predicate from the
 * rows of `supabase_migrations.schema_migrations`.
 *
 * A repo migration `NNNNN_description` counts as recorded if the remote history
 * has it under ANY of the historical formats this project has used over time:
 *   - name    === full stem        ("00126_refresh_ai_app_agent_labels")  ← current convention
 *   - name    === description only ("add_product_owner_to_kits")          ← some timestamp-era rows
 *   - version === full stem        ("00001_create_users")                 ← oldest rows
 *   - version === numeric prefix   ("00096")                              ← mid-era rows
 * Validated against the live history: 0 false positives across all repo migrations.
 *
 * @param {{ version?: string | null, name?: string | null }[]} rows
 * @returns {(stem: string) => boolean}
 */
export function makeIsRecorded(rows) {
  const versions = new Set(rows.map((r) => r.version).filter(Boolean));
  const names = new Set(rows.map((r) => r.name).filter(Boolean));
  return (stem) => {
    const prefix = stem.slice(0, 5);
    const desc = stem.slice(6);
    return names.has(stem) || names.has(desc) || versions.has(stem) || versions.has(prefix);
  };
}

/**
 * Sort every repo migration into exactly one bucket.
 *   recorded       — applied and recorded remotely (not held)
 *   missing        — not recorded and not held → drift (exit 1)
 *   held           — not recorded, on the hold list → intentional
 *   heldButApplied — on the hold list but already recorded → stale or violated hold (exit 1)
 * Plus `unknownHeld`: hold-list stems with no matching repo file (typo → exit 2).
 *
 * @param {{ stems: string[], heldStems: string[], rows: { version?: string | null, name?: string | null }[] }} input
 */
export function classify({ stems, heldStems, rows }) {
  const isRecorded = makeIsRecorded(rows);
  const heldSet = new Set(heldStems);
  const stemSet = new Set(stems);
  const out = { recorded: [], missing: [], held: [], heldButApplied: [], unknownHeld: [] };
  for (const s of [...stems].sort()) {
    const rec = isRecorded(s);
    if (heldSet.has(s)) (rec ? out.heldButApplied : out.held).push(s);
    else (rec ? out.recorded : out.missing).push(s);
  }
  out.unknownHeld = heldStems.filter((s) => !stemSet.has(s)).sort();
  return out;
}

/**
 * Hold-list problems that make the check unusable (exit 2), computed without
 * touching the network: malformed lines and stems with no matching file.
 * @param {{ stems: string[], errors: { line: number, text: string, reason: string }[] }} parsed
 * @param {string[]} stems  repo migration stems
 * @returns {string[]} human-readable problems (empty = fine)
 */
export function heldListProblems(parsed, stems) {
  const stemSet = new Set(stems);
  return [
    ...parsed.errors.map((e) => `line ${e.line}: "${e.text.trim()}" — ${e.reason}`),
    ...parsed.stems
      .filter((s) => !stemSet.has(s))
      .map((s) => `"${s}" — no such file supabase/migrations/${s}.sql`),
  ];
}
