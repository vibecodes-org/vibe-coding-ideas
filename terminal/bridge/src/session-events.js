// Session record, Mac side (card f4be2981, stage 2).
//
// The bridge's log goes to the helper's stderr and nowhere else: the packaged
// helper keeps no log file. So the bridge's own story (the relay link
// dropping, each reconnect attempt, a close code, the agent exiting, a wake
// from sleep) is also sent to the app's session record
// (/api/terminal/session/events), straight to the app (never through the
// relay), with this session's bridge token. The app accepts an expired
// bridge token for the session's own owner, so a bridge that has been holding
// a session for hours can still report.
//
// While the network is down the events wait in memory (bounded) and go out
// once a send succeeds. Never throws, never blocks the bridge.

const MAX_QUEUED = 300;
const BATCH = 100;
const FLUSH_EVERY_MS = 5000;
const SEND_TIMEOUT_MS = 5000;
/** Log lines too chatty to keep (one per frame or per resize). */
const SKIP = /^(resized PTY|dropped stale-attach e2ee frame|ensured spawn-helper|resolved spawn PATH)/;

/**
 * "relay link dropped — will reconnect" → "bridge.relay-link-dropped-will-reconnect".
 * @param {string} msg
 * @returns {string|null}
 */
export function bridgeEventName(msg) {
  if (typeof msg !== "string" || SKIP.test(msg)) return null;
  const slug = msg
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return slug ? `bridge.${slug}` : null;
}

/** Plain values only, short strings, never anything that looks like a token. */
export function bridgeEventDetail(extra) {
  const out = {};
  for (const [k, v] of Object.entries(extra ?? {}).slice(0, 15)) {
    if (/token|key|secret|url|prompt/i.test(k)) continue;
    if (v === null || typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (typeof v === "string") out[k] = v.slice(0, 200);
  }
  return out;
}

/**
 * @param {{ appUrl: string, sid: string, token: string, fetchImpl?: typeof fetch, now?: () => number, autoFlush?: boolean }} opts
 */
export function createSessionEventLog({ appUrl, sid, token, fetchImpl = fetch, now = Date.now, autoFlush = true }) {
  /** @type {{ sid: string, event: string, at: number, detail: object }[]} */
  let queue = [];
  let sending = false;
  let timer = null;
  const endpoint = `${String(appUrl).replace(/\/+$/, "")}/api/terminal/session/events`;
  const enabled = !!(appUrl && sid && token) && !String(sid).startsWith("dev-");

  async function flush() {
    if (!enabled || sending || queue.length === 0) return;
    sending = true;
    const batch = queue.slice(0, BATCH);
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
    try {
      const res = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sid, token, events: batch }),
        signal: controller.signal,
      });
      // Delivered, or refused for good (4xx): either way don't resend it.
      if (res.ok || (res.status >= 400 && res.status < 500)) queue = queue.slice(batch.length);
    } catch {
      /* offline: keep for the next try */
    } finally {
      clearTimeout(t);
      sending = false;
    }
  }

  function schedule() {
    if (!autoFlush || timer) return;
    timer = setTimeout(() => {
      timer = null;
      void flush().then(() => {
        if (queue.length > 0) schedule();
      });
    }, FLUSH_EVERY_MS);
    timer.unref?.();
  }

  return {
    /** Note a log line. Debug lines and chatty ones are skipped. */
    record(level, msg, extra) {
      if (!enabled || level === "debug") return;
      const event = bridgeEventName(msg);
      if (!event) return;
      queue.push({ sid, event, at: now(), detail: { level, ...bridgeEventDetail(extra) } });
      // Over the limit (hours offline, retrying every 30s): keep how it started
      // and the latest, drop from the middle.
      if (queue.length > MAX_QUEUED) queue.splice(MAX_QUEUED / 2, queue.length - MAX_QUEUED);
      schedule();
    },
    /** Send what's queued now (used on shutdown, with its own time cap). */
    flush,
    /** For tests. */
    size: () => queue.length,
  };
}
