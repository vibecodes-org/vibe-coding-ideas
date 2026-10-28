// Card 1117ac6b stage 2: plain-English labels and grouping for "this step's
// cost couldn't be measured" records (table workflow_step_unmeasured).

export type UnmeasuredKind = "unavailable" | "no_transcript" | "unreadable" | "codex";

export interface UnmeasuredLabel {
  text: string;
  /** The session's own words, shown quoted after the text (only for `unavailable`). */
  quote?: string;
}

const clean = (reason: string | null | undefined) => (reason ?? "").trim().replace(/\s+/g, " ");

/** The one-line explanation shown on the Token usage page. */
export function unmeasuredLabel(kind: UnmeasuredKind, reason: string | null): UnmeasuredLabel {
  const r = clean(reason);
  switch (kind) {
    case "no_transcript":
      if (r.toLowerCase() === "no-script") return { text: "The measuring tool isn't installed on that machine" };
      return { text: r ? "No record of the helper's work was found" : "No record of the work was found" };
    case "unavailable":
      return r
        ? { text: "The session couldn't run the measuring command:", quote: r }
        : { text: "The session couldn't run the measuring command" };
    case "unreadable":
      return { text: "The cost report it sent couldn't be read" };
    case "codex":
      return { text: "Codex step: Codex doesn't report its cost" };
  }
}

/**
 * Records that read as the same reason share a key: the same words with
 * different capitals or spacing are one line, and every NO_TRANSCRIPT agent id
 * counts as one reason ("other").
 */
export function unmeasuredGroupKey(kind: UnmeasuredKind, reason: string | null): string {
  const r = clean(reason).toLowerCase();
  switch (kind) {
    case "unavailable":
      return `unavailable:${r}`;
    case "no_transcript":
      return `no_transcript:${r === "no-script" ? "no-script" : r ? "other" : ""}`;
    default:
      return kind;
  }
}
