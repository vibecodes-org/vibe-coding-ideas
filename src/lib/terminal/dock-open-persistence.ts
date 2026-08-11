// Terminal dock — expanded/collapsed persistence across a same-tab refresh
// (rework 5, card cbe60db5 — Nick's field test: "fix the terminal panel
// staying open as well"). A page reload used to always reset the dock's
// chrome state to collapsed, regardless of whether the user had it open —
// silently hiding the session entry chooser / instant-continue reattach
// (entry-decision.ts) behind a closed bar until the user noticed and clicked
// it back open.
//
// `sessionStorage` is per-tab and survives a reload but not a new tab/window
// — exactly the "this tab, as I left it" signal wanted here, and the same
// storage session-snapshot.ts's `vc:term:last-sid` uses. This module mirrors
// that file's quota-safe, NEVER-THROW contract for a single boolean flag: a
// failed write just means the next reload collapses (today's pre-this-card
// behaviour), never a crash or a surfaced error.

/** The `sessionStorage` key this module owns. */
export const DOCK_OPEN_KEY = "vc:term:dock-open";

/** `window.sessionStorage`, or `null` when unavailable (SSR, privacy mode, disabled storage) — never throws. */
function defaultStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Persist the dock's current expanded/collapsed state for this tab.
 * Best-effort: a `sessionStorage` write can throw (quota, privacy mode,
 * disabled storage) — caught and silently dropped, never surfaced to the
 * user or the terminal itself. Collapsed is stored as an absent key (not
 * `"0"`) so a tab that never opened the dock reads exactly like one that
 * explicitly closed it — both are honestly "start collapsed".
 */
export function writeDockOpen(expanded: boolean, storage: Storage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    if (expanded) storage.setItem(DOCK_OPEN_KEY, "1");
    else storage.removeItem(DOCK_OPEN_KEY);
  } catch {
    /* best-effort only — a failed write just means the next reload collapses */
  }
}

/**
 * Was the dock expanded the last time this tab wrote its state? Defaults to
 * `false` — SSR-safe (matches the collapsed initial paint every other
 * install-first input in use-terminal-session.ts uses) and the honest answer
 * when storage is unavailable or throws.
 */
export function readDockOpen(storage: Storage | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(DOCK_OPEN_KEY) === "1";
  } catch {
    return false;
  }
}
