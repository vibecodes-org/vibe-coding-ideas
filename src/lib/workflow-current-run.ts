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
