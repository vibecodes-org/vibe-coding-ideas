/**
 * Which workflow attempt (run) of a card is the live one.
 *
 * One rule, shared by `get_task` and `claim_next_step` so they can never
 * disagree: the NEWEST attempt always wins, judged by the latest step
 * `created_at` in each run, whatever the step statuses. An older attempt that
 * still has pending or failed steps was abandoned (a new attempt can only start
 * once the previous one is completed or failed), so its leftovers are never live.
 *
 * Steps without a run share one group (key null). Exact ties break on the larger
 * run id so row order never changes the answer.
 */
export function pickCurrentRunKey(
  steps: ReadonlyArray<{ run_id?: string | null; created_at?: string | null }>
): string | null {
  const latest = new Map<string | null, string>();
  for (const s of steps) {
    const key = s.run_id ?? null;
    const at = s.created_at ?? "";
    const seen = latest.get(key);
    if (seen === undefined || at > seen) latest.set(key, at);
  }

  let bestKey: string | null = null;
  let bestAt: string | undefined;
  for (const [key, at] of latest) {
    const better =
      bestAt === undefined ||
      at > bestAt ||
      (at === bestAt && (key ?? "") > (bestKey ?? ""));
    if (better) {
      bestKey = key;
      bestAt = at;
    }
  }
  return bestKey;
}

// ---------------------------------------------------------------------------
// Stage 2 helpers. The SQL function `workflow_live_run_id` (migration 00199)
// must match pickCurrentRunKey above. Change both together.
// ---------------------------------------------------------------------------

interface RunStepLike {
  id: string;
  run_id?: string | null;
  created_at?: string | null;
  status: string;
  step_order?: number | null;
  position?: number | null;
}

/** Step order within one run: step_order (nulls last), then position, then id. */
export function sortRunSteps<T extends RunStepLike>(steps: ReadonlyArray<T>): T[] {
  return [...steps].sort(
    (a, b) =>
      (a.step_order ?? Number.POSITIVE_INFINITY) - (b.step_order ?? Number.POSITIVE_INFINITY) ||
      (a.position ?? 0) - (b.position ?? 0) ||
      String(a.id).localeCompare(String(b.id))
  );
}

/**
 * The first step of the card's live run that is not completed, skipped or
 * awaiting approval, or null. A failed step is returned (the workflow stops there).
 */
export function pickNextOpenStep<T extends RunStepLike>(steps: ReadonlyArray<T>): T | null {
  const liveKey = pickCurrentRunKey(steps);
  const live = steps.filter((s) => (s.run_id ?? null) === liveKey);
  return (
    sortRunSteps(live).find(
      (s) => !["completed", "skipped", "awaiting_approval"].includes(s.status)
    ) ?? null
  );
}

/**
 * Split a card's steps into the live run (sorted) and the earlier runs, newest
 * first (each sorted). Uses the same recency rule as pickCurrentRunKey.
 */
export function splitRunsByRecency<T extends RunStepLike>(
  steps: ReadonlyArray<T>
): { liveKey: string | null; live: T[]; earlier: Array<{ runKey: string | null; steps: T[] }> } {
  const groups = new Map<string | null, T[]>();
  for (const s of steps) {
    const key = s.run_id ?? null;
    const g = groups.get(key);
    if (g) g.push(s);
    else groups.set(key, [s]);
  }
  const liveKey = pickCurrentRunKey(steps);
  const latestOf = (g: T[]) => g.reduce((m, s) => ((s.created_at ?? "") > m ? (s.created_at ?? "") : m), "");
  const earlier = [...groups.entries()]
    .filter(([key]) => key !== liveKey)
    .map(([runKey, g]) => ({ runKey, steps: sortRunSteps(g), at: latestOf(g) }))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : (b.runKey ?? "") > (a.runKey ?? "") ? 1 : -1))
    .map(({ runKey, steps: s }) => ({ runKey, steps: s }));
  return { liveKey, live: sortRunSteps(groups.get(liveKey) ?? []), earlier };
}
