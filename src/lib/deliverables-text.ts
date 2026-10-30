/** Expected-deliverables text boxes: items are separated by commas or new lines. */
export function parseDeliverablesText(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((d) => d.trim())
    .filter(Boolean);
}

export function formatDeliverablesText(list?: string[] | null): string {
  return (list ?? []).join(", ");
}
