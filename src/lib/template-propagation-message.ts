/**
 * Wording for the toast shown after a template is saved (card bff94aed).
 * Pure so it can be tested. Green when everything reached the cards that use
 * the template; amber (and kept on screen) when something was kept or skipped.
 */

export interface PropagationSummary {
  runsUpdated: number;
  runsReplaced?: number;
  keptRemoved?: { taskId: string; title: string; stepTitle: string }[];
  changedWhileSaving?: { taskId: string; title: string }[];
}

export interface PropagationMessage {
  level: "success" | "warning";
  /** First line. */
  message: string;
  /** Extra lines (amber only). */
  details: string[];
}

function cardNames(titles: string[]): string {
  const unique = [...new Set(titles)];
  const shown = unique.slice(0, 3).map((t) => `"${t}"`);
  const more = unique.length - shown.length;
  return more > 0 ? `${shown.join(", ")} and ${more} more` : shown.join(", ");
}

export function describePropagation(base: string, report: PropagationSummary | null | undefined): PropagationMessage {
  const kept = report?.keptRemoved ?? [];
  const changed = report?.changedWhileSaving ?? [];
  const updated = (report?.runsUpdated ?? 0) + (report?.runsReplaced ?? 0);
  const details: string[] = [];

  if (kept.length > 0) {
    details.push(
      `Kept a removed step on ${cardNames(kept.map((k) => k.title))} because work has started on it.`
    );
  }
  if (changed.length > 0) {
    details.push(
      `Left ${cardNames(changed.map((c) => c.title))} as it was because it changed while saving. Save again to retry.`
    );
  }
  const first = updated > 0 ? `${base}. Updated ${updated} ${updated === 1 ? "card that uses" : "cards that use"} it.` : base;
  return { level: details.length > 0 ? "warning" : "success", message: first, details };
}
