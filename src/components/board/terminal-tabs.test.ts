import { describe, it, expect } from "vitest";
import {
  tabStatusMeta,
  isLiveTabStatus,
  deriveTabLabel,
  findPristineSlot,
  decideTaskLaunch,
  summarizeSessionStatuses,
  shouldAnnounceAttention,
  formatAttentionAnnouncement,
  type DedupeCandidate,
  type PristineCandidate,
} from "./terminal-tabs";
import type { TerminalStatus } from "@/lib/terminal/connection";

describe("tabStatusMeta", () => {
  it("gives connected a quiet ok glyph with no attention flag", () => {
    const meta = tabStatusMeta("connected");
    expect(meta).toEqual({ glyph: "●", tone: "ok", ariaText: "connected", needsAttention: false });
  });

  it.each<[TerminalStatus, boolean]>([
    ["connecting", false],
    ["waiting-to-pair", false],
    ["connected", false],
    ["disconnected", true],
    ["session-ended", true],
    ["error", true],
  ])("needsAttention(%s) === %s", (status, expected) => {
    expect(tabStatusMeta(status).needsAttention).toBe(expected);
  });

  it("gives every status a distinct glyph shape (never colour alone)", () => {
    const statuses: TerminalStatus[] = [
      "idle",
      "connecting",
      "waiting-to-pair",
      "connected",
      "disconnected",
      "session-ended",
      "error",
    ];
    const glyphs = new Set(statuses.map((s) => tabStatusMeta(s).glyph));
    // connecting / waiting-to-pair intentionally share a glyph (both are
    // "still handshaking"); every other status gets its own shape.
    expect(glyphs.size).toBe(statuses.length - 1);
  });
});

describe("isLiveTabStatus", () => {
  it("treats session-ended and error as not-live", () => {
    expect(isLiveTabStatus("session-ended")).toBe(false);
    expect(isLiveTabStatus("error")).toBe(false);
  });

  it("treats every other status as live", () => {
    const live: TerminalStatus[] = ["idle", "connecting", "waiting-to-pair", "connected", "disconnected"];
    for (const s of live) expect(isLiveTabStatus(s)).toBe(true);
  });
});

describe("deriveTabLabel (B3)", () => {
  it("uses the task title when the launch was task-scoped", () => {
    expect(
      deriveTabLabel({ taskTitle: "Add pagination to the recipe list", ideaSlug: "recipe-saver", sessionId: "a3f9c2e1" })
    ).toBe("Add pagination to the recipe list");
  });

  it("trims a task title that has stray whitespace", () => {
    expect(deriveTabLabel({ taskTitle: "  Fix login  ", ideaSlug: "recipe-saver", sessionId: null })).toBe(
      "Fix login"
    );
  });

  it("falls back to `<idea slug> · <sid-short>` when board-scoped", () => {
    expect(deriveTabLabel({ taskTitle: undefined, ideaSlug: "recipe-saver", sessionId: "a3f9c2e1" })).toBe(
      "recipe-saver · a3f9"
    );
  });

  it("treats an empty/whitespace-only task title as board-scoped", () => {
    expect(deriveTabLabel({ taskTitle: "   ", ideaSlug: "recipe-saver", sessionId: "c2d8" })).toBe(
      "recipe-saver · c2d8"
    );
  });

  it("uses an ellipsis placeholder before the session id is known", () => {
    expect(deriveTabLabel({ taskTitle: undefined, ideaSlug: "recipe-saver", sessionId: null })).toBe(
      "recipe-saver · …"
    );
  });
});

describe("findPristineSlot (first-launch reuse)", () => {
  it("reuses the sole entry when it has never been launched", () => {
    const sessions: PristineCandidate[] = [{ key: "s1", launchSeq: 0 }];
    expect(findPristineSlot(sessions)).toBe("s1");
  });

  it("returns null once the sole entry has been launched at least once", () => {
    const sessions: PristineCandidate[] = [{ key: "s1", launchSeq: 1 }];
    expect(findPristineSlot(sessions)).toBeNull();
  });

  it("returns null with zero entries", () => {
    expect(findPristineSlot([])).toBeNull();
  });

  it("returns null once a second tab exists, even if one is still pristine", () => {
    const sessions: PristineCandidate[] = [
      { key: "s1", launchSeq: 0 },
      { key: "s2", launchSeq: 1 },
    ];
    expect(findPristineSlot(sessions)).toBeNull();
  });
});

