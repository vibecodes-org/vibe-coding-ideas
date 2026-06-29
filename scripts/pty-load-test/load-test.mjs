#!/usr/bin/env node
// Isolated node-pty probe for spike 966c7d8f RQ1.
//
// Determines, per runner, whether node-pty installed via a prebuilt binary
// (CLEAN) or fell back to a local node-gyp compile (FALLBACK), and whether a
// live PTY can actually be spawned. Emits one machine-parseable result line.
//
// Exit code: 0 for any verdict (CLEAN / FALLBACK / FAIL). Non-zero ONLY on a
// harness error (cannot read the install log, or node-pty import throws before
// a spawn was attempted). The pass/fail GATE lives in summarize.mjs.

import { readFileSync, existsSync, readdirSync, statSync, appendFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// arg parsing
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--install-log") out.installLog = argv[++i];
    else if (a === "--label") out.label = argv[++i];
    else if (a === "--out") out.out = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const label = args.label || "unknown";

function harnessError(msg) {
  process.stderr.write(`pty-load-test harness error: ${msg}\n`);
  process.exit(2);
}

if (!args.installLog) harnessError("missing --install-log <path>");
if (!args.out) harnessError("missing --out <path>");

// ---------------------------------------------------------------------------
// platform / arch / libc detection
// ---------------------------------------------------------------------------
const platform = process.platform;
const arch = process.arch;

function detectLibc() {
  if (platform !== "linux") return "n/a";
  try {
    const header = process.report.getReport().header;
    // glibcVersionRuntime present => glibc; absent on linux => musl (Alpine).
    return header && header.glibcVersionRuntime ? "glibc" : "musl";
  } catch {
    return "unknown";
  }
}
const libc = detectLibc();

// ---------------------------------------------------------------------------
// Signal A — install-log forensics
// ---------------------------------------------------------------------------
// Match ONLY true-execution evidence that a compiler / node-gyp actually ran.
// NOT the bare "node-gyp rebuild" string: node-pty 1.1.0's install script is
// literally `node scripts/prebuild.js || node-gyp rebuild`, and npm's verbose
// log echoes that command definition verbatim even when prebuild.js succeeds
// and node-gyp never runs. The markers below appear only on a real compile.
const COMPILE_MARKERS = [
  "gyp info spawn",
  "gyp info ok",
  "CXX(",
  "clang++ ",
  "clang ",
  "cc1plus",
  "cl.exe",
  "c++ -o",
  "make: entering",
  ".target.mk",
  "creating library", // MSVC linker line
];

function computeSignalA(logPath) {
  let raw;
  try {
    raw = readFileSync(logPath, "utf8");
  } catch (err) {
    harnessError(`cannot read install log at ${logPath}: ${err.message}`);
  }
  const hay = raw.toLowerCase();
  const compiled = COMPILE_MARKERS.some((m) => hay.includes(m.toLowerCase()));
  // Binary signal: real compiler ran ⇒ FALLBACK; a successful install with no
  // compile evidence means the prebuilt path was taken ⇒ CLEAN.
  return compiled ? "FALLBACK" : "CLEAN";
}
const signalA = computeSignalA(args.installLog);

// ---------------------------------------------------------------------------
// Signal B — artifact inspection of node_modules/node-pty
// ---------------------------------------------------------------------------
const PTY_DIR = join(process.cwd(), "node_modules", "node-pty");

function walkForNode(dir) {
  // returns list of absolute paths to *.node files under dir (recursive)
  const found = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      found.push(...walkForNode(full));
    } else if (e.isFile() && e.name.endsWith(".node")) {
      found.push(full);
    }
  }
  return found;
}

function computeSignalB() {
  const buildRelease = join(PTY_DIR, "build", "Release");
  const prebuildsDir = join(PTY_DIR, "prebuilds", `${platform}-${arch}`);

  const buildNodes = walkForNode(buildRelease);
  const prebuildNodes = walkForNode(prebuildsDir);
  const hasBuild = buildNodes.length > 0;
  const hasPrebuild = prebuildNodes.length > 0;

  if (hasBuild) return { signalB: "FALLBACK", buildNodes, prebuildNodes };
  if (hasPrebuild) return { signalB: "CLEAN", buildNodes, prebuildNodes };
  return { signalB: "MISSING", buildNodes, prebuildNodes };
}
const { signalB, buildNodes, prebuildNodes } = computeSignalB();

