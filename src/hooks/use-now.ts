import { useCallback, useSyncExternalStore } from "react";

/**
 * A live "current time" hook backed by a SINGLE module-level ticker.
 *
 * All consumers share one `setInterval`, started lazily on the first
 * subscriber and cleared when the last unsubscribes. This keeps any number of
 * mounted cards/badges on a single timer instead of one per component.
 *
 * SSR-safe: `getServerSnapshot` returns a fixed module-load seed so the server
 * and the first client render agree (no hydration mismatch). Idle consumers
 * (`enabled === false`) never subscribe and read the same stable seed, so they
 * never re-render.
 */

// Captured once at module load. Stable across SSR + first client render and
// the value idle consumers always observe.
const SEED = Date.now();

let now = SEED;
let timer: ReturnType<typeof setInterval> | null = null;
// The cadence the shared timer is currently running at; `Infinity` when idle.
let currentIntervalMs = Infinity;
// Each active subscriber's requested cadence — lets the shared ticker run at
// the finest interval any consumer needs.
const subscribers = new Map<() => void, number>();

function tick() {
  now = Date.now();
  for (const notify of subscribers.keys()) notify();
}

function recomputeTimer() {
  if (subscribers.size === 0) {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    currentIntervalMs = Infinity;
    return;
  }
  let min = Infinity;
  for (const ms of subscribers.values()) {
    if (ms < min) min = ms;
  }
  // Only (re)create the timer when the required cadence actually changes —
  // a second subscriber at the same interval must not spin up a new timer.
  if (timer !== null && min === currentIntervalMs) return;
  if (timer !== null) clearInterval(timer);
  currentIntervalMs = min;
  timer = setInterval(tick, min);
}

export function useNow(intervalMs = 60000, enabled = true): number {
  const subscribe = useCallback(
    (notify: () => void) => {
      if (!enabled) return () => {};
      subscribers.set(notify, intervalMs);
      recomputeTimer();
      return () => {
        subscribers.delete(notify);
        recomputeTimer();
      };
    },
    [intervalMs, enabled],
  );

  const getSnapshot = useCallback(() => (enabled ? now : SEED), [enabled]);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function getServerSnapshot(): number {
  return SEED;
}
