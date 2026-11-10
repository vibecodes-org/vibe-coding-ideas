// Rework feedback for a claim reply (card 5e654dd1, stage 3).
//
// When work is sent back, the board stores the same feedback twice: as a
// 'failure' comment on the step that complained and as a 'changes_requested'
// comment on the step it went back to. The old claim reply sent both copies
// (plus every older round) and told even a step that was never sent back that
// "this step failed before". This builds one item instead: the newest round of
// feedback in full, and a count of the older rounds (they stay on the board).
//
// Stale-feedback fix (card 5b35e0f5): a step's OWN failure comment is the
// complaint it raised, not feedback sent to it, so it comes back as
// own_last_list ("check these were fixed"), never as rework. Only a
// changes_requested comment on the step is rework for it, and only while no
// newer feedback exists elsewhere in the run (then that is background).
//
// Only failure / changes_requested COMMENTS are a source. A step's own
// `output` never is: a re-claimed step can now hold a helper's saved write-up.

export interface ReworkComment {
  content: string;
  created_at: string;
  /** The step the comment sits on. */
  step_id: string;
  type: "failure" | "changes_requested";
}

export interface ReworkInstructions {
  /** this_step: the feedback is for the step being claimed. earlier_step: it was
   *  raised elsewhere in the run and is background for this one. null: nothing
   *  to rework, only own_last_list. */
  scope: "this_step" | "earlier_step" | null;
  feedback: { from_step: string | null; content: string; created_at: string } | null;
  /** How many older, different rounds of feedback exist (they stay on the board). */
  earlier_rounds: number;
  /** The complaint this step raised itself last time: check it was fixed. Not rework. */
  own_last_list?: { content: string; created_at: string };
}

const newestFirst = (list: ReworkComment[]) =>
  [...list].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));

/**
 * `own` are the failure / changes_requested comments on the claimed step;
 * `run` the same across the whole run (may repeat own). `stepTitles` names the
 * step each comment sits on.
 */
export function buildReworkInstructions(
  own: ReworkComment[],
  run: ReworkComment[],
  stepTitles: Map<string, string>,
  stepId?: string
): ReworkInstructions | null {
  const ownLast = newestFirst(own.filter((c) => c.type === "failure"))[0];
  const ownRework = own.filter((c) => c.type === "changes_requested");
  // Everything that can count as feedback for this step: its own
  // changes_requested plus anything raised elsewhere. Its own failures never.
  const ownStepId = stepId ?? own[0]?.step_id;
  const seenRow = new Set<string>();
  const pool: ReworkComment[] = [];
  for (const c of [...ownRework, ...run]) {
    const isOwnFailure = c.type === "failure" && c.step_id === ownStepId;
    if (isOwnFailure) continue;
    const key = `${c.step_id}|${c.created_at}|${c.type}|${c.content}`;
    if (seenRow.has(key)) continue;
    seenRow.add(key);
    pool.push(c);
  }
  const ownLastList = ownLast ? { content: ownLast.content, created_at: ownLast.created_at } : undefined;

  const sorted = newestFirst(pool);
  const seen = new Set<string>();
  const unique: ReworkComment[] = [];
  for (const c of sorted) {
    const key = c.content.trim();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(c);
  }
  if (unique.length === 0) {
    return ownLastList ? { scope: null, feedback: null, earlier_rounds: 0, own_last_list: ownLastList } : null;
  }
  const newest = unique[0];
  // Sent back to this step only if the newest feedback in the run is a
  // changes_requested on this step (its failure twin elsewhere has the same text).
  const isOwn = (c: ReworkComment) => c.type === "changes_requested" && c.step_id === ownStepId;
  const scope = isOwn(newest) || ownRework.some((c) => c.content.trim() === newest.content.trim()) ? "this_step" : "earlier_step";
  const out: ReworkInstructions = {
    scope,
    feedback: {
      from_step: stepTitles.get(newest.step_id) ?? null,
      content: newest.content,
      created_at: newest.created_at,
    },
    earlier_rounds: unique.length - 1,
  };
  if (ownLastList) out.own_last_list = ownLastList;
  return out;
}
