// "Is the agent busy?" for the stay-awake lock (card f4be2981). An agent that
// printed anything in the last BUSY_WINDOW_MS is busy: Claude Code and Codex
// redraw their working indicator every second while they work and go silent at
// the prompt. Agent-agnostic, needs no hooks.

export const BUSY_WINDOW_MS = 120_000;

export function isBusy(lastOutputAt, now, windowMs = BUSY_WINDOW_MS) {
  return lastOutputAt != null && now - lastOutputAt < windowMs;
}

/**
 * Tracks output times and reports only CHANGES in busy state.
 * @param {(busy: boolean) => void} onChange
 */
export function createBusyTracker(onChange, windowMs = BUSY_WINDOW_MS) {
  let lastOutputAt = null;
  let busy = false;
  function evaluate(now) {
    const next = isBusy(lastOutputAt, now, windowMs);
    if (next !== busy) {
      busy = next;
      onChange(busy);
    }
  }
  return {
    output(now) { lastOutputAt = now; evaluate(now); },
    tick(now) { evaluate(now); },
    /** Force "not busy" (session ending). */
    stop() { lastOutputAt = null; evaluate(0); },
    get busy() { return busy; },
  };
}
