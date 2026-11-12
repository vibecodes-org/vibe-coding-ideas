// Browser side of the session record (card f4be2981, stage 2).
//
// `recordSessionEvent(sid, event, detail)` notes what the terminal did and
// why, and sends it to /api/terminal/session/events in small batches. The
// whole point is the moments when the network is DOWN (a Wi-Fi switch, a
// closed lid), so the queue is kept in localStorage and sent once the browser
// is back online, or on the next page load. Never throws, never blocks.
//
// Every event also carries: which page load it came from (`tab`), whether the
// browser thought it was online, and whether the tab was visible.

const STORAGE_KEY = "vc-terminal-session-events";
const MAX_QUEUED = 500;
const BATCH = 100;
const FLUSH_DELAY_MS = 3000;
const ENDPOINT = "/api/terminal/session/events";

interface QueuedEvent {
  sid: string;
  event: string;
  at: number;
  detail: Record<string, unknown>;
}

const pageLoadId = Math.random().toString(36).slice(2, 8);
let memoryQueue: QueuedEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;
let listenersAdded = false;

// Another tab may add to the shared queue while a batch is in flight, so a
// sent batch is removed by key, never by position.
function eventKey(e: QueuedEvent): string {
  return `${e.sid}|${e.event}|${e.at}|${String(e.detail?.tab ?? "")}`;
}

function readQueue(): QueuedEvent[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as QueuedEvent[]) : [];
  } catch {
    return memoryQueue;
  }
}

function writeQueue(queue: QueuedEvent[]) {
  const trimmed = queue.length > MAX_QUEUED ? queue.slice(queue.length - MAX_QUEUED) : queue;
  memoryQueue = trimmed;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    /* storage blocked or full: the in-memory copy still goes out */
  }
}

async function flush() {
  if (flushing || typeof window === "undefined") return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  const queue = readQueue();
  if (queue.length === 0) return;
  flushing = true;
  const batch = queue.slice(0, BATCH);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: batch }),
      keepalive: true,
    });
    // Sent (or refused for good, e.g. signed out): drop what we sent. A server
    // error or no network keeps it for the next try.
    if (res.ok || (res.status >= 400 && res.status < 500)) {
      const sent = new Set(batch.map(eventKey));
      writeQueue(readQueue().filter((e) => !sent.has(eventKey(e))));
      if (readQueue().length > 0) scheduleFlush(500);
    }
  } catch {
    /* offline or blocked: kept for later */
  } finally {
    flushing = false;
  }
}

function flushWithBeacon() {
  try {
    const queue = readQueue();
    if (queue.length === 0 || typeof navigator === "undefined" || !navigator.sendBeacon) return;
    const batch = queue.slice(0, BATCH);
    if (navigator.sendBeacon(ENDPOINT, JSON.stringify({ events: batch }))) {
      const sent = new Set(batch.map(eventKey));
      writeQueue(readQueue().filter((e) => !sent.has(eventKey(e))));
    }
  } catch {
    /* best effort */
  }
}

function scheduleFlush(delay = FLUSH_DELAY_MS) {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, delay);
}

function addListeners() {
  if (listenersAdded || typeof window === "undefined") return;
  listenersAdded = true;
  window.addEventListener("online", () => {
    recordSessionEvent("-", "browser.online");
    scheduleFlush(1000);
  });
  window.addEventListener("offline", () => recordSessionEvent("-", "browser.offline"));
  window.addEventListener("pagehide", flushWithBeacon);
  document.addEventListener("visibilitychange", () => {
    recordSessionEvent("-", document.visibilityState === "visible" ? "tab.visible" : "tab.hidden");
    if (document.visibilityState === "hidden") flushWithBeacon();
  });
  // Anything left from an earlier page load goes out now.
  scheduleFlush(2000);
}

/**
 * Note something that happened to a terminal session. `sid` is the session
 * id, or "-" when it isn't about one session. Keep `detail` small and plain.
 */
export function recordSessionEvent(sid: string | null | undefined, event: string, detail: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  try {
    addListeners();
    const queue = readQueue();
    queue.push({
      sid: sid || "-",
      event,
      at: Date.now(),
      detail: {
        ...detail,
        tab: pageLoadId,
        online: typeof navigator !== "undefined" ? navigator.onLine : null,
        vis: typeof document !== "undefined" ? document.visibilityState : null,
      },
    });
    writeQueue(queue);
    scheduleFlush();
  } catch {
    /* never let the record break the terminal */
  }
}
