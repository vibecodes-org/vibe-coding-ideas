// Find the folder a Claude conversation actually ran in, from Claude's own
// transcript store (Nick, 26 Oct 2026, card 5e654dd1).
//
// A session that never recorded its project folder used to have nothing to
// resume into, so Reconnect/Resume quietly started a brand-new conversation.
// Claude keeps every conversation as `<config>/projects/<folder-key>/<id>.jsonl`
// (config = $CLAUDE_CONFIG_DIR, else ~/.claude), and each transcript line
// carries the `cwd` it ran in. So given the conversation id the helper can
// find the real folder itself and `claude --resume <id>` there.
//
// Pure apart from the injected `fs` (sync calls only), `env` and `homedir`.
// Reads at most the first TRANSCRIPT_HEAD_BYTES of one file per project folder
// that has the id; never lists transcript contents beyond that.

import path from "node:path";

/** Most bytes read from the head of a transcript to find its first `cwd`. */
export const TRANSCRIPT_HEAD_BYTES = 256 * 1024;

/** Claude's per-user config folder. */
export function claudeConfigDir({ env, homedir }) {
  const fromEnv = typeof env?.CLAUDE_CONFIG_DIR === "string" ? env.CLAUDE_CONFIG_DIR.trim() : "";
  return fromEnv || path.join(homedir, ".claude");
}

/** The `cwd` of the first transcript line that has one, or null. @param {string} text */
export function firstCwdInTranscript(text) {
  for (const line of text.split("\n")) {
    if (!line.includes('"cwd"')) continue;
    try {
      const obj = JSON.parse(line);
      if (obj && typeof obj.cwd === "string" && obj.cwd.trim()) return obj.cwd.trim();
    } catch {
      /* a line cut off at the byte limit, or not JSON — keep looking */
    }
  }
  return null;
}

/**
 * The folder the conversation `id` ran in on this Mac, or null when no
 * transcript for it exists (or none names a folder). `id` must already be a
 * validated UUID (sanitizeConversationId), so it can't climb out of the folder.
 * @param {{ id: string, fs: any, env: Record<string, string | undefined>, homedir: string }} args
 * @returns {string | null}
 */
export function findConversationFolder({ id, fs, env, homedir }) {
  if (!id || !/^[0-9a-fA-F-]{36}$/.test(id)) return null;
  const projects = path.join(claudeConfigDir({ env, homedir }), "projects");
  let keys;
  try {
    keys = fs.readdirSync(projects);
  } catch {
    return null;
  }
  for (const key of keys) {
    const file = path.join(projects, key, `${id}.jsonl`);
    let fd;
    try {
      fd = fs.openSync(file, "r");
      const buf = Buffer.alloc(TRANSCRIPT_HEAD_BYTES);
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      const cwd = firstCwdInTranscript(buf.subarray(0, n).toString("utf8"));
      if (cwd) return cwd;
    } catch {
      /* not in this project folder */
    } finally {
      if (fd !== undefined) {
        try { fs.closeSync(fd); } catch { /* ignore */ }
      }
    }
  }
  return null;
}
