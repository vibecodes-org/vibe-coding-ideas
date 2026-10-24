// Rework feedback for a claim reply (card 5e654dd1, stage 3).
//
// When work is sent back, the board stores the same feedback twice: as a
// 'failure' comment on the step that complained and as a 'changes_requested'
// comment on the step it went back to. The old claim reply sent both copies
// (plus every older round) and told even a step that was never sent back that
// "this step failed before". This builds one item instead: the newest round of
// feedback in full, and a count of the older rounds (they stay on the board).
//
// Only failure / changes_requested COMMENTS are a source. A step's own
// `output` never is: a re-claimed step can now hold a helper's saved write-up.

export interface ReworkComment {
  content: string;
  created_at: string;
  /** The step the comment sits on. */
  step_id: string;
}

export interface ReworkInstructions {
  /** this_step: the feedback is for the step being claimed. earlier_step: it was
   *  raised elsewhere in the run and is background for this one. */
  scope: "this_step" | "earlier_step";
  feedback: { from_step: string | null; content: string; created_at: string };
  /** How many older, different rounds of feedback exist (they stay on the board). */
  earlier_rounds: number;
}

/**
 * `own` are the failure / changes_requested comments on the claimed step;
 * `run` the same across the whole run (used only when the step has none of its
 * own). `stepTitles` names the step each comment sits on.
 */
export function buildReworkInstructions(
  own: ReworkComment[],
  run: ReworkComment[],
  stepTitles: Map<string, string>
): ReworkInstructions | null {
  const scope = own.length > 0 ? "this_step" : "earlier_step";
  const source = scope === "this_step" ? own : run;
  if (source.length === 0) return null;

  const newestFirst = [...source].sort((a, b) =>
    a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0
  );
  const seen = new Set<string>();
  const unique: ReworkComment[] = [];
  for (const c of newestFirst) {
    const key = c.content.trim();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(c);
  }
  const newest = unique[0];
  return {
    scope,
    feedback: {
      from_step: stepTitles.get(newest.step_id) ?? null,
      content: newest.content,
      created_at: newest.created_at,
    },
    earlier_rounds: unique.length - 1,
  };
}
