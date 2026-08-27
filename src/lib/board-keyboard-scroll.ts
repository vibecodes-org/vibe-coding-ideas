/**
 * Keyboard-only sideways scrolling for the board.
 *
 * Left/Right arrow keys natively scroll only the nearest box around the
 * focused element that can scroll sideways. On the board that box is almost
 * never the column row — focus sits on the breadcrumb, the search box or a
 * card inside a column, none of whose containers scroll horizontally — so
 * for a keyboard-only user the keys simply do nothing (Nick, 27 Aug 2026).
 *
 * The board therefore listens at document level and scrolls the column row
 * itself, but only when the key genuinely has no other job. This module is
 * the pure decision so it can be tested without a DOM.
 */

/** One column's width plus the gap — a keypress moves exactly one column. */
export const BOARD_ARROW_SCROLL_STEP_PX = 320;

/**
 * Elements (or ancestors of the focused element) where Left/Right already
 * mean something — moving a text caret, switching a tab, walking a menu,
 * moving a slider — so the board must stay out of the way.
 */
export const ARROW_KEY_OWNER_SELECTOR = [
  "input",
  "textarea",
  "select",
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[role="tab"]',
  '[role="tablist"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="menu"]',
  '[role="menuitem"]',
  '[role="listbox"]',
  '[role="option"]',
  '[role="combobox"]',
  '[role="slider"]',
  '[role="radiogroup"]',
  ".xterm",
].join(",");

export interface ArrowKeyContext {
  key: string;
  /** Any of alt/ctrl/meta/shift held — those combos are shortcuts, not scrolling. */
  hasModifier: boolean;
  /** Focused element "owns" arrow keys (see ARROW_KEY_OWNER_SELECTOR). */
  targetOwnsArrows: boolean;
  /** A dnd-kit keyboard drag is in flight — arrows move the dragged card. */
  isDragging: boolean;
  /** The column row actually has something to scroll to. */
  canScrollSideways: boolean;
}

/** Signed scroll delta the board should apply, or 0 to leave the key alone. */
export function boardArrowScrollDelta(ctx: ArrowKeyContext): number {
  if (ctx.hasModifier || ctx.targetOwnsArrows || ctx.isDragging || !ctx.canScrollSideways) return 0;
  if (ctx.key === "ArrowRight") return BOARD_ARROW_SCROLL_STEP_PX;
  if (ctx.key === "ArrowLeft") return -BOARD_ARROW_SCROLL_STEP_PX;
  return 0;
}
