// Terminal dock — how much of the viewport bottom the dock covers (card
// 534d2049: "Terminal panel hides the bottom of every board column").
//
// The dock root is `fixed inset-x-0 bottom-0`, so it contributes ZERO height
// to the page's flex column. The board's height chain is pure
// `flex-1`/`h-full`/`max-h-full` down to the column's `overflow-y-auto`, all
// measured against the full viewport region — including the strip the dock is
// painted over. The result: a column scroller reaches
// `scrollTop === scrollHeight - clientHeight` while its last cards are still
// hidden behind the dock. They are unreachable, not merely awkward.
//
// The fix is to publish the dock's REAL occupied height as a CSS custom
// property on the document root, and have the page reserve that much space at
// the bottom. This module owns the PURE part — the variable's name and the
// measured-px → CSS-length conversion, including the clamps.
//
// Why measure rather than compute: the dock's height is the sum of a collapsed
// bar, an optional tab strip, an optional session header and the resizable
// body (`--vc-term-dock-h`, which is the BODY ONLY). Adding those up in code
// means a second source of truth that silently drifts the first time any of
// that chrome changes. A ResizeObserver on the dock root is always right — for
// collapsed, expanded, mid-drag, popped-out and every future state.

/**
 * The CSS custom property the dock publishes on `document.documentElement`
 * and the board page consumes as bottom padding.
 *
 * Distinct from `--vc-term-dock-h` (terminal-dock-resize.tsx), which is the
 * resizable BODY height and is scoped to the dock's own subtree. This one is
 * the dock's TOTAL footprint and is deliberately global — anything laid out
 * under the dock needs it, not just the dock's children.
 */
export const DOCK_INSET_CSS_VAR = "--vc-term-dock-inset";

/**
 * Viewport the board keeps even if the dock is somehow measured absurdly tall.
 * A safety net against a bad measurement blanking the page, not a layout rule:
 * the dock's own clamp (`DOCK_VIEWPORT_RESERVE_PX`, 220px) binds first in
 * every normal case, so this should never be reached.
 */
export const MIN_BOARD_VISIBLE_PX = 120;

/**
 * Turn a measured dock height into the CSS length to publish.
 *
 * Returns a `px` string so it drops straight into `padding-bottom`. Always
 * returns a usable value — a garbage measurement yields `"0px"` (board
 * unchanged, i.e. today's behaviour) rather than a broken layout.
 *
 * @param measuredHeight the dock root's rendered height in px
 * @param viewportHeight `window.innerHeight`; 0 or invalid means "unknown",
 *   in which case the measurement is trusted as-is
 */
export function resolveDockInset(measuredHeight: number, viewportHeight: number): string {
  if (!Number.isFinite(measuredHeight) || measuredHeight <= 0) return "0px";
  const capped =
    Number.isFinite(viewportHeight) && viewportHeight > 0
      ? Math.min(measuredHeight, Math.max(0, viewportHeight - MIN_BOARD_VISIBLE_PX))
      : measuredHeight;
  return `${Math.round(capped)}px`;
}
