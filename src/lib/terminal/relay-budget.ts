// In-app terminal — account-wide Cloudflare relay Durable Object budget guard
// (zero-cost circuit breaker; incident: "Cloudflare Durable Objects daily
// limit exceeded"). Free-tier caps are 100k DO requests/day + 100k SQLite
// rows-written/day, ACCOUNT-WIDE — not per-user. The existing per-user cap
// (session-cap.ts) bounds one user's CONCURRENT sessions; it does nothing to
// stop the whole account's daily traffic from tripping Cloudflare's cap when
// many users are active the same day.
//
// There is no Cloudflare API call here — that would burn its own request/rate
// budget and cost money. This is a conservative, honest ESTIMATE built
// entirely from data already recorded in `terminal_sessions` (see
// src/types/database.ts). The chosen estimator is deliberately the simplest
// one that's still useful:
//
//   estimated spend = (sessions started today, account-wide)
//                     x (an assumed, conservative DO-request cost per session)
//
// This intentionally does NOT try to model relay internals (message counts,
// activity-throttle savings from terminal/relay/src/activity-throttle.js,
// bridge output-batching savings from terminal/bridge/src/output-batcher.js,
// hibernation wake patterns, etc). "Conservative" means the constant should
// be generous enough that this trips BEFORE the real free-tier cap is hit,
// not that it precisely predicts Cloudflare's bill. Tune
// TERMINAL_ASSUMED_REQUESTS_PER_SESSION down once real observed usage data
// exists (none is instrumented for the relay today).
//
// "Today" = the current UTC calendar day — matches Cloudflare's own daily
// reset window and the breaker's user-facing "available after midnight UTC"
// copy (see session-cap.ts's DAILY_RELAY_BUDGET_MESSAGE).

/** Fallback when TERMINAL_DAILY_BUDGET is unset/invalid — the documented
 *  free-tier request cap (100k Durable Object requests/day). */
export const DEFAULT_TERMINAL_DAILY_BUDGET = 100_000;

/** Fallback soft-limit fraction of the daily budget that trips the breaker —
 *  deliberately BEFORE the hard cap, leaving headroom for sessions already
 *  running (which are never touched by this gate) to keep working. Raised from
 *  0.8 -> 0.95 (release-gate feedback): 0.8 tripped the breaker too eagerly
 *  against the deliberately-conservative estimator (see module doc — the
 *  per-session cost assumption already over-counts), so 20% of the daily
 *  budget was going unused as headroom nobody needed. 0.95 keeps a small
 *  margin before the hard cap while letting far more real traffic through. */
export const DEFAULT_TERMINAL_BUDGET_SOFT_PCT = 0.95;

/** Fallback conservative per-session DO-request cost assumption. A round,
 *  deliberately generous number so the estimator over- rather than
 *  under-counts (see module doc above). */
export const DEFAULT_ASSUMED_REQUESTS_PER_SESSION = 500;

/**
 * Parse an env var into a positive integer, falling back for anything unset,
 * non-numeric, non-integer, or not positive — mirrors session-cap.ts's
 * parsePositiveIntEnv (kept local/small rather than shared to avoid coupling
 * two independently-tunable env surfaces to one helper).
 */
function parsePositiveIntEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return fallback;
  const n = Number.parseInt(trimmed, 10);
  return n > 0 ? n : fallback;
}

/** Parse a `0 < x <= 1` fraction env var, falling back for anything unset or out of range. */
function parseFractionEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  if (trimmed === "") return fallback;
  const n = Number.parseFloat(trimmed);
  if (!Number.isFinite(n) || n <= 0 || n > 1) return fallback;
  return n;
}

/** The account-wide daily DO-request budget (env: `TERMINAL_DAILY_BUDGET`). */
export function getTerminalDailyBudget(
  raw: string | undefined = process.env.TERMINAL_DAILY_BUDGET,
): number {
  return parsePositiveIntEnv(raw, DEFAULT_TERMINAL_DAILY_BUDGET);
}

/** The soft-limit fraction of the budget that trips the breaker (env: `TERMINAL_BUDGET_SOFT_PCT`). */
export function getTerminalBudgetSoftPct(
  raw: string | undefined = process.env.TERMINAL_BUDGET_SOFT_PCT,
): number {
  return parseFractionEnv(raw, DEFAULT_TERMINAL_BUDGET_SOFT_PCT);
}

/** The assumed DO-request cost of one session (env: `TERMINAL_ASSUMED_REQUESTS_PER_SESSION`). */
export function getAssumedRequestsPerSession(
  raw: string | undefined = process.env.TERMINAL_ASSUMED_REQUESTS_PER_SESSION,
): number {
  return parsePositiveIntEnv(raw, DEFAULT_ASSUMED_REQUESTS_PER_SESSION);
}

/**
 * The estimator itself: sessions started today (account-wide, from a
 * `terminal_sessions` count with no `user_id` filter) times the assumed
 * per-session cost. A negative count (should never happen) floors at 0
 * rather than producing a negative "spend".
 */
export function estimateDailyRelayRequestSpend(
  sessionsStartedToday: number,
  requestsPerSession: number,
): number {
  return Math.max(0, sessionsStartedToday) * requestsPerSession;
}

export type RelayBudgetDecision =
  | { ok: true }
  | { ok: false; estimatedSpend: number; dailyBudget: number; softLimit: number };

/**
 * Trips once the estimated spend MEETS OR EXCEEDS the soft limit
 * (`dailyBudget * softPct`) — deliberately short of the hard cap so there's
 * headroom left for sessions that are already running (this gate only ever
 * blocks NEW mints; see route.ts).
 */
export function decideRelayBudget(
  estimatedSpend: number,
  dailyBudget: number,
  softPct: number,
): RelayBudgetDecision {
  const softLimit = dailyBudget * softPct;
  if (estimatedSpend >= softLimit) return { ok: false, estimatedSpend, dailyBudget, softLimit };
  return { ok: true };
}

/**
 * Start of the current UTC calendar day, as an ISO string ready for a
 * `.gte("created_at", ...)` filter — matches Cloudflare's own daily reset
 * window (midnight UTC) and the breaker's "available after midnight UTC"
 * user-facing copy.
 */
export function utcDayStart(nowMs: number = Date.now()): string {
  const d = new Date(nowMs);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}
