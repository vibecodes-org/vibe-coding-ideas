import { describe, it, expect } from "vitest";
import { decideEntryBehaviour, type EntryRegistryRow } from "./entry-decision";
import { SNAPSHOT_FRESHNESS_MS } from "./session-snapshot";
import { RECENT_WINDOW_MS } from "./chooser-data";

const NOW = Date.parse("2026-07-20T12:00:00.000Z");

function row(overrides: Partial<EntryRegistryRow> & { sid: string }): EntryRegistryRow {
  return { status: "active", cwd: null, endedAt: null, ...overrides };
}

describe("decideEntryBehaviour", () => {
  it("empty-launch when there is nothing live or recent anywhere", () => {
    expect(decideEntryBehaviour([], [], NOW)).toEqual({ kind: "empty-launch" });
  });

  it("chooser when a live session exists, with no snapshot", () => {
    const rows = [row({ sid: "live-1", status: "active" })];
    expect(decideEntryBehaviour(rows, [], NOW)).toEqual({ kind: "chooser" });
  });

  it("chooser when only a recent (≤48h, recorded-folder) ended session exists", () => {
    const rows = [row({ sid: "ended-1", status: "ended", cwd: "~/projects/a", endedAt: new Date(NOW - 60_000).toISOString() })];
    expect(decideEntryBehaviour(rows, [], NOW)).toEqual({ kind: "chooser" });
  });

  // Bug 9fb9fced (2026-08-17): this used to assert "empty-launch" — a
  // null-cwd ended row was treated as neither live nor recent, so the dock
  // silently minted a brand-new session instead of showing the chooser (or
  // the session-ended screen) for a session that had, in fact, just ended.
  // `cwd` is no longer part of `isRecentEnded`'s predicate; see
  // chooser-data.ts's matching fix for how the row renders once "chooser" is
  // reached (visible, but with Resume unavailable).
  //
  // Card cbe60db5 follow-up (2026-08-17): terminal-session-chooser.tsx now
  // additionally hides no-folder rows from its human-visible Recent list
  // (via chooser-data.ts's `visibleRecentRows` — a display-only filter, see
  // its doc comment). This function is intentionally untouched by that
  // change — it never imports `visibleRecentRows` or `ChooserSections`, only
  // raw registry rows — so this test doubles as the regression guard that
  // the 9fb9fced fix above still holds: a no-folder-only recent set must
  // still route to "chooser", never silently fall through to
  // "empty-launch" and mint a brand-new session.
  it("chooser (not empty-launch) when the only ended row has no recorded folder", () => {
    const rows = [row({ sid: "ended-1", status: "ended", cwd: null, endedAt: new Date(NOW - 60_000).toISOString() })];
    expect(decideEntryBehaviour(rows, [], NOW)).toEqual({ kind: "chooser" });
  });

  it("empty-launch when a null-cwd ended row is past the 48h window (the 48h rule itself is untouched by the null-cwd fix)", () => {
    const rows = [
      row({
        sid: "ended-1",
        status: "ended",
        cwd: null,
        endedAt: new Date(NOW - RECENT_WINDOW_MS - 1000).toISOString(),
      }),
    ];
    expect(decideEntryBehaviour(rows, [], NOW)).toEqual({ kind: "empty-launch" });
  });

  it("empty-launch when the only ended row is past the 48h window", () => {
    const rows = [
      row({
        sid: "ended-1",
        status: "ended",
        cwd: "~/projects/a",
        endedAt: new Date(NOW - RECENT_WINDOW_MS - 1000).toISOString(),
      }),
    ];
    expect(decideEntryBehaviour(rows, [], NOW)).toEqual({ kind: "empty-launch" });
  });

  it("instant-continue when a fresh snapshot's sid is a live, owned row", () => {
    const rows = [row({ sid: "live-1", status: "active" })];
    const snapshotInfo = { sid: "live-1", savedAt: NOW - 5000 };
    expect(decideEntryBehaviour(rows, [snapshotInfo], NOW)).toEqual({ kind: "instant-continue", sids: ["live-1"] });
  });

  // Multi-terminal reload restore (Nick's field report 2026-08-22): a tab
  // holding several live sessions must get ALL of them back, not just the
  // last-attached one.
  it("instant-continue returns every fresh-snapshotted live sid, in attach order", () => {
    const rows = [row({ sid: "live-1" }), row({ sid: "live-2" }), row({ sid: "live-3" })];
    const infos = [
      { sid: "live-1", savedAt: NOW - 5000 },
      { sid: "live-2", savedAt: NOW - 10_000 },
      { sid: "live-3", savedAt: NOW - 3000 },
    ];
    expect(decideEntryBehaviour(rows, infos, NOW)).toEqual({
      kind: "instant-continue",
      sids: ["live-1", "live-2", "live-3"],
    });
  });

  it("instant-continue skips a stale or no-longer-live sid but still restores the rest", () => {
    const rows = [
      row({ sid: "live-1" }),
      row({ sid: "ended-1", status: "ended", endedAt: new Date(NOW - 60_000).toISOString() }),
      row({ sid: "live-2" }),
    ];
    const infos = [
      { sid: "live-1", savedAt: NOW - SNAPSHOT_FRESHNESS_MS - 1 }, // stale
      { sid: "ended-1", savedAt: NOW - 5000 }, // fresh but ended
      { sid: "live-2", savedAt: NOW - 5000 }, // restorable
    ];
    expect(decideEntryBehaviour(rows, infos, NOW)).toEqual({ kind: "instant-continue", sids: ["live-2"] });
  });

  it("falls back to chooser when the snapshot is stale, even if the row is live", () => {
    const rows = [row({ sid: "live-1", status: "active" })];
    const snapshotInfo = { sid: "live-1", savedAt: NOW - SNAPSHOT_FRESHNESS_MS - 1 };
    expect(decideEntryBehaviour(rows, [snapshotInfo], NOW)).toEqual({ kind: "chooser" });
  });

  it("falls back to chooser when the fresh snapshot's sid is not a live row (ended/foreign/gone)", () => {
    const rows = [row({ sid: "live-1", status: "active" })];
    const snapshotInfo = { sid: "some-other-sid", savedAt: NOW - 5000 };
    expect(decideEntryBehaviour(rows, [snapshotInfo], NOW)).toEqual({ kind: "chooser" });
  });

  it("falls back to chooser when the fresh snapshot's sid row exists but has since ended", () => {
    const rows = [row({ sid: "live-1", status: "ended", cwd: "~/projects/a", endedAt: new Date(NOW - 60_000).toISOString() })];
    const snapshotInfo = { sid: "live-1", savedAt: NOW - 5000 };
    expect(decideEntryBehaviour(rows, [snapshotInfo], NOW)).toEqual({ kind: "chooser" });
  });

  it("empty-launch when there is a snapshot but no rows at all", () => {
    const snapshotInfo = { sid: "live-1", savedAt: NOW - 5000 };
    expect(decideEntryBehaviour([], [snapshotInfo], NOW)).toEqual({ kind: "empty-launch" });
  });
});
