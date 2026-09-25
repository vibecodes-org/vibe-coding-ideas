#!/usr/bin/env node
//
// Migration drift check
// ---------------------
// Compares the repo's `supabase/migrations/*.sql` files against the migrations
// actually recorded in a project's `supabase_migrations.schema_migrations`, and
// reports any repo migration that is NOT present in the remote history.
//
// Why this exists:
//   This repo names migrations `00NNN_description.sql`, but production records
//   them under TIMESTAMP versions (with the `00NNN_…` stem in the `name` column).
//   The two schemes don't sort together, so `supabase db push` can't reliably
//   tell what's applied and a migration can silently fail to land (this is exactly
//   what happened to 00126). Run this after any prod apply to confirm every repo
//   migration is recorded. See docs/release-process.md → "Migration tracking drift".
//
// Hold list:
//   `supabase/migrations/.held` names migrations deliberately NOT applied yet
//   (one stem per line, `#` comments). Held + unrecorded is fine and is listed
//   as "Held (intentional)"; held + already recorded is an error (the hold is
//   stale, or it was violated). An absent file means nothing is held.
//   See docs/release-process.md → "Holding a migration on purpose".
//
// Usage:
//   SUPABASE_ACCESS_TOKEN=<token> SUPABASE_PROJECT_REF=<prod-ref> \
//     node scripts/check-migration-drift.mjs
//
//   (SUPABASE_ACCESS_TOKEN: supabase.com/dashboard/account/tokens — same secret CI uses.
//    SUPABASE_PROJECT_REF: the production project ref; falls back to PROD_PROJECT_REF.)
//
// Exit codes:
//   0 = no drift (held migrations are listed but allowed)
//   1 = drift: a migration is missing, or a held migration is already applied
//   2 = misconfiguration / API error / bad `.held` file (malformed line or a stem
//       with no matching .sql file) — the `.held` checks run before any network call.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseHeldList, classify, heldListProblems } from "./lib/migration-drift.mjs";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations");
const stems = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => f.replace(/\.sql$/, ""))
  .sort();

let heldText = "";
try {
  heldText = readFileSync(join(migrationsDir, ".held"), "utf8");
} catch (err) {
  if (err.code !== "ENOENT") {
    console.error(`Could not read supabase/migrations/.held: ${err.message}`);
    process.exit(2);
  }
}
const held = parseHeldList(heldText);
const problems = heldListProblems(held, stems);
if (problems.length) {
  console.error("supabase/migrations/.held has problems — fix it before checking drift:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(2);
}

const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF || process.env.PROD_PROJECT_REF;

if (!token || !ref) {
  console.error(
    "Missing env. Set SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF (production project ref)."
  );
  process.exit(2);
}

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    query: "select version, name from supabase_migrations.schema_migrations",
  }),
});

if (!res.ok) {
  console.error(`Supabase Management API query failed: ${res.status} ${res.statusText}`);
  console.error(await res.text());
  process.exit(2);
}

const rows = await res.json();
const result = classify({ stems, heldStems: held.stems, rows });

console.log(`Repo migrations:      ${stems.length}`);
console.log(`Remote records:       ${rows.length}`);
console.log(`Missing from remote:  ${result.missing.length}`);
console.log(`Held (intentional):   ${result.held.length}`);

if (result.held.length) {
  console.log("\nHeld (intentional) — listed in supabase/migrations/.held, not applied:");
  for (const m of result.held) console.log(`  - ${m}.sql`);
}

let failed = false;

if (result.missing.length) {
  failed = true;
  console.error("\n⚠️  These repo migrations are NOT recorded in the remote history:");
  for (const m of result.missing) console.error(`  - ${m}.sql`);
  console.error(
    "\nApply them and record them — see docs/release-process.md → 'Migration tracking drift'." +
      "\nIf one is deliberately not applied yet, add it to supabase/migrations/.held instead."
  );
}

if (result.heldButApplied.length) {
  failed = true;
  console.error("\n⚠️  These migrations are on the hold list but ARE already recorded remotely:");
  for (const m of result.heldButApplied) console.error(`  - ${m}.sql`);
  console.error(
    "\nEither the hold was violated, or it's stale — if the apply was intended, remove the" +
      "\nline from supabase/migrations/.held. See docs/release-process.md → 'Holding a migration on purpose'."
  );
}

if (failed) process.exit(1);

console.log(
  result.held.length
    ? "\n✅ No drift — every repo migration is recorded, apart from the held ones above."
    : "\n✅ No drift — every repo migration is recorded in the remote history."
);
