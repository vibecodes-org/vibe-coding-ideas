// Runs every file in package.json's "test" script one at a time, each with its
// own time limit, printing each file's result as it finishes. Used by CI so a
// single stuck file is named (and the rest still run) instead of the whole job
// timing out with no output. Exit code is non-zero if any file failed.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = JSON.parse(fs.readFileSync(path.join(here, "package.json"), "utf8")).scripts.test;
const files = script.split(/\s+/).filter((t) => t.endsWith(".mjs") && !t.startsWith("-"));
const limitMs = Number(process.env.FILE_LIMIT_MS || 240000);
const failed = [];
for (const f of files) {
  const t0 = Date.now();
  console.log(`::group::${f}`);
  const r = spawnSync(process.execPath, ["--test", "--test-concurrency=1", f], {
    cwd: here,
    stdio: "inherit",
    timeout: limitMs,
    killSignal: "SIGKILL",
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const timedOut = r.error && r.error.code === "ETIMEDOUT";
  console.log("::endgroup::");
  console.log(`${r.status === 0 ? "PASS" : timedOut ? "TIMEOUT" : "FAIL"} ${f} (${secs}s)`);
  if (r.status !== 0) failed.push(f);
}
console.log(`\n${files.length - failed.length}/${files.length} files passed`);
if (failed.length) console.log("FAILED FILES:\n  " + failed.join("\n  "));
process.exit(failed.length ? 1 : 0);
