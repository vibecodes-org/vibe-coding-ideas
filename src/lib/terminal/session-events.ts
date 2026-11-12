// Session diagnostics (card f4be2981, stage 2): the shape every part of the
// terminal chain uses to report what happened to a session, and the checks
// /api/terminal/session/events runs before saving anything.
//
// Pure: no I/O. The route does auth and the write; the browser queue
// (session-events-client.ts), the relay and the bridge only build events.

export type SessionEventSource = "browser" | "relay" | "bridge" | "server";

export interface SessionEventInput {
  sid: string;
  event: string;
  /** When it happened, by the sender's clock: ms since epoch or an ISO string. */
  at: number | string;
  detail?: Record<string, unknown>;
}

export interface CleanSessionEvent {
  sid: string;
  event: string;
  at: string;
  detail: Record<string, unknown>;
}

/** Most events one request may carry; a long offline queue arrives in several. */
export const MAX_EVENTS_PER_REQUEST = 100;
/** Largest detail object kept, as JSON text. Bigger ones are cut down, never refused. */
export const MAX_DETAIL_CHARS = 2000;
/** Events dated further back than this are dropped (a queue left for weeks). */
export const MAX_EVENT_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** How far ahead of the server's clock an event may be dated (clock skew). */
export const MAX_FUTURE_SKEW_MS = 10 * 60 * 1000;

const EVENT_NAME = /^[a-z][a-z0-9_.-]{0,63}$/;
const SID = /^[A-Za-z0-9_-]{1,128}$/;

/** Keeps a detail object small and plain: strings cut to 300 chars, nothing nested deeper than one level. */
export function cleanDetail(detail: unknown): Record<string, unknown> {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(detail as Record<string, unknown>).slice(0, 30)) {
    const k = key.slice(0, 40);
    if (value === null || typeof value === "boolean") out[k] = value;
    else if (typeof value === "number") out[k] = Number.isFinite(value) ? value : null;
    else if (typeof value === "string") out[k] = value.slice(0, 300);
    else if (Array.isArray(value)) out[k] = value.slice(0, 10).map((v) => (typeof v === "string" ? v.slice(0, 100) : typeof v === "number" || typeof v === "boolean" ? v : null));
    else out[k] = "[object]";
  }
  if (JSON.stringify(out).length > MAX_DETAIL_CHARS) return { truncated: true };
  return out;
}

/**
 * Checks and tidies a batch. Bad entries are dropped one by one, never the
 * whole batch: a single odd event must not lose the evidence around it.
 */
export function cleanSessionEvents(raw: unknown, nowMs: number): CleanSessionEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: CleanSessionEvent[] = [];
  for (const item of raw.slice(0, MAX_EVENTS_PER_REQUEST)) {
    if (!item || typeof item !== "object") continue;
    const e = item as Partial<SessionEventInput>;
    if (typeof e.sid !== "string" || !SID.test(e.sid)) continue;
    if (typeof e.event !== "string" || !EVENT_NAME.test(e.event)) continue;
    const atMs = typeof e.at === "number" ? e.at : typeof e.at === "string" ? Date.parse(e.at) : NaN;
    if (!Number.isFinite(atMs)) continue;
    if (atMs < nowMs - MAX_EVENT_AGE_MS || atMs > nowMs + MAX_FUTURE_SKEW_MS) continue;
    out.push({ sid: e.sid, event: e.event, at: new Date(atMs).toISOString(), detail: cleanDetail(e.detail) });
  }
  return out;
}
