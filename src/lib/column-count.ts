/**
 * Text for a board column's card count. While a filter is on, show how many
 * cards match out of the column's total ("3 of 40"); otherwise just the total.
 */
export function formatColumnCount(total: number, matching?: number): string {
  if (matching === undefined) return `${total}`;
  return `${matching} of ${total}`;
}
