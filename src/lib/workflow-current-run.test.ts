import { describe, it, expect } from "vitest";
import { pickCurrentRunKey } from "./workflow-current-run";

const OLD = "run-old";
const NEW = "run-new";

// Abandoned attempt: step 2 failed, steps 3 and 4 left pending at the SAME step
// numbers as the live attempt's steps.
const oldSteps = [
  { run_id: OLD, created_at: "2026-10-19T10:00:00Z" },
  { run_id: OLD, created_at: "2026-10-19T10:00:00Z" },
  { run_id: OLD, created_at: "2026-10-19T10:00:00Z" },
  { run_id: OLD, created_at: "2026-10-19T10:00:00Z" },
];
const newSteps = [
  { run_id: NEW, created_at: "2026-10-21T05:40:00Z" },
  { run_id: NEW, created_at: "2026-10-21T05:40:00Z" },
  { run_id: NEW, created_at: "2026-10-21T05:40:00Z" },
  { run_id: NEW, created_at: "2026-10-21T05:40:00Z" },
];

describe("pickCurrentRunKey", () => {
  it("picks the newest attempt whatever the row order", () => {
    expect(pickCurrentRunKey([...oldSteps, ...newSteps])).toBe(NEW);
    expect(pickCurrentRunKey([...newSteps, ...oldSteps])).toBe(NEW);
    expect(pickCurrentRunKey([newSteps[0], oldSteps[0], newSteps[1], oldSteps[1]])).toBe(NEW);
  });

  it("keeps the newer attempt even when it is fully finished and the older one has leftovers", () => {
    // Statuses are not an input: the older attempt's unfinished steps never win.
    expect(pickCurrentRunKey([...oldSteps, ...newSteps])).toBe(NEW);
  });

  it("returns the only attempt", () => {
    expect(pickCurrentRunKey(newSteps)).toBe(NEW);
  });

  it("returns null with no steps", () => {
    expect(pickCurrentRunKey([])).toBeNull();
  });

  it("treats steps without a run as one group", () => {
    const loose = [{ run_id: null, created_at: "2026-10-22T00:00:00Z" }];
    expect(pickCurrentRunKey([...oldSteps, ...loose])).toBeNull();
    expect(pickCurrentRunKey([...loose, ...newSteps])).toBeNull();
    expect(pickCurrentRunKey([...newSteps, { run_id: null, created_at: "2026-10-01T00:00:00Z" }])).toBe(NEW);
  });

  it("breaks an exact tie the same way regardless of row order", () => {
    const a = [{ run_id: "aaa", created_at: "2026-10-21T05:40:00Z" }];
    const b = [{ run_id: "bbb", created_at: "2026-10-21T05:40:00Z" }];
    expect(pickCurrentRunKey([...a, ...b])).toBe(pickCurrentRunKey([...b, ...a]));
  });
});