describe("decideTaskLaunch (B10)", () => {
  it("always opens a new tab for a board-level launch (no task identity)", () => {
    const sessions: DedupeCandidate[] = [{ key: "s1", taskId: "task-1", status: "connected" }];
    expect(decideTaskLaunch(sessions, undefined)).toEqual({ action: "open" });
  });

  it("focuses the existing tab when the same task already has a LIVE tab", () => {
    const sessions: DedupeCandidate[] = [
      { key: "s1", taskId: "task-1", status: "connected" },
      { key: "s2", taskId: "task-2", status: "connected" },
    ];
    expect(decideTaskLaunch(sessions, "task-1")).toEqual({ action: "focus", key: "s1" });
  });

  it("opens a new tab when no existing tab matches the task id", () => {
    const sessions: DedupeCandidate[] = [{ key: "s1", taskId: "task-2", status: "connected" }];
    expect(decideTaskLaunch(sessions, "task-1")).toEqual({ action: "open" });
  });

  it("does NOT dedupe against an ended or errored tab for the same task", () => {
    const sessions: DedupeCandidate[] = [
      { key: "s1", taskId: "task-1", status: "session-ended" },
      { key: "s2", taskId: "task-1", status: "error" },
    ];
    expect(decideTaskLaunch(sessions, "task-1")).toEqual({ action: "open" });
  });

  it("matches on a mid-handshake tab too (connecting/waiting still count as live)", () => {
    const sessions: DedupeCandidate[] = [{ key: "s1", taskId: "task-1", status: "connecting" }];
    expect(decideTaskLaunch(sessions, "task-1")).toEqual({ action: "focus", key: "s1" });
  });

  it("never matches on cwd/prompt equivalence — only a real taskId is keyed on", () => {
    // Two board-level (taskId undefined) sessions must never collide with each
    // other or with a later task-scoped launch just because they'd resolve the
    // same cwd/prompt.
    const sessions: DedupeCandidate[] = [{ key: "s1", taskId: undefined, status: "connected" }];
    expect(decideTaskLaunch(sessions, "task-1")).toEqual({ action: "open" });
  });
});

describe("summarizeSessionStatuses (B5)", () => {
  it("collapses an all-healthy set to a single connected chip", () => {
    expect(summarizeSessionStatuses(["connected", "connected", "connected"])).toEqual([
      { tone: "ok", glyph: "●", count: 3, label: "3 connected" },
    ]);
  });

  it("orders chips worst-first: error, then reconnecting, then connected", () => {
    const chips = summarizeSessionStatuses(["connected", "connected", "disconnected", "error"]);
    expect(chips.map((c) => c.label)).toEqual(["1 needs attention", "1 reconnecting", "2 connected"]);
  });

  it("omits categories with zero members", () => {
    const chips = summarizeSessionStatuses(["connected", "disconnected"]);
    expect(chips).toHaveLength(2);
    expect(chips.some((c) => c.label.includes("needs attention"))).toBe(false);
  });

  it("merges connecting and waiting-to-pair into one 'connecting' chip", () => {
    const chips = summarizeSessionStatuses(["connecting", "waiting-to-pair"]);
    expect(chips).toEqual([{ tone: "info", glyph: "◌", count: 2, label: "2 connecting" }]);
  });

  it("returns an empty array for no sessions", () => {
    expect(summarizeSessionStatuses([])).toEqual([]);
  });
});

describe("shouldAnnounceAttention (a11y)", () => {
  it("does not announce the active tab's own state changes", () => {
    expect(shouldAnnounceAttention("connected", "disconnected", true)).toBe(false);
  });

  it("does not announce a first report from a just-mounted tab", () => {
    expect(shouldAnnounceAttention(undefined, "connecting", false)).toBe(false);
  });

  it("does not announce a no-op re-render (status unchanged)", () => {
    expect(shouldAnnounceAttention("connected", "connected", false)).toBe(false);
  });

  it("announces a background tab entering a needs-attention state", () => {
    expect(shouldAnnounceAttention("connected", "disconnected", false)).toBe(true);
    expect(shouldAnnounceAttention("connected", "error", false)).toBe(true);
    expect(shouldAnnounceAttention("connected", "session-ended", false)).toBe(true);
  });

  it("does not announce a background tab entering a quiet state", () => {
    expect(shouldAnnounceAttention("connecting", "connected", false)).toBe(false);
  });
});

describe("formatAttentionAnnouncement", () => {
  it("formats a quoted label + status word", () => {
    expect(formatAttentionAnnouncement("Fix login", "disconnected")).toBe(
      'Terminal "Fix login": reconnecting'
    );
  });
});
