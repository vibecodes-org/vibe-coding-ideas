// Terminal dock — user-resizable body height (Nick's request 2026-08-17, card
// b885ebfd: "let Nick resize the panel height by dragging").
//
// The dock's terminal body used to be a hardcoded `h-[38vh] min-h-[220px]`.
// This module owns every PURE piece of the resizable replacement — the
// clamps, the default, the drag/keyboard arithmetic and the localStorage
// read/write — so the React side (terminal-dock.tsx) is just event wiring.
//
// Persistence is `localStorage` (NOT the per-tab `sessionStorage` that
// dock-open-persistence.ts uses): a chosen height is a lasting preference
// ("I like the terminal about this tall"), not a "this tab, as I left it"
// signal, so it should survive a new tab/window too. Same quota-safe,
// NEVER-THROW contract as that file: a failed write just means the next load
// uses the default height, never a crash or a surfaced error.
//
// The stored value is the user's PREFERRED body height in px. The EFFECTIVE
// height is that preference clamped to the current viewport at render time —
// so shrinking the window temporarily doesn't overwrite what they picked, and
// re-growing it restores their choice.

/** The `localStorage` key this module owns. */
export const DOCK_HEIGHT_KEY = "vc:term:dock-height";

/** Smallest the terminal body may get — enough for a handful of prompt lines. */
export const MIN_DOCK_HEIGHT_PX = 160;

/**
 * Viewport space the dock must ALWAYS leave for the page above it (nav +
 * board column headers), so it can never grow to swallow the whole screen.
 * The dock's own chrome (collapsed bar + tab strip + session header ≈ 110px)
 * sits ON TOP of the body, so this is deliberately generous.
 */
export const DOCK_VIEWPORT_RESERVE_PX = 220;

/** Default body height as a fraction of the viewport — matches the old `38vh`. */
export const DEFAULT_DOCK_HEIGHT_VH = 0.38;

/** Keyboard step for the resize handle (ArrowUp/ArrowDown); Shift multiplies by 4. */
export const DOCK_HEIGHT_KEY_STEP_PX = 24;

/** The largest body height the given viewport allows — never below the minimum. */
export function maxDockHeight(viewportHeight: number): number {
  return Math.max(MIN_DOCK_HEIGHT_PX, Math.floor(viewportHeight - DOCK_VIEWPORT_RESERVE_PX));
}

/** Clamp a candidate body height into `[MIN, maxDockHeight(viewport)]`, rounding to whole px. */
export function clampDockHeight(height: number, viewportHeight: number): number {
  const max = maxDockHeight(viewportHeight);
  if (!Number.isFinite(height)) return Math.min(defaultDockHeight(viewportHeight), max);
  return Math.min(max, Math.max(MIN_DOCK_HEIGHT_PX, Math.round(height)));
}

/** The height used when nothing has been chosen yet — the old 38vh, clamped. */
export function defaultDockHeight(viewportHeight: number): number {
  const target = Math.round(viewportHeight * DEFAULT_DOCK_HEIGHT_VH);
  return Math.min(maxDockHeight(viewportHeight), Math.max(MIN_DOCK_HEIGHT_PX, target));
}

/**
 * The height to actually render: the stored preference (if any) clamped to
 * the current viewport, else the default. `preferred` is `null` when nothing
 * has been chosen or storage was unavailable.
 */
export function resolveDockHeight(preferred: number | null, viewportHeight: number): number {
  if (preferred === null) return defaultDockHeight(viewportHeight);
  return clampDockHeight(preferred, viewportHeight);
}

/**
 * Body height for a drag in progress. The dock is docked to the BOTTOM of the
 * viewport and the handle sits on its TOP edge, so dragging the pointer UP
 * (smaller clientY) makes the panel TALLER. `startHeight` is the height at
 * pointerdown, `startY`/`currentY` are clientY values.
 */
export function dragDockHeight(
  startHeight: number,
  startY: number,
  currentY: number,
  viewportHeight: number,
): number {
  return clampDockHeight(startHeight + (startY - currentY), viewportHeight);
}

/** Body height after a keyboard nudge — `delta` px (positive = taller), clamped. */
export function stepDockHeight(current: number, delta: number, viewportHeight: number): number {
  return clampDockHeight(current + delta, viewportHeight);
}

/** `window.localStorage`, or `null` when unavailable (SSR, privacy mode, disabled storage) — never throws. */
function defaultStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Persist the user's preferred body height. Best-effort: a `localStorage`
 * write can throw (quota, privacy mode, disabled storage) — caught and
 * silently dropped. Non-finite or sub-minimum values are NOT written (they
 * would only ever come from a bug), so a stale-but-valid preference is never
 * replaced by garbage.
 */
export function writeDockHeight(height: number, storage: Storage | null = defaultStorage()): void {
  if (!storage) return;
  if (!Number.isFinite(height) || height < MIN_DOCK_HEIGHT_PX) return;
  try {
    storage.setItem(DOCK_HEIGHT_KEY, String(Math.round(height)));
  } catch {
    /* best-effort only — a failed write just means the next load uses the default */
  }
}

/**
 * The stored preferred body height, or `null` when nothing valid was ever
 * written (or storage is unavailable / throws). Returned UNCLAMPED — the
 * caller clamps to the live viewport via `resolveDockHeight`. Anything that
 * isn't a finite number at or above the minimum is treated as absent.
 */
export function readDockHeight(storage: Storage | null = defaultStorage()): number | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(DOCK_HEIGHT_KEY);
    if (raw === null) return null;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < MIN_DOCK_HEIGHT_PX) return null;
    return Math.round(parsed);
  } catch {
    return null;
  }
}

/** Forget the stored preference (used by the handle's double-click "reset to default"). */
export function clearDockHeight(storage: Storage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(DOCK_HEIGHT_KEY);
  } catch {
    /* best-effort only */
  }
}
