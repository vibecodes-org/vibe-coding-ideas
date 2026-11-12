import { describe, it, expect } from "vitest";
import {
  flaggedRuns,
  boardTopReason,
  buildUnmeasuredAlert,
  isDeliberateSkip,
  alertWindowStart,
  UNMEASURED_ALERT_DAYS,
  type UnmeasuredAlertRow,
} from "./unmeasured-alert";

const row = (over: Partial<UnmeasuredAlertRow> = {}): UnmeasuredAlertRow => ({
  run_id: "r1",
  kind: "unavailable",
  reason: "Session sandbox refuses to run the usage script",
  created_at: "2026-11-10T10:00:00Z",
  ...over,
});

describe("isDeliberateSkip", () => {
  it.each([
    "No helper ran: change goes straight live without review.",
    "No helper run; review skipped under the standing rule for reported bugs.",
    "No subagent was run: there was no code change to review.",
    "no subagent was spawned; step failed immediately because the plan was not approved",
    "No subagent run: asked to close this card directly",
    "  no helper ran this step",
  ])("treats %s as deliberate", (reason) => {
    expect(isDeliberateSkip({ kind: "unavailable", reason })).toBe(true);
  });
  it("does not treat the sandbox refusal or an empty reason as deliberate", () => {
    expect(isDeliberateSkip({ kind: "unavailable", reason: "Session sandbox refuses to run the usage script" })).toBe(false);
    expect(isDeliberateSkip({ kind: "unavailable", reason: null })).toBe(false);
    expect(isDeliberateSkip({ kind: "no_transcript", reason: "No helper ran" })).toBe(false);
  });
});

describe("flaggedRuns", () => {
  it("flags a run with a single qualifying record", () => {
    const f = flaggedRuns([row()]);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ runId: "r1", count: 1, otherReasons: 0 });
  });
  it("ignores deliberate skips, codex and rows with no run", () => {
    expect(
      flaggedRuns([
        row({ reason: "No helper ran: review skipped" }),
        row({ kind: "codex", reason: null }),
        row({ run_id: null }),
      ])
    ).toEqual([]);
  });
  it("counts a run's records, not other runs'", () => {
    const f = flaggedRuns([row(), row(), row({ run_id: "r2" })]);
    expect(f.map((x) => [x.runId, x.count]).sort()).toEqual([["r1", 2], ["r2", 1]]);
  });
  it("still flags a run that has both a deliberate skip and a real gap", () => {
    const f = flaggedRuns([row({ reason: "No helper ran: x" }), row()]);
    expect(f[0].count).toBe(1);
  });
  it("groups reasons by case and spacing, newest record's wording kept", () => {
    const f = flaggedRuns([
      row({ reason: "Refused  by shell", created_at: "2026-11-10T10:00:00Z" }),
      row({ reason: "refused by SHELL", created_at: "2026-11-11T10:00:00Z" }),
      row({ reason: "Other thing", created_at: "2026-11-09T10:00:00Z" }),
    ]);
    expect(f[0].topReason.reason).toBe("refused by SHELL");
    expect(f[0].topReason.count).toBe(2);
    expect(f[0].otherReasons).toBe(1);
  });
  it("breaks a tie with the most recent reason", () => {
    const f = flaggedRuns([
      row({ reason: "old", created_at: "2026-11-09T10:00:00Z" }),
      row({ reason: "new", created_at: "2026-11-11T10:00:00Z" }),
    ]);
    expect(f[0].topReason.reason).toBe("new");
  });
  it("sorts newest first", () => {
    const f = flaggedRuns([
      row({ run_id: "a", created_at: "2026-11-01T00:00:00Z" }),
      row({ run_id: "b", created_at: "2026-11-05T00:00:00Z" }),
    ]);
    expect(f.map((x) => x.runId)).toEqual(["b", "a"]);
  });
  it("falls back to the label when there is no reason", () => {
    const f = flaggedRuns([row({ kind: "no_transcript", reason: null })]);
    expect(f[0].topReason.label.text).toBe("No record of the work was found");
    expect(f[0].topReason.label.quote).toBeUndefined();
  });
  it("respects an explicit threshold", () => {
    expect(flaggedRuns([row(), row()], 3)).toEqual([]);
  });
});

describe("boardTopReason and buildUnmeasuredAlert", () => {
  const rows = [
    row({ run_id: "a", reason: "Refused" }),
    row({ run_id: "a", reason: "Refused" }),
    row({ run_id: "b", reason: "Other" }),
  ];
  it("weights by record count across runs", () => {
    expect(boardTopReason(rows, flaggedRuns(rows))?.reason).toBe("Refused");
  });
  it("builds the payload and leaves taskId null for a missing card", () => {
    const alert = buildUnmeasuredAlert(rows, new Map([["a", { taskId: "t1", title: "Card A" }]]));
    expect(alert?.topReasonQuote).toBe("Refused");
    expect(alert?.cards.map((c) => [c.taskId, c.count])).toEqual(
      expect.arrayContaining([["t1", 2], [null, 1]])
    );
  });
  it("merges two runs on one card into one entry", () => {
    const two = [
      row({ run_id: "old", reason: "Refused", created_at: "2026-11-05T10:00:00Z" }),
      row({ run_id: "old", reason: "Refused", created_at: "2026-11-05T11:00:00Z" }),
      row({ run_id: "new", reason: "Other", created_at: "2026-11-09T10:00:00Z" }),
    ];
    const card = { taskId: "t1", title: "Card A" };
    const alert = buildUnmeasuredAlert(two, new Map([["old", card], ["new", card]]));
    expect(alert?.cards).toHaveLength(1);
    expect(alert?.cards[0]).toMatchObject({
      taskId: "t1",
      count: 3,
      lastAt: "2026-11-09T10:00:00Z",
      reasonQuote: "Refused",
    });
  });
  it("merges runs on an archived card but gives no link", () => {
    const two = [row({ run_id: "x" }), row({ run_id: "y" })];
    const ref = { taskId: "t9", title: null, archived: true };
    const alert = buildUnmeasuredAlert(two, new Map([["x", ref], ["y", ref]]));
    expect(alert?.cards).toHaveLength(1);
    expect(alert?.cards[0]).toMatchObject({ taskId: null, title: null, count: 2 });
  });
  it("returns null when nothing is flagged", () => {
    expect(buildUnmeasuredAlert([], new Map())).toBeNull();
  });
});

describe("alertWindowStart", () => {
  it("looks back 14 days", () => {
    expect(UNMEASURED_ALERT_DAYS).toBe(14);
    expect(alertWindowStart(new Date("2026-11-15T00:00:00Z"))).toBe("2026-11-01T00:00:00.000Z");
  });
});
