// The main window's own usage, totalled on this Mac and sent to the site
// (card f2a563ca). Reads the session's own Claude conversation file (never a
// helper's file), works out the part workflow steps did not already take
// (terminal/shared/transcript-usage.mjs), and posts only totals: hour, model,
// token counts, step ids and the conversation id. Never text, never folder
// names. Best effort: it never throws and never holds up the terminal.

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { createMainUsageScanner } from "../../shared/transcript-usage.mjs";
import { claudeConfigDir } from "./transcript-folder.js";

/** The site only takes hours inside this window, and this many rows per send. */
export const USAGE_WINDOW_DAYS = 35;
export const MAX_HOUR_ROWS = 2000;
export const MAX_STEP_IDS = 2000;
export const USAGE_SEND_INTERVAL_MS = 60 * 60 * 1000;
export const USAGE_FINAL_TIMEOUT_MS = 10_000;

/**
 * The newest transcript file for conversation `id` under any project folder,
 * or null. Looks in every `projects/<key>/`, worktree keys included.
 * @returns {{ file: string, mtimeMs: number } | null}
 */
export function locateConversationFile({ id, fs: fsImpl = fs, env = process.env, homedir }) {
  if (!id || !/^[0-9a-fA-F-]{36}$/.test(id)) return null;
  const projects = path.join(claudeConfigDir({ env, homedir }), "projects");
  let keys;
  try {
    keys = fsImpl.readdirSync(projects);
  } catch {
    return null;
  }
  let best = null;
  for (const key of keys) {
    const file = path.join(projects, key, `${id}.jsonl`);
    try {
      const st = fsImpl.statSync(file);
      if (st.isFile() && (!best || st.mtimeMs > best.mtimeMs)) best = { file, mtimeMs: st.mtimeMs };
    } catch {
      /* not in this folder */
    }
  }
  return best;
}

/**
 * Streams one transcript (some are hundreds of MB) and totals the main
 * window's own usage. Stops early, returning null, when `signal` aborts.
 */
export async function readMainWindowUsage(file, { signal } = {}) {
  const scanner = createMainUsageScanner();
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (signal?.aborted) return null;
      scanner.push(line);
    }
  } finally {
    rl.close();
  }
  return scanner.finish();
}

/** The request body: the last 35 days only, capped, nothing but numbers and ids. */
export function usageBody(conversationId, usage, now = Date.now()) {
  // One hour inside the route's 35-day edge, so a Mac clock running slow can't get the whole send rejected.
  const since = new Date(now - USAGE_WINDOW_DAYS * 86_400_000 + 3_600_000).toISOString();
  const hours = usage.hours.filter((h) => h.hour >= since).slice(-MAX_HOUR_ROWS);
  return {
    conversationId,
    hours,
    stepIds: usage.stepIds.slice(-MAX_STEP_IDS),
    firstCallAt: usage.firstCallAt,
    lastCallAt: usage.lastCallAt,
  };
}

/**
 * Decides when to send. `send()` skips when the conversation file hasn't
 * changed since the last successful send; `send({ final: true })` is the
 * exit-time send, held to `timeoutMs`. Never throws.
 *
 * @param {{
 *   conversationId: string | null,
 *   locate: () => ({ file: string, mtimeMs: number } | null),
 *   read: (file: string, opts: { signal: AbortSignal }) => Promise<any>,
 *   post: (body: any, opts: { signal: AbortSignal }) => Promise<boolean>,
 *   log?: (level: string, msg: string, extra?: any) => void,
 *   now?: () => number,
 * }} deps
 */
export function createUsageReporter({ conversationId, locate, read, post, log = () => {}, now = Date.now }) {
  let lastSentMtime = null;
  let inflight = null;

  async function run(timeoutMs) {
    const controller = new AbortController();
    const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const found = locate();
      if (!found) return false;
      if (lastSentMtime !== null && found.mtimeMs === lastSentMtime) return false;
      const usage = await read(found.file, { signal: controller.signal });
      if (!usage || controller.signal.aborted) return false;
      const ok = await post(usageBody(conversationId, usage, now()), { signal: controller.signal });
      if (ok) lastSentMtime = found.mtimeMs;
      return ok;
    } catch (e) {
      log("warn", "couldn't send the main window's usage totals", { err: String(e?.message || e) });
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return {
    async send({ final = false, timeoutMs = USAGE_FINAL_TIMEOUT_MS } = {}) {
      if (!conversationId) return false;
      if (inflight && !final) return false;
      if (inflight && final) {
        // let the running send finish (or give up) before the exit-time one
        await Promise.race([inflight, new Promise((r) => setTimeout(r, timeoutMs).unref?.())]);
      }
      const p = run(final ? timeoutMs : 0);
      inflight = p;
      try {
        return await p;
      } finally {
        if (inflight === p) inflight = null;
      }
    },
  };
}
