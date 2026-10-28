// Dates a change that affects what steps cost went live, drawn on the Token
// usage chart (card a1790638). Add a new entry in the same release that ships
// the change. Plain wording, no names of private boards or people.

export interface ChangeMarker {
  /** UK date, YYYY-MM-DD. */
  date: string;
  label: string;
}

export const CHANGE_MARKERS: ChangeMarker[] = [
  { date: "2026-10-14", label: "Board agents run as real helpers, so steps set to the cheaper model really use Sonnet" },
  { date: "2026-10-17", label: "Costs recorded automatically from here. Earlier weeks were imported from saved transcripts, so some steps have none" },
  { date: "2026-10-24", label: "Memory limit at launch, slimmer board replies, helpers save their own write-up" },
  { date: "2026-10-25", label: "Effort levels (planning and review at medium), Bug Fix runs on Sonnet first, trimmed set-up, helpers tidy up at 400k" },
  { date: "2026-10-26", label: "Leaner launches; cost split fairly between steps running side by side (changes how cost is counted, not what it costs)" },
];

/** The changes inside the chart's range, oldest first, each with its number on the chart (its place in the full list). */
export function visibleMarkers(firstDay: string, markers: ChangeMarker[] = CHANGE_MARKERS): (ChangeMarker & { number: number })[] {
  return [...markers]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((m, i) => ({ ...m, number: i + 1 }))
    .filter((m) => m.date >= firstDay);
}
