import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  eligiblePaneKeys,
  enterSplitAssignment,
  reconcileSplitAssignment,
  applyTabClickToSplit,
  applyDropToSplit,
  splitTabGroups,
  resolveWidthFloor,
  isMobileViewport,
  isSplitRenderable,
  readSplitViewPreference,
  writeSplitViewPreference,
  matchFocusMoveChord,
  classifyDropZone,
  resolveDragOutcome,
  paneFocusWord,
  paneAccessibleName,
  formatFocusMoveAnnouncement,
  formatSplitOnAnnouncement,
  formatSplitOffAnnouncement,
  formatWidthFloorAnnouncement,
  formatDockAnnouncement,
  formatLeaveSplitAnnouncement,
  MIN_PANE_WIDTH_PX,
  SPLIT_FALLBACK_BODY_PX,
  SPLIT_RESTORE_BODY_PX,
  MOBILE_VIEWPORT_MAX_PX,
} from "./split-view";

describe("eligiblePaneKeys", () => {
  it("excludes popped-out sessions", () => {
    expect(
      eligiblePaneKeys([
        { key: "a", poppedOut: false },
        { key: "b", poppedOut: true },
        { key: "c", poppedOut: false },
      ]),
    ).toEqual(["a", "c"]);
  });

  it("keeps ended sessions eligible — only pop-out excludes", () => {
    // "ended" isn't a field this module tracks; the point is nothing besides
    // poppedOut filters a candidate out.
    expect(eligiblePaneKeys([{ key: "a", poppedOut: false }])).toEqual(["a"]);
  });
});

describe("enterSplitAssignment", () => {
  it("left = active tab, right = most-recently-active other eligible", () => {
    const result = enterSplitAssignment("active", ["active", "b", "c"], ["c", "b", "active"]);
    expect(result).toEqual({ left: "active", right: "c" });
  });

  it("falls back to strip order when nothing is in recency", () => {
    const result = enterSplitAssignment("active", ["active", "b"], []);
    expect(result).toEqual({ left: "active", right: "b" });
  });

  it("picks a left replacement when the active key isn't eligible (e.g. popped out)", () => {
    const result = enterSplitAssignment("popped", ["a", "b"], ["b", "a"]);
    expect(result).toEqual({ left: "b", right: "a" });
  });

  it("right is null when only one eligible session exists", () => {
    expect(enterSplitAssignment("active", ["active"], [])).toEqual({ left: "active", right: null });
  });
});

describe("reconcileSplitAssignment", () => {
  it("leaves a still-valid assignment untouched", () => {
    const current = { left: "a", right: "b" };
    expect(reconcileSplitAssignment(current, ["a", "b", "c"], ["c", "b", "a"])).toEqual(current);
  });

  it("backfills a slot that's no longer eligible (popped out) from recency", () => {
    const result = reconcileSplitAssignment({ left: "a", right: "b" }, ["a", "c"], ["c", "a"]);
    expect(result).toEqual({ left: "a", right: "c" });
  });

  it("collapses to a single filled slot when only one eligible session remains", () => {
    const result = reconcileSplitAssignment({ left: "a", right: "b" }, ["a"], []);
    expect(result).toEqual({ left: "a", right: null });
  });

  it("never assigns the same key to both sides", () => {
    const result = reconcileSplitAssignment({ left: "a", right: "a" }, ["a", "b"], ["b"]);
    expect(result.left).not.toBe(result.right);
    expect(result).toEqual({ left: "a", right: "b" });
  });

  it("resumes split automatically when a 2nd eligible session reappears (AC16)", () => {
    // Right went empty (pop-out); a bring-back / new tab makes "c" eligible again.
    const afterPopout = reconcileSplitAssignment({ left: "a", right: null }, ["a"], []);
    expect(afterPopout).toEqual({ left: "a", right: null });
    const afterBringBack = reconcileSplitAssignment(afterPopout, ["a", "c"], ["c"]);
    expect(afterBringBack).toEqual({ left: "a", right: "c" });
  });
});

