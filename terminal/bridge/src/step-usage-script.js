// The step-usage script the app serves with the board's agents, and the one
// safe place the bridge saves it (card 5e654dd1, stage 2b).
//
// WHY: a workflow step's hand-off used to carry the whole token-counting
// command (about 3,000 characters) on every claim. The app now serves that
// command once as a small script file; the hand-off then carries a roughly
// 200-character line that runs the saved file. If the file is missing (a
// session this helper did not launch) the short line prints NO_TRANSCRIPT, and
// the hand-off already treats that as "leave usage out" - a missing file can
// never block a step.
//
// SAFETY, because this writes a file that a later shell command runs:
//   - the file name must be exactly step-usage-<8 hex>.sh, and those 8 hex
//     digits must be the start of the sha256 of the text, so a name and body
//     that don't belong together are refused (no path tricks, no swapped body);
//   - the text must start with "#!/bin/sh", be plain text under 16 KB;
//   - it is written only into <Claude config folder>/vibecodes/, never
//     anywhere the server names, and never through a symlink;
//   - it is not made executable (the hand-off runs it as `sh <file>`);
//   - it is written once: an identical file already there is left alone.
// Everything is best effort and never throws; on any problem the session
// simply launches without the script.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const MAX_STEP_USAGE_SCRIPT_BYTES = 16 * 1024;
const FILE_NAME = /^step-usage-([0-9a-f]{8})\.sh$/;

/**
 * The endpoint's `stepUsageScript` ({ file, body }), or null when absent or
 * not safe to save.
 * @param {unknown} answer the whole endpoint body
 * @returns {{ file: string, body: string } | null}
 */
export function parseStepUsageScript(answer) {
  const raw = answer && typeof answer === "object" ? /** @type {any} */ (answer).stepUsageScript : undefined;
  if (!raw || typeof raw !== "object") return null;
  const { file, body } = /** @type {any} */ (raw);
  if (typeof file !== "string" || typeof body !== "string") return null;
  const name = FILE_NAME.exec(file);
  if (!name) return null;
  if (body.length === 0 || Buffer.byteLength(body, "utf8") > MAX_STEP_USAGE_SCRIPT_BYTES) return null;
  if (!body.startsWith("#!/bin/sh\n") || body.includes("\0")) return null;
  const sha8 = crypto.createHash("sha256").update(body).digest("hex").slice(0, 8);
  if (sha8 !== name[1]) return null;
  return { file, body };
}

/**
 * Where the script goes: the same folder the hand-off command reads,
 * ${CLAUDE_CONFIG_DIR:-$HOME/.claude}/vibecodes. Null when the configured
 * folder is not an absolute path (the shell would resolve it against whatever
 * folder the session happens to be in).
 * @param {Record<string, string | undefined>} env
 * @param {string} [home]
 * @returns {string | null}
 */
export function stepUsageScriptDir(env, home = os.homedir()) {
  const configured = env.CLAUDE_CONFIG_DIR || path.join(home, ".claude");
  return path.isAbsolute(configured) ? path.join(configured, "vibecodes") : null;
}

/**
 * Save the script once. Never throws.
 * @param {{ file: string, body: string }} script already passed parseStepUsageScript
 * @param {string | null} dir from stepUsageScriptDir
 * @returns {"written" | "present" | "skipped" | "failed"}
 */
export function saveStepUsageScript(script, dir) {
  if (!dir || !FILE_NAME.test(script.file)) return "skipped";
  try {
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, script.file);
    let existing = null;
    try {
      existing = fs.lstatSync(target);
    } catch {
      /* not there yet */
    }
    if (existing) {
      if (!existing.isFile()) return "failed"; // a symlink or folder: leave it alone
      if (fs.readFileSync(target, "utf8") === script.body) return "present";
    }
    const tmp = path.join(dir, `.${script.file}.${process.pid}.tmp`);
    fs.writeFileSync(tmp, script.body, { flag: "wx", mode: 0o644 });
    try {
      fs.renameSync(tmp, target);
    } catch (e) {
      fs.rmSync(tmp, { force: true });
      throw e;
    }
    return "written";
  } catch {
    return "failed";
  }
}
