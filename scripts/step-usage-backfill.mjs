#!/usr/bin/env node
//
// Step cost backfill (card ba37039b)
// ----------------------------------
// The admin step report's cost column only fills in for steps that reported
// their token use when they finished. This works it out for past runs from
// the Claude Code transcripts still on this machine (Claude Code keeps about
// 30 days by default), and writes a file to import on
// Admin → Reports → Step Performance → Import past cost.
//
// Read-only and offline: it reads ${CLAUDE_CONFIG_DIR:-~/.claude}/projects and
// writes one JSON file holding step ids, outcomes, times and token counts —
// no prompts, no transcript text, no tokens. Run it on every machine (and
// cloud session) that ran workflow steps; importing the same file twice, or
// a step that already has a cost, changes nothing.
//
// Usage:
//   node scripts/step-usage-backfill.mjs [--out step-usage-backfill.json] [--since 2026-09-01]
//                                        [--session-share] [--steps steps.txt]
//
// --steps <file>      only these steps (one step id per line; # starts a comment).
// --session-share     only the claiming session's own calls, no subagents, marked
//                     so the import adds them to steps that already have a cost
//                     (for a step whose helper cost was imported on its own).

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { backfillSession } from "./lib/step-usage-backfill.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const out = opt("--out", "step-usage-backfill.json");
const since = opt("--since", "");
if (since && Number.isNaN(Date.parse(since))) {
  console.error(`--since must be a date, like 2026-09-01 (got "${since}")`);
  process.exit(1);
}

const sessionShare = args.includes("--session-share");
let onlySteps = null;
const stepsFile = opt("--steps", "");
if (args.includes("--steps") && !stepsFile) {
  console.error("--steps needs a file of step ids, one per line");
  process.exit(1);
}
if (stepsFile) {
  if (!existsSync(stepsFile)) {
    console.error(`No such file: ${stepsFile}`);
    process.exit(1);
  }
  onlySteps = new Set(
    readFileSync(stepsFile, "utf8")
      .split("\n")
      .map((l) => l.replace(/#.*/, "").trim().toLowerCase())
      .filter(Boolean)
  );
  const bad = [...onlySteps].filter((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id));
  if (bad.length) {
    console.error(`Not step ids (uuid): ${bad.slice(0, 3).join(", ")}`);
    process.exit(1);
  }
}

const root = join(process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), ".claude"), "projects");
if (!existsSync(root)) {
  console.error(`No Claude Code transcripts at ${root}`);
  process.exit(1);
}

const linesOf = (path) => readFileSync(path, "utf8").split("\n").filter(Boolean);
// A JavaScript string tops out near 512 MB.
const MAX_BYTES = 400 * 1024 * 1024;

const seen = new Set();
const attempts = [];
let sessions = 0;
let skipped = 0;
for (const project of readdirSync(root)) {
  const dir = join(root, project);
  if (!statSync(dir).isDirectory()) continue;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".jsonl")) continue;
    const path = join(dir, name);
    if (statSync(path).size > MAX_BYTES) continue;
    const text = readFileSync(path, "utf8");
    if (!text.includes("claim_next_step")) continue;
    sessions++;
    const subagents = join(dir, name.slice(0, -".jsonl".length), "subagents");
    const result = backfillSession(text.split("\n").filter(Boolean), (id) => {
      const f = join(subagents, `agent-${id}.jsonl`);
      return existsSync(f) ? linesOf(f) : null;
    }, { sessionShareOnly: sessionShare });
    skipped += result.skipped;
    for (const a of result.attempts) {
      if (since && a.ended_at < since) continue;
      if (onlySteps && !onlySteps.has(a.step_id)) continue;
      // A resumed or forked session repeats its history in a new file.
      const key = `${a.step_id} ${a.ended_at}`;
      if (seen.has(key)) continue;
      seen.add(key);
      attempts.push(a);
    }
  }
}

attempts.sort((a, b) => a.ended_at.localeCompare(b.ended_at));
writeFileSync(out, JSON.stringify({ kind: "vibecodes-step-usage-backfill", version: 1, attempts }) + "\n");
const range = attempts.length ? ` from ${attempts[0].ended_at.slice(0, 10)} to ${attempts.at(-1).ended_at.slice(0, 10)}` : "";
console.error(
  (sessionShare ? "Session share only (no subagents). " : "") +
    `Read ${sessions} session${sessions === 1 ? "" : "s"} with workflow steps: ${attempts.length} step attempt${attempts.length === 1 ? "" : "s"} costed${range}.` +
    (skipped ? ` ${skipped} left out (a subagent's transcript is gone, or no model calls).` : "") +
    `\nWrote ${out}. Import it on Admin → Reports → Step Performance → Import past cost.`
);
