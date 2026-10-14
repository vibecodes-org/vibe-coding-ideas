import { describe, it, expect } from "vitest";
import {
  buildContinuationTasksInstruction,
  completeTasksOnly,
  mergeContinuation,
  parseContinueAfter,
} from "./generate-tasks-stream";

describe("completeTasksOnly", () => {
  it("drops the last task", () => {
    expect(completeTasksOnly([1, 2, 3])).toEqual([1, 2]);
    expect(completeTasksOnly([1])).toEqual([]);
    expect(completeTasksOnly([])).toEqual([]);
  });
});

describe("mergeContinuation", () => {
  it("drops titles that differ only in case, spacing or punctuation, and duplicates within incoming", () => {
    const base = [{ title: "Set up CI" }, { title: "Design the sign-up flow" }];
    const incoming = [
      { title: "  set UP  ci! " },
      { title: "Design the signup flow" },
      { title: "Task C" },
      { title: "task c." },
      { title: "Task D" },
    ];
    expect(mergeContinuation(base, incoming).map((t) => t.title)).toEqual([
      "Set up CI",
      "Design the sign-up flow",
      "Task C",
      "Task D",
    ]);
  });

  it("keeps base first and does not mutate it", () => {
    const base = [{ title: "A" }];
    const merged = mergeContinuation(base, [{ title: "B" }]);
    expect(merged.map((t) => t.title)).toEqual(["A", "B"]);
    expect(base).toHaveLength(1);
  });
});

describe("buildContinuationTasksInstruction", () => {
  it("includes column, labels and due date when present", () => {
    const text = buildContinuationTasksInstruction([
      { title: "Task A", columnName: "To Do", labels: ["setup", "ci"], dueDate: "2026-11-01" },
    ]);
    expect(text).toContain("- Task A [To Do] (setup, ci) due 2026-11-01");
    expect(text).toContain("Generate ONLY tasks");
  });

  it("leaves out missing pieces cleanly", () => {
    const text = buildContinuationTasksInstruction([
      { title: "Task A" },
      { title: "Task B", labels: [] },
      { title: "Task C", dueDate: "2026-11-02" },
    ]);
    expect(text).toContain("- Task A\n");
    expect(text).toContain("- Task B\n");
    expect(text).toContain("- Task C due 2026-11-02\n");
    expect(text).not.toContain("[]");
    expect(text).not.toContain("()");
  });
});

describe("parseContinueAfter", () => {
  it("treats absent, null and empty as a first run", () => {
    expect(parseContinueAfter(undefined)).toEqual({ ok: true, value: [] });
    expect(parseContinueAfter(null)).toEqual({ ok: true, value: [] });
    expect(parseContinueAfter([])).toEqual({ ok: true, value: [] });
  });

  it("rejects bad shapes", () => {
    expect(parseContinueAfter("x").ok).toBe(false);
    expect(parseContinueAfter([{}]).ok).toBe(false);
    expect(parseContinueAfter([null]).ok).toBe(false);
    expect(parseContinueAfter(Array.from({ length: 1001 }, () => ({ title: "t" }))).ok).toBe(false);
  });

  it("trims long values and caps labels", () => {
    const res = parseContinueAfter([
      {
        title: "t".repeat(300),
        columnName: "c".repeat(100),
        labels: Array.from({ length: 15 }, () => "l".repeat(100)),
      },
    ]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value[0].title).toHaveLength(200);
    expect(res.value[0].columnName).toHaveLength(60);
    expect(res.value[0].labels).toHaveLength(10);
    expect(res.value[0].labels![0]).toHaveLength(60);
  });
});
