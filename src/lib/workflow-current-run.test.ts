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

// ---- Stage 2: shared ordering / next-open / split helpers ----
import { sortRunSteps, pickNextOpenStep, splitRunsByRecency } from "./workflow-current-run";

type S = {
  id: string;
  run_id: string | null;
  created_at: string;
  status: string;
  step_order: number | null;
  position: number | null;
};
const mk = (id: string, run: string | null, at: string, status: string, order: number | null, pos: number | null = 0): S => ({
  id, run_id: run, created_at: at, status, step_order: order, position: pos,
});

describe("sortRunSteps", () => {
  it("orders by step_order with nulls last, then position, then id", () => {
    const out = sortRunSteps([
      mk("c", NEW, "t", "pending", null),
      mk("b", NEW, "t", "pending", 2, 5),
      mk("a2", NEW, "t", "pending", 1, 9),
      mk("a1", NEW, "t", "pending", 1, 1),
      mk("a0", NEW, "t", "pending", 1, 1),
    ]);
    expect(out.map((s) => s.id)).toEqual(["a0", "a1", "a2", "b", "c"]);
  });
  it("does not mutate its input", () => {
    const input = [mk("b", NEW, "t", "pending", 2), mk("a", NEW, "t", "pending", 1)];
    sortRunSteps(input);
    expect(input[0].id).toBe("b");
  });
});

describe("pickNextOpenStep", () => {
  const T1 = "2026-10-19T10:00:00Z";
  const T2 = "2026-10-21T05:40:00Z";
  it("returns a failed step so the caller can stop", () => {
    const s = [mk("1", NEW, T2, "completed", 1), mk("2", NEW, T2, "failed", 2), mk("3", NEW, T2, "pending", 3)];
    expect(pickNextOpenStep(s)?.id).toBe("2");
  });
  it("passes over awaiting_approval", () => {
    const s = [mk("1", NEW, T2, "awaiting_approval", 1), mk("2", NEW, T2, "pending", 2)];
    expect(pickNextOpenStep(s)?.id).toBe("2");
  });
  it("returns an in-progress step", () => {
    const s = [mk("1", NEW, T2, "completed", 1), mk("2", NEW, T2, "in_progress", 2)];
    expect(pickNextOpenStep(s)?.id).toBe("2");
  });
  it("returns null when everything is done or skipped", () => {
    const s = [mk("1", NEW, T2, "completed", 1), mk("2", NEW, T2, "skipped", 2)];
    expect(pickNextOpenStep(s)).toBeNull();
  });
  it("only looks at the live run", () => {
    const s = [mk("o1", OLD, T1, "pending", 1), mk("n1", NEW, T2, "completed", 1)];
    expect(pickNextOpenStep(s)).toBeNull();
  });
});

describe("splitRunsByRecency", () => {
  it("splits two runs", () => {
    const r = splitRunsByRecency([
      mk("o1", OLD, "2026-10-19T10:00:00Z", "failed", 1),
      mk("n2", NEW, "2026-10-21T05:40:00Z", "pending", 2),
      mk("n1", NEW, "2026-10-21T05:40:00Z", "pending", 1),
    ]);
    expect(r.liveKey).toBe(NEW);
    expect(r.live.map((s) => s.id)).toEqual(["n1", "n2"]);
    expect(r.earlier).toHaveLength(1);
    expect(r.earlier[0].runKey).toBe(OLD);
  });
  it("lists three runs newest first", () => {
    const r = splitRunsByRecency([
      mk("a", "r1", "2026-10-01T00:00:00Z", "failed", 1),
      mk("c", "r3", "2026-10-03T00:00:00Z", "pending", 1),
      mk("b", "r2", "2026-10-02T00:00:00Z", "failed", 1),
    ]);
    expect(r.liveKey).toBe("r3");
    expect(r.earlier.map((e) => e.runKey)).toEqual(["r2", "r1"]);
  });
  it("handles a single run and no steps", () => {
    const one = splitRunsByRecency([mk("a", "r1", "2026-10-01T00:00:00Z", "pending", 1)]);
    expect(one.earlier).toEqual([]);
    expect(one.live).toHaveLength(1);
    const none = splitRunsByRecency([]);
    expect(none.live).toEqual([]);
    expect(none.earlier).toEqual([]);
  });
  it("ignores row order and breaks exact ties on the larger run id", () => {
    const a = mk("a", "run-a", "2026-10-01T00:00:00Z", "pending", 1);
    const b = mk("b", "run-b", "2026-10-01T00:00:00Z", "pending", 1);
    expect(splitRunsByRecency([a, b]).liveKey).toBe("run-b");
    expect(splitRunsByRecency([b, a]).liveKey).toBe("run-b");
  });
});
