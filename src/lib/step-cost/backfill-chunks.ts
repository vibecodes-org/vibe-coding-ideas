// Splits a step cost backfill file (scripts/step-usage-backfill.mjs) into
// pieces small enough for one server action call (Next.js caps a call's body
// at 1 MB). A step's attempts always travel together: the import skips steps
// that already have a cost, so a step split across two calls would lose the
// second part.

const KIND = "vibecodes-step-usage-backfill";

export function chunkBackfillFile(fileText: string, maxChars = 600_000): string[] {
  let file: unknown;
  try {
    file = JSON.parse(fileText);
  } catch {
    throw new Error("That file isn't JSON. Choose the file scripts/step-usage-backfill.mjs wrote.");
  }
  const f = file as { kind?: unknown; version?: unknown; attempts?: unknown };
  if (f?.kind !== KIND || !Array.isArray(f.attempts)) {
    throw new Error("That isn't a step cost file from scripts/step-usage-backfill.mjs.");
  }
  const byStep = new Map<unknown, unknown[]>();
  for (const a of f.attempts) {
    const key = (a as { step_id?: unknown })?.step_id;
    byStep.set(key, [...(byStep.get(key) ?? []), a]);
  }
  const wrap = (attempts: unknown[]) => JSON.stringify({ kind: KIND, version: f.version, attempts });
  const chunks: unknown[][] = [[]];
  let size = 0;
  for (const group of byStep.values()) {
    const groupSize = group.reduce<number>((n, a) => n + JSON.stringify(a).length + 1, 0);
    if (size > 0 && size + groupSize > maxChars) {
      chunks.push([]);
      size = 0;
    }
    chunks[chunks.length - 1].push(...group);
    size += groupSize;
  }
  return chunks.filter((c) => c.length > 0).map(wrap);
}
