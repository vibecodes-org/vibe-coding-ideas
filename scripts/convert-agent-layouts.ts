// One-off: move every old-layout agent into the new instructions layout
// (task 472d5672, Nick's change 1). Run by the "Agent layout conversion"
// GitHub Actions workflow against production; see
// src/lib/agent-layout-conversion.ts for the rules and the safety checks.
//
//   node convert-agent-layouts.cjs --mode dry-run|apply|verify|restore \
//        [--confirm CONVERT|RESTORE] [--owner-id <user id>] [--show <platform agent id>]
//
// Needs SUPABASE_URL and SUPABASE_SERVICE_KEY in the environment.
//
// THIS REPOSITORY IS PUBLIC and CI logs are public: output is ids, owner
// group, layout, lengths and counts only. Never print a prompt or an agent name.

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  formatReport,
  parseCliArgs,
  runMode,
  showPlatformAgent,
} from "@/lib/agent-layout-conversion";
import { createSupabaseConversionStore } from "@/lib/agent-layout-conversion-store";

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function main(): Promise<number> {
  const args = parseCliArgs(process.argv.slice(2));

  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_KEY?.trim();
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY are required");

  const store = createSupabaseConversionStore(createClient<Database>(url, key, { auth: { persistSession: false } }));

  if (args.show) {
    const shown = await showPlatformAgent(store, args.show);
    out("--- before ---");
    out(shown.before);
    out("--- after ---");
    out(shown.after ?? "(not an old-layout agent: nothing to convert)");
    return 0;
  }

  const report = await runMode(args.mode, store, { ownerId: args.ownerId });
  for (const line of formatReport(report)) out(line);

  // A failed row is left untouched and the run carries on, but the job fails so
  // somebody looks. Verify also fails if anything is still in the old layout.
  return (report.counts.failed ?? 0) > 0 ? 1 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    out(`error: ${err instanceof Error ? err.message : "unknown error"}`);
    process.exitCode = 1;
  },
);