// ---------------------------------------------------------------------------
// macOS spawn-helper chmod fix
// ---------------------------------------------------------------------------
if (platform === "darwin") {
  const candidates = [];
  const buildRelease = join(PTY_DIR, "build", "Release");
  const prebuildsRoot = join(PTY_DIR, "prebuilds");
  for (const root of [buildRelease, prebuildsRoot]) {
    function findHelper(dir) {
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = join(dir, e.name);
        if (e.isDirectory()) findHelper(full);
        else if (e.isFile() && e.name === "spawn-helper") candidates.push(full);
      }
    }
    findHelper(root);
  }
  for (const helper of candidates) {
    try {
      chmodSync(helper, 0o755);
    } catch {
      // best-effort; ignore
    }
  }
}

// ---------------------------------------------------------------------------
// Live spawn
// ---------------------------------------------------------------------------
// Signal B (on-disk artifacts) is the authoritative determinant of origin;
// Signal A (log forensics) corroborates. node-pty ships prebuilts under
// prebuilds/<plat-arch>/ and only creates build/Release/*.node when it compiles.
function reconcile(spawn) {
  if (spawn !== "OK") {
    return { result: "FAIL", reason: spawnFailReason(spawn) };
  }
  if (signalB === "FALLBACK") {
    // A real compile produced on-disk artifacts — authoritative, regardless of A.
    return {
      result: "FALLBACK",
      reason: "build/Release/*.node present (real compile produced on-disk artifacts); live PTY spawned and echoed PTYOK",
    };
  }
  if (signalB === "CLEAN") {
    if (signalA === "FALLBACK") {
      // Prebuilt present yet the log shows a real compile ran too — genuine
      // disagreement; fall back conservatively.
      return {
        result: "FALLBACK",
        reason: "prebuilt binary present but install log shows a real compile ran (genuine disagreement A=FALLBACK/B=CLEAN); conservative FALLBACK; live PTY spawned and echoed PTYOK",
      };
    }
    return {
      result: "CLEAN",
      reason: "prebuilt binary used (prebuilds/<plat-arch>/*.node present, no build/); no compiler lines in install log; live PTY spawned and echoed PTYOK",
    };
  }
  // signalB === "MISSING": no .node located on disk — lean on A + spawn.
  if (signalA === "FALLBACK") {
    return {
      result: "FALLBACK",
      reason: "no .node artifact located on disk but install log shows a real compile ran; live PTY spawned and echoed PTYOK",
    };
  }
  return {
    result: "CLEAN",
    reason: "no .node artifact located on disk and no compiler lines in install log (indeterminate origin); live PTY spawned and echoed PTYOK",
  };
}

function spawnFailReason(spawn) {
  if (spawn === "TIMEOUT") return "live PTY spawn timed out after 10s (no PTYOK / no exit)";
  return "live PTY spawn did not produce PTYOK with exitCode 0";
}

function emit(result, spawn, reason) {
  const safeReason = String(reason).replace(/"/g, "'").replace(/[\r\n]+/g, " ");
  const line = `result=${result} label=${label} platform=${platform} arch=${arch} libc=${libc} signalA=${signalA} signalB=${signalB} spawn=${spawn} reason="${safeReason}"`;
  process.stdout.write(line + "\n");
  try {
    writeFileSync(args.out, line + "\n");
  } catch (err) {
    process.stderr.write(`warning: could not write --out ${args.out}: ${err.message}\n`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, line + "\n");
    } catch {
      // non-fatal
    }
  }
  return line;
}

async function main() {
  let pty;
  try {
    pty = await import("node-pty");
  } catch (err) {
    // import threw before any spawn => harness error per spec
    harnessError(`failed to import node-pty: ${err && err.message ? err.message : err}`);
    return;
  }

  const spawnFn = pty.spawn || (pty.default && pty.default.spawn);
  if (typeof spawnFn !== "function") {
    harnessError("node-pty imported but no spawn() export found");
    return;
  }

  let data = "";
  let settled = false;
  let timer;

  const spawnResult = await new Promise((resolve) => {
    let child;
    try {
      child = spawnFn(
        process.execPath,
        ["-e", "process.stdout.write('PTYOK')"],
        { name: "xterm-color", cols: 80, rows: 24, cwd: process.cwd(), env: process.env }
      );
    } catch (err) {
      resolve({ spawn: "FAIL", err });
      return;
    }

    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill();
      } catch {
        // ignore
      }
      resolve({ spawn: "TIMEOUT" });
    }, 10000);

    child.onData((d) => {
      data += d;
    });

    child.onExit(({ exitCode }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const ok = data.includes("PTYOK") && exitCode === 0;
      resolve({ spawn: ok ? "OK" : "FAIL", exitCode });
    });
  });

  const spawn = spawnResult.spawn;
  const { result, reason } = reconcile(spawn);
  emit(result, spawn, reason);
  // Verdict exit code is always 0 here; gate lives in summarize.mjs.
  process.exit(0);
}

main().catch((err) => {
  // Anything unexpected after import counts as a harness error.
  harnessError(`unexpected: ${err && err.stack ? err.stack : err}`);
});
