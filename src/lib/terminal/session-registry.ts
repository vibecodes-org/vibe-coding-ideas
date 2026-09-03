// In-app terminal — pure registry decisions (multi-session stage 3).
//
// The `terminal_sessions` table (migration 00141) is a BEST-EFFORT registry —
// the relay (one Durable Object per sid) is the actual source of truth for
// whether a session is alive, and rows can drift (design doc §9, R2: "a row
// the relay reports gone renders as 'Already ended'"). Every decision that can
// be expressed as a pure function over plain data lives here, unit-tested
// without a Supabase client, so the mint/end/list routes stay thin composition
// over these + the DB calls.

/**
 * Mint sets `expires_at = created_at + 24h`, mirroring the relay's own
 * max-duration horizon (terminal/relay/src/pairing.js → DEFAULT_MAX_MS) — a
 * backstop against a session that never goes idle, not a bound on a normal
 * working day. A row can never legitimately still be "active" once this
 * passes, so the mint route's reap step (R2 mitigation) uses this to mark
 * stale rows ended WITHOUT ever having to ask the relay.
 */
export const REGISTRY_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/** The trailing window the mint rate limit (E2) counts recent mints over. */
export const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;

/**
 * `expires_at` for a freshly-minted registry row, as an ISO string ready for
 * the `terminal_sessions` insert.
 */
export function computeSessionExpiresAt(
  nowMs: number = Date.now(),
  ttlMs: number = REGISTRY_SESSION_TTL_MS,
): string {
  return new Date(nowMs + ttlMs).toISOString();
}

/** Whether a registry row's `expires_at` has passed — the reap-step predicate. */
export function isSessionExpired(expiresAt: string, nowMs: number = Date.now()): boolean {
  const t = Date.parse(expiresAt);
  if (Number.isNaN(t)) return false; // malformed timestamp — never falsely reap
  return t <= nowMs;
}

export interface ReapCandidateRow {
  id: string;
  status: "active" | "ended";
  expires_at: string;
}

export interface ReapUpdate {
  id: string;
  /** The row's TRUE death time — its own `expires_at`, never "now". */
  endedAt: string;
}

/**
 * The reap step's pure decision (R2 mitigation, card cbe60db5; rework 8:
 * tells the truth about WHEN a row died). Given a batch of the caller's own
 * rows, returns the write each still-"active"-but-expired row needs: its
 * `ended_at` backdated to ITS OWN `expires_at` — the relay's 24h backstop ceiling
 * (REGISTRY_SESSION_TTL_MS) is the moment the session actually died, not
 * whenever a caller happened to notice (Nick's field evidence, 2026-08-12: a
 * row created 19:01, expires_at 23:01, reaped 03:58 the next day previously
 * showed "ended 0m ago" instead of "ended ~5h ago"). Rows are only selected
 * when `isSessionExpired` says `expires_at` has passed, and that function
 * never reaps on a malformed timestamp — so `endedAt` here is always a
 * well-formed timestamp in the past.
 *
 * Defensively re-checks `status === "active"` per row rather than trusting
 * the caller's own `.eq("status", "active")` query filter — a row that
 * somehow reached here already ended is never re-marked or double-counted,
 * and its real `ended_at` is left alone.
 *
 * Originally inlined as an id-only batch update identically in the mint
 * route (POST /api/terminal/session) and the reattach route (rework 7
 * extracted the list route's copy into `selectExpiredSessionIds` below);
 * rework 8 unifies all three onto this richer per-row form via the shared
 * `reapExpiredSessions` write helper (session-reap.ts) so the timestamp
 * truth can't drift between call sites again.
 */
export function selectReapUpdates(rows: ReapCandidateRow[], nowMs: number = Date.now()): ReapUpdate[] {
  return rows
    .filter((row) => row.status === "active" && isSessionExpired(row.expires_at, nowMs))
    .map((row) => ({ id: row.id, endedAt: row.expires_at }));
}

