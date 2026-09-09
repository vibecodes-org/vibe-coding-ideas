// Backoff schedule for the offline page's reconnect probe (public/offline.html).
// Kept here as a pure, testable helper; the HTML inlines an equivalent copy
// since it must run entirely from the service worker cache with no imports.

export const OFFLINE_RETRY_MIN_DELAY_MS = 4000;
export const OFFLINE_RETRY_MAX_DELAY_MS = 15000;

/** Doubles the delay each call, capped at OFFLINE_RETRY_MAX_DELAY_MS. */
export function nextOfflineRetryDelay(currentDelayMs: number): number {
  const doubled = currentDelayMs * 2;
  return doubled > OFFLINE_RETRY_MAX_DELAY_MS ? OFFLINE_RETRY_MAX_DELAY_MS : doubled;
}
