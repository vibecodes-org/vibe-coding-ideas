import { describe, it, expect } from "vitest";
import { chunkBackfillFile } from "./backfill-chunks";

const attempt = (step: string, n: number) => ({ step_id: step, outcome: "completed", ended_at: `2026-10-15T10:0${n}:00Z`, models: [{ model: "claude-opus-5-5" }] });
const file = (attempts: object[]) => JSON.stringify({ kind: "vibecodes-step-usage-backfill", version: 1, attempts });

describe("chunkBackfillFile", () => {
  it("keeps a small file in one piece", () => {
    const text = file([attempt("a", 1), attempt("b", 2)]);
    expect(chunkBackfillFile(text)).toEqual([text]);
  });

  it("splits a big file without ever splitting one step's attempts", () => {
    const attempts = [attempt("a", 1), attempt("b", 2), attempt("a", 3), attempt("c", 4), attempt("b", 5)];
    const one = JSON.stringify(attempt("a", 1)).length + 1;
    const chunks = chunkBackfillFile(file(attempts), one * 2).map((c) => JSON.parse(c));
    for (const c of chunks) expect(c).toMatchObject({ kind: "vibecodes-step-usage-backfill", version: 1 });
    const steps = chunks.map((c) => c.attempts.map((a: { step_id: string }) => a.step_id).join(""));
    expect(steps).toEqual(["aa", "bb", "c"]);
  });

  it("rejects a file that isn't a backfill", () => {
    expect(() => chunkBackfillFile("{nope")).toThrow(/isn't JSON/);
    expect(() => chunkBackfillFile(JSON.stringify({ attempts: [] }))).toThrow(/isn't a step cost file/);
  });
});
