import { describe, it, expect } from "vitest";
import {
  RECENT_WINDOW_MS,
  RECENT_MAX,
  deriveChooserSections,
  chooserHeaderCounts,
  findLiveSessionForTask,
  type ChooserRegistryRow,
} from "./chooser-data";

const NOW = Date.parse("2026-07-20T12:00:00.000Z");
const IDEA_A = "idea-a";
const IDEA_B = "idea-b";

function row(overrides: Partial<ChooserRegistryRow> & { sid: string }): ChooserRegistryRow {
  return {
    ideaId: IDEA_A,
    ideaTitle: "VibeCodes",
    taskId: null,
    taskTitle: null,
    machineLabel: null,
    cwd: null,
    createdAt: new Date(NOW - 60_000).toISOString(),
    status: "active",
    endedAt: null,
    ...overrides,
  };
}

describe("deriveChooserSections", () => {
  it("splits live rows into here vs. elsewhere by the current idea id", () => {
    const rows = [
      row({ sid: "live-here", ideaId: IDEA_A, status: "active" }),
      row({ sid: "live-elsewhere", ideaId: IDEA_B, status: "active" }),
    ];
    const sections = deriveChooserSections(rows, IDEA_A, NOW);
    expect(sections.liveHere.map((r) => r.sid)).toEqual(["live-here"]);
    expect(sections.liveElsewhere.map((r) => r.sid)).toEqual(["live-elsewhere"]);
  });

  it("includes a recently-ended row (with a recorded cwd) in Recent", () => {
    const rows = [
      row({
        sid: "ended-1",
        status: "ended",
        cwd: "~/projects/recipe-saver",
        endedAt: new Date(NOW - 2 * 60 * 60 * 1000).toISOString(),
      }),
    ];
    const sections = deriveChooserSections(rows, IDEA_A, NOW);
    expect(sections.recent).toHaveLength(1);
    expect(sections.recent[0].sid).toBe("ended-1");
    expect(sections.recent[0].cwd).toBe("~/projects/recipe-saver");
  });

  it("hides an ended row with no recorded folder — no ghost Resume (F4)", () => {
    const rows = [
      row({ sid: "no-cwd", status: "ended", cwd: null, endedAt: new Date(NOW - 60_000).toISOString() }),
      row({ sid: "blank-cwd", status: "ended", cwd: "   ", endedAt: new Date(NOW - 60_000).toISOString() }),
    ];
    expect(deriveChooserSections(rows, IDEA_A, NOW).recent).toEqual([]);
  });

  it("excludes an ended row past the 48h window, includes one just inside it", () => {
    const rows = [
      row({
        sid: "just-inside",
        status: "ended",
        cwd: "~/projects/a",
        endedAt: new Date(NOW - RECENT_WINDOW_MS + 1000).toISOString(),
      }),
      row({
        sid: "just-outside",
        status: "ended",
        cwd: "~/projects/b",
        endedAt: new Date(NOW - RECENT_WINDOW_MS - 1000).toISOString(),
      }),
    ];
    const recent = deriveChooserSections(rows, IDEA_A, NOW).recent.map((r) => r.sid);
    expect(recent).toContain("just-inside");
    expect(recent).not.toContain("just-outside");
  });

  it("dedupes recent rows one-per-cwd, keeping the most recently ended", () => {
    const rows = [
      row({
        sid: "older",
        status: "ended",
        cwd: "~/projects/dupe",
        endedAt: new Date(NOW - 3 * 60 * 60 * 1000).toISOString(),
      }),
      row({
        sid: "newer",
        status: "ended",
        cwd: "~/projects/dupe",
        endedAt: new Date(NOW - 1 * 60 * 60 * 1000).toISOString(),
      }),
    ];
    const recent = deriveChooserSections(rows, IDEA_A, NOW).recent;
    expect(recent).toHaveLength(1);
    expect(recent[0].sid).toBe("newer");
  });

  it("caps Recent at RECENT_MAX, newest first", () => {
    const rows = Array.from({ length: RECENT_MAX + 3 }, (_, i) =>
      row({
        sid: `ended-${i}`,
        status: "ended",
        cwd: `~/projects/proj-${i}`,
        endedAt: new Date(NOW - i * 60_000).toISOString(),
      }),
    );
    const recent = deriveChooserSections(rows, IDEA_A, NOW).recent;
    expect(recent).toHaveLength(RECENT_MAX);
    expect(recent[0].sid).toBe("ended-0"); // newest (smallest offset) first
  });

  it("badges the row matching lastTabSid as wasOpenInThisTab, regardless of freshness", () => {
    const rows = [row({ sid: "live-here", ideaId: IDEA_A, status: "active" })];
    const sections = deriveChooserSections(rows, IDEA_A, NOW, "live-here");
    expect(sections.liveHere[0].wasOpenInThisTab).toBe(true);
  });

  it("does not badge rows that don't match lastTabSid", () => {
    const rows = [row({ sid: "live-here", ideaId: IDEA_A, status: "active" })];
    const sections = deriveChooserSections(rows, IDEA_A, NOW, "some-other-sid");
    expect(sections.liveHere[0].wasOpenInThisTab).toBe(false);
  });
});

describe("chooserHeaderCounts", () => {
  it("counts each section", () => {
    const sections = deriveChooserSections(
      [
        row({ sid: "a", ideaId: IDEA_A, status: "active" }),
        row({ sid: "b", ideaId: IDEA_B, status: "active" }),
        row({ sid: "c", status: "ended", cwd: "~/x", endedAt: new Date(NOW - 60_000).toISOString() }),
      ],
      IDEA_A,
      NOW,
    );
    expect(chooserHeaderCounts(sections)).toEqual({ here: 1, elsewhere: 1, recent: 1 });
  });
});

describe("findLiveSessionForTask", () => {
  it("returns null for a board-level launch (no taskId)", () => {
    const sections = deriveChooserSections([], IDEA_A, NOW);
    expect(findLiveSessionForTask(sections, undefined)).toBeNull();
    expect(findLiveSessionForTask(sections, null)).toBeNull();
  });

  it("finds a live 'here' row over an 'elsewhere' one for the same task", () => {
    const rows = [
      row({ sid: "here", ideaId: IDEA_A, status: "active", taskId: "task-1" }),
      row({ sid: "elsewhere", ideaId: IDEA_B, status: "active", taskId: "task-1" }),
    ];
    const sections = deriveChooserSections(rows, IDEA_A, NOW);
    expect(findLiveSessionForTask(sections, "task-1")?.sid).toBe("here");
  });

  it("falls back to an elsewhere row when there is no here match", () => {
    const rows = [row({ sid: "elsewhere", ideaId: IDEA_B, status: "active", taskId: "task-1" })];
    const sections = deriveChooserSections(rows, IDEA_A, NOW);
    expect(findLiveSessionForTask(sections, "task-1")?.sid).toBe("elsewhere");
  });

  it("returns null when no live row matches the task", () => {
    const rows = [row({ sid: "other-task", ideaId: IDEA_A, status: "active", taskId: "task-2" })];
    const sections = deriveChooserSections(rows, IDEA_A, NOW);
    expect(findLiveSessionForTask(sections, "task-1")).toBeNull();
  });
});
