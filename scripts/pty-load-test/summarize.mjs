#!/usr/bin/env node
// Aggregates result-*.txt probe outputs into a markdown table and applies the
// RQ1 verdict gate for spike 966c7d8f.
//
// Exit code: 0 => PASS (all expected labels present, none FAIL).
//            1 => BLOCKED (an expected label is missing, or any row FAIL).

import { readFileSync, readdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dir") out.dir = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.dir) {
  process.stderr.write("summarize: missing --dir <dir>\n");
  process.exit(2);
}

const EXPECTED_LABELS = ["win-conpty", "linux-glibc", "linux-musl", "macos-x64", "macos-arm64"];
const PRIMARY_LABELS = ["win-conpty", "macos-arm64"]; // RQ1 primaries

// ---------------------------------------------------------------------------
// parse key=value line (values may be quoted)
// ---------------------------------------------------------------------------
function parseLine(line) {
  const row = {};
  // match key=value where value is "quoted" or unquoted (no spaces)
  const re = /(\w+)=("([^"]*)"|(\S+))/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    row[m[1]] = m[3] !== undefined ? m[3] : m[4];
  }
  return row;
}

function loadRows(dir) {
  let files;
  try {
    files = readdirSync(dir);
  } catch (err) {
    process.stderr.write(`summarize: cannot read --dir ${dir}: ${err.message}\n`);
    process.exit(2);
  }
  const resultFiles = files.filter((f) => /^result-.*\.txt$/.test(f));
  const rows = [];
  for (const f of resultFiles) {
    let content;
    try {
      content = readFileSync(join(dir, f), "utf8");
    } catch {
      continue;
    }
    const line = content.split(/\r?\n/).find((l) => l.includes("result="));
    if (!line) continue;
    const row = parseLine(line);
    if (row.result) rows.push(row);
  }
  return rows;
}

const rows = loadRows(args.dir);

// ---------------------------------------------------------------------------
// render markdown table
// ---------------------------------------------------------------------------
function renderTable(rows) {
  const header = "| Platform | Label | libc | Signal A | Signal B | Spawn | Result |";
  const sep = "| --- | --- | --- | --- | --- | --- | --- |";
  const lines = [header, sep];
  // stable ordering: by expected label order, then any extras
  const order = (lbl) => {
    const i = EXPECTED_LABELS.indexOf(lbl);
    return i === -1 ? EXPECTED_LABELS.length : i;
  };
  const sorted = [...rows].sort((a, b) => order(a.label) - order(b.label));
  for (const r of sorted) {
    lines.push(
      `| ${r.platform || "?"} | ${r.label || "?"} | ${r.libc || "?"} | ${r.signalA || "?"} | ${r.signalB || "?"} | ${r.spawn || "?"} | ${r.result || "?"} |`
    );
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// gate
// ---------------------------------------------------------------------------
const presentLabels = new Set(rows.map((r) => r.label));
const missing = EXPECTED_LABELS.filter((l) => !presentLabels.has(l));
const failed = rows.filter((r) => r.result === "FAIL").map((r) => r.label || "?");

const out = [];
out.push("## node-pty probe — RQ1 (spike 966c7d8f)");
out.push("");
out.push(renderTable(rows));
out.push("");

let exitCode = 0;
if (missing.length > 0) {
  out.push(`**BLOCKED** — missing required runner result(s): ${missing.join(", ")}`);
  exitCode = 1;
}
if (failed.length > 0) {
  out.push(`**BLOCKED** — live PTY spawn FAILED on: ${failed.join(", ")}`);
  exitCode = 1;
}
if (exitCode === 0) {
  out.push("**PASS** — all expected runners reported, every row is CLEAN or FALLBACK (none FAIL).");
}

// RQ1 primaries note
const primaryStatus = PRIMARY_LABELS.map((p) => {
  if (!presentLabels.has(p)) return `${p}=MISSING`;
  const row = rows.find((r) => r.label === p);
  return `${p}=${row ? row.result : "?"}`;
}).join(", ");
out.push("");
out.push(`RQ1 primaries (must be present and not FAIL): ${primaryStatus}`);

const report = out.join("\n");
process.stdout.write(report + "\n");
if (process.env.GITHUB_STEP_SUMMARY) {
  try {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, report + "\n");
  } catch {
    // non-fatal
  }
}

process.exit(exitCode);