describe("applyTabClickToSplit", () => {
  const assignment = { left: "a", right: "b" };

  it("clicking the focused pane's own tab is a no-op", () => {
    expect(applyTabClickToSplit(assignment, "left", "a")).toEqual({ assignment, focusedSide: "left" });
  });

  it("clicking the unfocused pane's tab moves focus to it without reassigning", () => {
    expect(applyTabClickToSplit(assignment, "left", "b")).toEqual({ assignment, focusedSide: "right" });
  });

  it("a 3rd tab click replaces the UNFOCUSED pane and takes focus", () => {
    const result = applyTabClickToSplit(assignment, "left", "c");
    expect(result).toEqual({ assignment: { left: "a", right: "c" }, focusedSide: "right" });
  });

  it("never touches the currently-focused pane on a 3rd tab click", () => {
    const result = applyTabClickToSplit(assignment, "right", "c");
    expect(result).toEqual({ assignment: { left: "c", right: "b" }, focusedSide: "left" });
  });
});

describe("applyDropToSplit", () => {
  it("docks a tab from tabbed mode, seeding the other side from the fallback", () => {
    const result = applyDropToSplit({ left: null, right: null }, "right", "b", "a");
    expect(result).toEqual({ assignment: { left: "a", right: "b" }, focusedSide: "right" });
  });

  it("may replace the FOCUSED pane — the user chose the side explicitly", () => {
    const result = applyDropToSplit({ left: "a", right: "b" }, "left", "c", null);
    expect(result).toEqual({ assignment: { left: "c", right: "b" }, focusedSide: "left" });
  });

  it("never leaves the same session in both slots", () => {
    const result = applyDropToSplit({ left: "a", right: "b" }, "left", "b", null);
    expect(result.assignment.right).not.toBe("b");
    expect(result.assignment).toEqual({ left: "b", right: null });
  });
});

describe("splitTabGroups (task c108ae4a — each pane's tab above its own terminal)", () => {
  it("puts the right pane's tab alone in the right group, everything else left", () => {
    expect(splitTabGroups(["a", "b"], { left: "a", right: "b" })).toEqual({ left: ["a"], right: ["b"] });
  });

  it("keeps un-paned tabs (3rd session, popped-out) in the LEFT group, in strip order", () => {
    expect(splitTabGroups(["a", "b", "c", "d"], { left: "b", right: "d" })).toEqual({
      left: ["a", "b", "c"],
      right: ["d"],
    });
  });

  it("follows a swapped assignment — strip order does not dictate the side", () => {
    expect(splitTabGroups(["a", "b"], { left: "b", right: "a" })).toEqual({ left: ["b"], right: ["a"] });
  });
});

describe("resolveWidthFloor (hysteresis)", () => {
  it("falls back below the fallback threshold", () => {
    expect(resolveWidthFloor(SPLIT_FALLBACK_BODY_PX - 1, false)).toBe(true);
  });

  it("does not fall back at or above the fallback threshold", () => {
    expect(resolveWidthFloor(SPLIT_FALLBACK_BODY_PX, false)).toBe(false);
  });

  it("does not restore in the hysteresis band (961-980) once below", () => {
    expect(resolveWidthFloor(SPLIT_FALLBACK_BODY_PX + 5, true)).toBe(true);
  });

  it("restores at the restore threshold", () => {
    expect(resolveWidthFloor(SPLIT_RESTORE_BODY_PX, true)).toBe(false);
  });

  it("keeps the prior state for an unmeasured (0/NaN) width", () => {
    expect(resolveWidthFloor(0, true)).toBe(true);
    expect(resolveWidthFloor(NaN, false)).toBe(false);
  });

  it("two panes at the floor plus a divider matches the documented body threshold", () => {
    expect(SPLIT_FALLBACK_BODY_PX).toBeGreaterThanOrEqual(MIN_PANE_WIDTH_PX * 2);
  });
});

