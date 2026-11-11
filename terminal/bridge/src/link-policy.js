// Small pure decisions for a bridge that keeps its agent alive across relay
// link loss (card f4be2981).

/** Ticks of a 5 s timer further apart than this mean the Mac slept. */
export const WAKE_GAP_MS = 20_000;
export const WAKE_TICK_MS = 5_000;

export function isWake(prevTickAt, now, gapMs = WAKE_GAP_MS) {
  return prevTickAt != null && now - prevTickAt > gapMs;
}

/** Reconnect delay: 1s, 2s, 4s ... capped at 30s, plus up to 250ms jitter. */
export const RECONNECT_CAP_MS = 30_000;
export function reconnectDelay(attempt, rand = Math.random) {
  return Math.min(1000 * 2 ** attempt, RECONNECT_CAP_MS) + Math.floor(rand() * 250);
}

/**
 * How long to try one short reconnect, only to tell the relay the session ended
 * on purpose, when the link is down. 0 = don't try.
 */
export function endCourtesyMs(why) {
  if (typeof why !== "string") return 0;
  // "pty-exit" alone or with how it ended ("pty-exit:signal-9", card 4cd8270f).
  if (why === "pty-exit" || why.startsWith("pty-exit:") || why.startsWith("agent-stopped-early")) return 10_000;
  if (why === "SIGTERM" || why === "SIGINT") return 3_000;
  return 0;
}
