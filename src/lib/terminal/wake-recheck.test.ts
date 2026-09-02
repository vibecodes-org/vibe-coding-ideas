import { describe, it, expect } from "vitest";
import { computeWakeRecheck, type WakeRegistryRow, type WakeTabSid } from "./wake-recheck";

function row(overrides: Partial<WakeRegistryRow> & { sid: string }): WakeRegistryRow {
  return { status: "active", cwd: null, claudeSessionId: null, endedAt: null, ...overrides };
}

function tab(overrides: Partial<WakeTabSid> & { key: string }): WakeTabSid {
  return { sid: null, ...overrides };
}

describe("computeWakeRecheck", () => {
  it("returns nothing when there are no registry rows", () => {
    const tabs = [tab({ key: "tab-1", sid: "sid-1" })];
    expect(computeWakeRecheck([], tabs)).toEqual({});
  });

  it("returns nothing when there are no open tabs", () => {
    const rows = [row({ sid: "sid-1", status: "ended", cwd: "~/projects/a", endedAt: "2026-09-01T10:00:00.000Z" })];
    expect(computeWakeRecheck(rows, [])).toEqual({});
  });

  it("omits a tab whose sid is still active server-side", () => {
    const rows = [row({ sid: "sid-1", status: "active" })];
    const tabs = [tab({ key: "tab-1", sid: "sid-1" })];
    expect(computeWakeRecheck(rows, tabs)).toEqual({});
  });

  it("omits a tab with no sid yet", () => {
    const rows = [row({ sid: "sid-1", status: "ended", cwd: "~/projects/a", endedAt: "2026-09-01T10:00:00.000Z" })];
    const tabs = [tab({ key: "tab-1", sid: null })];
    expect(computeWakeRecheck(rows, tabs)).toEqual({});
  });

  it("omits a tab whose sid has no registry row at all — never guesses", () => {
    const rows = [row({ sid: "sid-other", status: "ended", cwd: "~/projects/a", endedAt: "2026-09-01T10:00:00.000Z" })];
    const tabs = [tab({ key: "tab-1", sid: "sid-1" })];
    expect(computeWakeRecheck(rows, tabs)).toEqual({});
  });

  it("omits an ended row with no recorded cwd — nothing resumable", () => {
    const rows = [row({ sid: "sid-1", status: "ended", cwd: null, endedAt: "2026-09-01T10:00:00.000Z" })];
    const tabs = [tab({ key: "tab-1", sid: "sid-1" })];
    expect(computeWakeRecheck(rows, tabs)).toEqual({});
  });

  it("returns resume material for a tab whose sid just ended, keyed by tab key", () => {
    const rows = [
      row({
        sid: "sid-1",
        status: "ended",
        cwd: "~/projects/a",
        claudeSessionId: "claude-abc",
        endedAt: "2026-09-01T10:00:00.000Z",
      }),
    ];
    const tabs = [tab({ key: "tab-1", sid: "sid-1" })];
    expect(computeWakeRecheck(rows, tabs)).toEqual({
      "tab-1": { cwd: "~/projects/a", claudeSessionId: "claude-abc", endedAt: "2026-09-01T10:00:00.000Z" },
    });
  });

  it("degrades gracefully to --continue (null claudeSessionId) when the bridge never announced one", () => {
    const rows = [row({ sid: "sid-1", status: "ended", cwd: "~/projects/a", endedAt: "2026-09-01T10:00:00.000Z" })];
    const tabs = [tab({ key: "tab-1", sid: "sid-1" })];
    expect(computeWakeRecheck(rows, tabs)).toEqual({
      "tab-1": { cwd: "~/projects/a", claudeSessionId: null, endedAt: "2026-09-01T10:00:00.000Z" },
    });
  });

  it("handles multiple tabs independently, one ended and one still live", () => {
    const rows = [
      row({ sid: "sid-1", status: "ended", cwd: "~/projects/a", endedAt: "2026-09-01T10:00:00.000Z" }),
      row({ sid: "sid-2", status: "active" }),
    ];
    const tabs = [tab({ key: "tab-1", sid: "sid-1" }), tab({ key: "tab-2", sid: "sid-2" })];
    expect(computeWakeRecheck(rows, tabs)).toEqual({
      "tab-1": { cwd: "~/projects/a", claudeSessionId: null, endedAt: "2026-09-01T10:00:00.000Z" },
    });
  });
});
