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
// Usage:
//   SUPABASE_ACCESS_TOKEN=<token> SUPABASE_PROJECT_REF=<prod-ref> \
//     node scripts/check-migration-drift.mjs
//
//   (SUPABASE_ACCESS_TOKEN: supabase.com/dashboard/account/tokens — same secret CI uses.
//    SUPABASE_PROJECT_REF: the production project ref; falls back to PROD_PROJECT_REF.)
//
// Exit codes: 0 = no drift, 1 = drift found, 2 = misconfiguration / API error.

import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF || process.env.PROD_PROJECT_REF;

if (!token || !ref) {
  console.error(
    "Missing env. Set SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF (production project ref)."
  );
  process.exit(2);
}

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations");
const stems = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => f.replace(/\.sql$/, ""))
  .sort();

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
const versions = new Set(rows.map((r) => r.version).filter(Boolean));
const names = new Set(rows.map((r) => r.name).filter(Boolean));

// A repo migration `NNNNN_description` counts as recorded if the remote history
// has it under ANY of the historical formats this project has used over time:
//   - name    === full stem        ("00126_refresh_ai_app_agent_labels")  ← current convention
//   - name    === description only ("add_product_owner_to_kits")          ← some timestamp-era rows
//   - version === full stem        ("00001_create_users")                 ← oldest rows
//   - version === numeric prefix   ("00096")                              ← mid-era rows
// Validated against the live history: 0 false positives across all repo migrations.
const isRecorded = (stem) => {
  const prefix = stem.slice(0, 5);
  const desc = stem.slice(6);
  return names.has(stem) || names.has(desc) || versions.has(stem) || versions.has(prefix);
};

const missing = stems.filter((s) => !isRecorded(s));

console.log(`Repo migrations:      ${stems.length}`);
console.log(`Remote records:       ${rows.length}`);
console.log(`Missing from remote:  ${missing.length}`);

if (missing.length) {
  console.error("\n⚠️  These repo migrations are NOT recorded in the remote history:");
  for (const m of missing) console.error(`  - ${m}.sql`);
  console.error(
    "\nApply them and record them — see docs/release-process.md → 'Migration tracking drift'."
  );
  process.exit(1);
}

console.log("\n✅ No drift — every repo migration is recorded in the remote history.");
