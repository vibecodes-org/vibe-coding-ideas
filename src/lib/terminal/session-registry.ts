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
 * Mint sets `expires_at = created_at + 4h`, mirroring the relay's own
 * max-duration horizon (terminal/relay/src/pairing.js → DEFAULT_MAX_MS). A row
 * can never legitimately still be "active" once this passes, so the mint
 * route's reap step (R2 mitigation) uses this to mark stale rows ended WITHOUT
 * ever having to ask the relay.
 */
export const REGISTRY_SESSION_TTL_MS = 4 * 60 * 60 * 1000;

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
 * whatever's non-null"). `machine_label` is never actually populated today
 * (no browser API can read it — see the PATCH route's doc comment), but the
 * shape stays ready for whenever a real signal exists; `cwd` is set
 * best-effort post-connect. The short sid is always present so a row is never
 * a blank line.
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
