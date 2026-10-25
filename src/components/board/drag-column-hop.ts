/**
 * Guard against a drag "echo" between two columns.
 *
 * Dragging a card from a long column to a shorter one removes a card from the
 * long column, so the page gets shorter and the browser nudges the scroll
 * position. That moves every column under the (stationary) pointer, so the
 * collision check now reports the column we just left, which moves the card
 * back, which makes the page tall again, and so on. Every step is a state
 * update inside the previous one, so React gives up after ~50 of them
 * ("Maximum update depth exceeded", minified error #185).
 *
 * A real hop back always involves the pointer moving. If the pointer has not
 * moved since the hop we are about to reverse, it is the layout talking, not
 * the user, so the reversal is ignored.
 */
export interface ColumnHop {
  fromColumnId: string;
  toColumnId: string;
  /** Pointer travel since the drag started, at the moment of the hop. */
  pointerX: number;
  pointerY: number;
}

export function isLayoutEchoHop(
  lastHop: ColumnHop | null,
  overColumnId: string,
  pointerX: number,
  pointerY: number
): boolean {
  if (!lastHop) return false;
  return (
    overColumnId === lastHop.fromColumnId &&
    pointerX === lastHop.pointerX &&
    pointerY === lastHop.pointerY
  );
}