describe("isMobileViewport", () => {
  it("is true at and below the mobile max", () => {
    expect(isMobileViewport(MOBILE_VIEWPORT_MAX_PX)).toBe(true);
    expect(isMobileViewport(320)).toBe(true);
  });

  it("is false above the mobile max", () => {
    expect(isMobileViewport(MOBILE_VIEWPORT_MAX_PX + 1)).toBe(false);
  });

  it("is false for an invalid width rather than throwing", () => {
    expect(isMobileViewport(0)).toBe(false);
    expect(isMobileViewport(NaN)).toBe(false);
  });
});

describe("isSplitRenderable", () => {
  it("requires the preference, 2+ eligible, above the floor and non-mobile all at once", () => {
    expect(
      isSplitRenderable({ preferred: true, eligibleCount: 2, belowWidthFloor: false, mobileViewport: false }),
    ).toBe(true);
    expect(
      isSplitRenderable({ preferred: false, eligibleCount: 2, belowWidthFloor: false, mobileViewport: false }),
    ).toBe(false);
    expect(
      isSplitRenderable({ preferred: true, eligibleCount: 1, belowWidthFloor: false, mobileViewport: false }),
    ).toBe(false);
    expect(
      isSplitRenderable({ preferred: true, eligibleCount: 2, belowWidthFloor: true, mobileViewport: false }),
    ).toBe(false);
    // AC14: mobile always renders tabs, regardless of stored preference.
    expect(
      isSplitRenderable({ preferred: true, eligibleCount: 2, belowWidthFloor: false, mobileViewport: true }),
    ).toBe(false);
  });
});

describe("split-view preference persistence", () => {
  function fakeStorage(): Storage {
    const map = new Map<string, string>();
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
      clear: () => map.clear(),
      key: () => null,
      get length() {
        return map.size;
      },
    } as Storage;
  }

  it("defaults to false (tabs) when nothing was ever written", () => {
    expect(readSplitViewPreference(fakeStorage())).toBe(false);
  });

  it("round-trips true", () => {
    const storage = fakeStorage();
    writeSplitViewPreference(true, storage);
    expect(readSplitViewPreference(storage)).toBe(true);
  });

  it("writing false clears the key rather than storing a falsy marker", () => {
    const storage = fakeStorage();
    writeSplitViewPreference(true, storage);
    writeSplitViewPreference(false, storage);
    expect(readSplitViewPreference(storage)).toBe(false);
    expect(storage.getItem(SPLIT_VIEW_PREFERENCE_KEY_FOR_TEST())).toBeNull();
  });

  function SPLIT_VIEW_PREFERENCE_KEY_FOR_TEST() {
    return "vc:term:split-view";
  }

  it("never throws when storage is unavailable", () => {
    expect(() => readSplitViewPreference(null)).not.toThrow();
    expect(() => writeSplitViewPreference(true, null)).not.toThrow();
  });

  it("never throws when storage itself throws (privacy mode / quota)", () => {
    const throwing = {
      getItem: () => {
        throw new Error("nope");
      },
      setItem: () => {
        throw new Error("nope");
      },
      removeItem: () => {
        throw new Error("nope");
      },
      clear: () => {},
      key: () => null,
      length: 0,
    } as unknown as Storage;
    expect(readSplitViewPreference(throwing)).toBe(false);
    expect(() => writeSplitViewPreference(true, throwing)).not.toThrow();
  });
});

describe("matchFocusMoveChord", () => {
  const base = { key: "ArrowLeft", ctrlKey: true, shiftKey: true, altKey: false, metaKey: false };

  it("matches Ctrl+Shift+Left/Right", () => {
    expect(matchFocusMoveChord(base)).toBe("left");
    expect(matchFocusMoveChord({ ...base, key: "ArrowRight" })).toBe("right");
  });

  it("requires both Ctrl and Shift", () => {
    expect(matchFocusMoveChord({ ...base, ctrlKey: false })).toBeNull();
    expect(matchFocusMoveChord({ ...base, shiftKey: false })).toBeNull();
  });

  it("rejects Alt/Meta so it never collides with an OS chord that also holds one of those", () => {
    expect(matchFocusMoveChord({ ...base, altKey: true })).toBeNull();
    expect(matchFocusMoveChord({ ...base, metaKey: true })).toBeNull();
  });

  it("ignores unrelated keys", () => {
    expect(matchFocusMoveChord({ ...base, key: "a" })).toBeNull();
  });
});