/**
 * Id-only view of `selectReapUpdates`, kept for callers that only need to
 * know WHICH rows are stale, not what to backdate them to.
 */
export function selectExpiredSessionIds(rows: ReapCandidateRow[], nowMs: number = Date.now()): string[] {
  return selectReapUpdates(rows, nowMs).map((update) => update.id);
}

/** The start of the trailing rate-limit window, as an ISO string for a `.gte()` filter. */
export function rateLimitWindowStart(
  nowMs: number = Date.now(),
  windowMs: number = RATE_LIMIT_WINDOW_MS,
): string {
  return new Date(nowMs - windowMs).toISOString();
}

export type CapDecision = { ok: true } | { ok: false; active: number; cap: number };

/**
 * E1: refuse a mint once the user's remaining ACTIVE (post-reap) row count
 * meets or exceeds the cap. `activeCount` must already exclude rows this
 * request just reaped.
 */
export function decideCap(activeCount: number, cap: number): CapDecision {
  if (activeCount >= cap) return { ok: false, active: activeCount, cap };
  return { ok: true };
}

export type RateLimitDecision = { ok: true } | { ok: false; recent: number; limit: number };

/** E2: refuse a mint once the user's mints in the trailing window meet/exceed the limit. */
export function decideRateLimit(recentCount: number, limit: number): RateLimitDecision {
  if (recentCount >= limit) return { ok: false, recent: recentCount, limit };
  return { ok: true };
}

export type ReattachDecision =
  | { ok: true }
  | { ok: false; reason: "not-found" | "ended" | "expired" };

/**
 * Session entry chooser + reload-reattach (card cbe60db5): the reattach mint
 * route's OWN decision — separate from `decideCap`/`decideRateLimit` because a
 * reattach is exempt from both (F2: "no new registry row, exempt from the
 * session cap and the mint rate limit"). Ownership itself is enforced by the
 * caller's `.eq("user_id", ...)` read (RLS-scoped too) — a `row` reaching this
 * function already belongs to the caller; `null` here means "no row for this
 * sid + this user", which reads identically to "not found" whether the sid
 * never existed, belongs to someone else, or was deleted.
 */
export function decideReattach(
  row: { status: "active" | "ended"; expires_at: string } | null,
  nowMs: number = Date.now(),
): ReattachDecision {
  if (!row) return { ok: false, reason: "not-found" };
  if (row.status !== "active") return { ok: false, reason: "ended" };
  if (isSessionExpired(row.expires_at, nowMs)) return { ok: false, reason: "expired" };
  return { ok: true };
}

/**
 * Compact "age" string for the My-sessions list (design §9: "12m", "41m",
 * "2h", "3h 50m"). Minutes below 60; hours + minutes above, dropping the
 * minutes once they round to 0; a floor of "0m" for a just-created row (never
 * negative, never blank, even if the clock is slightly behind the server's).
 */
export function formatSessionAge(createdAt: string, nowMs: number = Date.now()): string {
  const created = Date.parse(createdAt);
  const totalMinutes = Number.isNaN(created) ? 0 : Math.max(0, Math.floor((nowMs - created) / 60_000));
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

/**
 * The My-sessions identity line (design §9: "machine · cwd · short sid,
 * whatever's non-null"). `machine_label` is populated best-effort once the
 * bridge announces its hostname over the relay (Nick's sign-off change 2 —
 * see use-terminal-session.ts's bridge-version handling and the PATCH route's
 * doc comment); `cwd` is set best-effort post-connect. Either can still be
 * null (an old bridge that never announces a host, or a PATCH that hasn't
 * landed yet) — the short sid is always present so a row is never a blank
 * line.
 */
export function formatSessionIdentity(input: {
  machineLabel?: string | null;
  cwd?: string | null;
  sid: string;
}): string {
  const parts: string[] = [];
  if (input.machineLabel) parts.push(input.machineLabel);
  if (input.cwd) parts.push(input.cwd);
  parts.push(input.sid.slice(0, 8));
  return parts.join(" · ");
}
