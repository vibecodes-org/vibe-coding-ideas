import { describe, it, expect } from "vitest";
import { shouldSyncFieldFromProp } from "./task-sync";

describe("shouldSyncFieldFromProp", () => {
  it("syncs when the prop value changed and the field is idle", () => {
    expect(
      shouldSyncFieldFromProp({ incoming: "new", lastSynced: "old" })
    ).toBe(true);
  });

  it("does not sync when the value is unchanged", () => {
    expect(
      shouldSyncFieldFromProp({ incoming: "same", lastSynced: "same" })
    ).toBe(false);
  });

  it("treats equal null values as unchanged", () => {
    expect(
      shouldSyncFieldFromProp({ incoming: null, lastSynced: null })
    ).toBe(false);
  });

  it("syncs when transitioning from null to a value", () => {
    expect(
      shouldSyncFieldFromProp({ incoming: "first", lastSynced: null })
    ).toBe(true);
  });

  it("does not clobber local text while the user is editing", () => {
    expect(
      shouldSyncFieldFromProp({
        incoming: "stale",
        lastSynced: "old",
        isEditing: true,
      })
    ).toBe(false);
  });

  // Regression: the "description update bug" — a stale Realtime board refresh
  // arriving during the blur→save window (editing already false) must NOT
  // overwrite the text the user just typed and is saving.
  it("does not clobber local text while a save is in flight", () => {
    expect(
      shouldSyncFieldFromProp({
        incoming: "stale-from-realtime",
        lastSynced: "old",
        isEditing: false,
        isSaving: true,
      })
    ).toBe(false);
  });

  it("resumes syncing once the save has settled", () => {
    expect(
      shouldSyncFieldFromProp({
        incoming: "fresh-from-server",
        lastSynced: "old",
        isEditing: false,
        isSaving: false,
      })
    ).toBe(true);
  });
});
