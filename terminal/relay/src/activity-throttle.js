// Pure decision logic for the relay's activity-persist throttle (Cloudflare
// free-tier budget guard — see MITIGATION 1 in the daily-limit incident).
//
// Every forwarded message used to unconditionally write `lastActivityAt` +
// re-arm the idle/max alarm (storage.put + 3x storage.get + setAlarm — ~5 DO
// ops per message). At chat-speed traffic that burns through the 100k
// requests/day + 100k rows-written/day free caps fast. This throttles the
// PERSISTED write to at most once per `throttleMs` (default 5s); the idle
// alarm only needs second-scale precision, not per-keystroke precision.
//
// Kept pure + extracted (no Durable Object) so it's unit-testable with plain
// node:test — the DO glue (index.js) just calls this and, when it returns
// true, does the real storage.put + armAlarm and updates its own
// last-persisted cache.

/** Default throttle window between PERSISTED activity writes. */
export const DEFAULT_ACTIVITY_PERSIST_THROTTLE_MS = 5000;

/**
 * @param {number} now - current time (ms since epoch)
 * @param {number|null|undefined} lastPersistedAt - the last time activity was
 *   actually WRITTEN to durable storage (an instance-cached value; `null`
 *   means "never written this wake cycle", which always persists).
 * @param {number} [throttleMs]
 * @returns {boolean} true when the caller should persist + re-arm now.
 */
export function shouldPersistActivity(now, lastPersistedAt, throttleMs = DEFAULT_ACTIVITY_PERSIST_THROTTLE_MS) {
  if (lastPersistedAt == null) return true;
  return now - lastPersistedAt >= throttleMs;
}