describe("classifyDropZone", () => {
  const geometry = { stripBottom: 100, bodyLeft: 0, bodyWidth: 1000 };

  it("is 'strip' at and just below the strip's bottom edge (grace margin)", () => {
    expect(classifyDropZone({ ...geometry, pointerX: 500, pointerY: 100 })).toBe("strip");
    expect(classifyDropZone({ ...geometry, pointerX: 500, pointerY: 108 })).toBe("strip");
  });

  it("is 'left'/'right' once past the strip + grace margin, split at the body midpoint", () => {
    expect(classifyDropZone({ ...geometry, pointerX: 200, pointerY: 200 })).toBe("left");
    expect(classifyDropZone({ ...geometry, pointerX: 800, pointerY: 200 })).toBe("right");
  });

  it("is 'none' outside the body's horizontal bounds", () => {
    expect(classifyDropZone({ ...geometry, pointerX: -10, pointerY: 200 })).toBe("none");
    expect(classifyDropZone({ ...geometry, pointerX: 1200, pointerY: 200 })).toBe("none");
  });

  it("is 'none' for a zero-width body rather than dividing by zero", () => {
    expect(classifyDropZone({ ...geometry, bodyWidth: 0, pointerX: 5, pointerY: 200 })).toBe("none");
  });
});

describe("resolveDragOutcome", () => {
  it("docks left/right", () => {
    expect(resolveDragOutcome("left", false)).toEqual({ kind: "dock", side: "left" });
    expect(resolveDragOutcome("right", true)).toEqual({ kind: "dock", side: "right" });
  });

  it("cancels a release outside the dock", () => {
    expect(resolveDragOutcome("none", false)).toEqual({ kind: "cancel" });
  });

  it("cancels a strip release for a tab that wasn't paned — no reordering (Design Review required change 1)", () => {
    expect(resolveDragOutcome("strip", false)).toEqual({ kind: "cancel" });
  });

  it("a PANED tab's strip release leaves split — its designed un-split meaning survives the cut", () => {
    expect(resolveDragOutcome("strip", true)).toEqual({ kind: "leave-split" });
  });
});

describe("accessible names + announcements", () => {
  it("paneFocusWord / paneAccessibleName never say 'typing' for both panes at once", () => {
    expect(paneFocusWord(true)).toBe("Typing here");
    expect(paneFocusWord(false)).toBe("Watching");
    expect(paneAccessibleName("Fix login", true)).toBe("Fix login — typing here");
    expect(paneAccessibleName("Fix login", false)).toBe("Fix login — watching");
  });

  it("formats every announcement string the design specifies", () => {
    expect(formatFocusMoveAnnouncement("Fix login")).toBe("Typing now goes to Fix login");
    expect(formatSplitOnAnnouncement("A", "B", "A")).toBe("Split view on. A left, B right. Typing goes to A.");
    expect(formatSplitOffAnnouncement("A")).toBe("Split view off. Showing A.");
    expect(formatWidthFloorAnnouncement("fallback")).toMatch(/too narrow/);
    expect(formatWidthFloorAnnouncement("restored")).toBe("Split view restored.");
    expect(formatDockAnnouncement("A", "right")).toBe("Split view on. A docked right. Typing goes to A.");
    expect(formatLeaveSplitAnnouncement("A")).toBe("Split view off. Showing A.");
  });
});

// Keep vi/beforeEach imports meaningful even though most of this module needs
// no mocking — a couple of persistence tests build ad hoc fakes above instead.
describe("module sanity", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  it("exports the documented width-floor constants in a sane order", () => {
    expect(MIN_PANE_WIDTH_PX).toBeLessThan(SPLIT_FALLBACK_BODY_PX);
    expect(SPLIT_FALLBACK_BODY_PX).toBeLessThan(SPLIT_RESTORE_BODY_PX);
  });
});
