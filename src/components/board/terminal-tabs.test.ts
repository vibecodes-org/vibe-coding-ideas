import { describe, it, expect } from "vitest";
import {
  tabStatusMeta,
  isLiveTabStatus,
  deriveTabLabel,
  findPristineSlot,
  findReclaimableEndedSlot,
  findReclaimableEndedSlotByKey,
  decideTaskLaunch,
  summarizeSessionStatuses,
  shouldAnnounceAttention,
  formatAttentionAnnouncement,
  type DedupeCandidate,
  type PristineCandidate,
  type ReclaimCandidate,
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

  it("gives 'popped-out' its own violet glyph, tone, and aria text, distinct from every real status", () => {
    const popped = tabStatusMeta("popped-out");
    expect(popped).toEqual({ glyph: "⧉", tone: "popped", ariaText: "popped out", needsAttention: false });
    const realGlyphs = new Set(
      (["idle", "connecting", "waiting-to-pair", "connected", "disconnected", "session-ended", "error"] as const).map(
        (s) => tabStatusMeta(s).glyph,
      ),
    );
    expect(realGlyphs.has(popped.glyph)).toBe(false);
  });

  it("'popped-out' is never an attention state — it's a deliberate user choice, not a problem", () => {
    expect(tabStatusMeta("popped-out").needsAttention).toBe(false);
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
      deriveTabLabel({ taskTitle: "Add pagination to the recipe list", ideaTitle: "Recipe Saver", sessionId: "a3f9c2e1" })
    ).toBe("Add pagination to the recipe list");
  });

  it("trims a task title that has stray whitespace", () => {
    expect(deriveTabLabel({ taskTitle: "  Fix login  ", ideaTitle: "Recipe Saver", sessionId: null })).toBe(
      "Fix login"
    );
  });

  it("falls back to `<idea title> · <sid-short>` when board-scoped — the FULL title, not the slug (design §1)", () => {
    expect(deriveTabLabel({ taskTitle: undefined, ideaTitle: "Recipe Saver", sessionId: "a3f9c2e1" })).toBe(
      "Recipe Saver · a3f9"
    );
  });

  it("treats an empty/whitespace-only task title as board-scoped", () => {
    expect(deriveTabLabel({ taskTitle: "   ", ideaTitle: "Recipe Saver", sessionId: "c2d8" })).toBe(
      "Recipe Saver · c2d8"
    );
  });

  it("uses an ellipsis placeholder before the session id is known", () => {
    expect(deriveTabLabel({ taskTitle: undefined, ideaTitle: "Recipe Saver", sessionId: null })).toBe(
      "Recipe Saver · …"
    );
  });

  it("falls back to 'Session · <sid4>' when the idea title is also blank", () => {
    expect(deriveTabLabel({ taskTitle: null, ideaTitle: null, sessionId: "9c2e1234" })).toBe("Session · 9c2e");
  });

  // ── card 3bf262ac: the user's own name outranks everything ────────────────
  it("uses the user's own display name over the task title", () => {
    expect(
      deriveTabLabel({
        displayName: "Auth spike — keep alive",
        taskTitle: "Fix login redirect loop",
        ideaTitle: "Recipe Saver",
        sessionId: "a3f9c2e1",
      }),
    ).toBe("Auth spike — keep alive");
  });

  it("uses the user's own display name over the fallback", () => {
    expect(deriveTabLabel({ displayName: "Stripe webhook spike", ideaTitle: "Recipe Saver", sessionId: "a3f9c2e1" })).toBe(
      "Stripe webhook spike",
    );
  });

  it("treats a whitespace-only display name as unset", () => {
    expect(
      deriveTabLabel({ displayName: "   ", taskTitle: "Fix login redirect loop", ideaTitle: "Recipe Saver", sessionId: "a3f9c2e1" }),
    ).toBe("Fix login redirect loop");
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

  it("never reuses a chooser-attach entry, even at launchSeq 0 (card cbe60db5)", () => {
    const sessions: PristineCandidate[] = [{ key: "s1", launchSeq: 0, hasAttach: true }];
    expect(findPristineSlot(sessions)).toBeNull();
  });

  it("never reuses a sole entry that auto-connected without a launch bump (bug report 2026-08-24)", () => {
    // Paired auto-connect calls `connect()` directly, without ever bumping
    // `launchSeq` off 0 — so `launchSeq === 0` alone can't prove the slot is
    // free once the tab is actually live.
    const sessions: PristineCandidate[] = [{ key: "s1", launchSeq: 0, status: "connected" }];
    expect(findPristineSlot(sessions)).toBeNull();
  });

  it("still reuses the sole entry at launchSeq 0 while genuinely idle", () => {
    const sessions: PristineCandidate[] = [{ key: "s1", launchSeq: 0, status: "idle" }];
    expect(findPristineSlot(sessions)).toBe("s1");
  });

  it("treats a missing status as free, for callers that don't track it", () => {
    const sessions: PristineCandidate[] = [{ key: "s1", launchSeq: 0 }];
    expect(findPristineSlot(sessions)).toBe("s1");
  });
});

describe("findReclaimableEndedSlot (ended-tab reclaim, card df29b85e)", () => {
  it("reclaims the tab whose sessionId matches the resume target, when it's ended", () => {
    const candidates: ReclaimCandidate[] = [
      { key: "s1", status: "session-ended", sessionId: "sid-1", poppedOut: false },
    ];
    expect(findReclaimableEndedSlot(candidates, "sid-1")).toBe("s1");
  });

  it("refuses a matching tab that's still live", () => {
    const candidates: ReclaimCandidate[] = [
      { key: "s1", status: "connected", sessionId: "sid-1", poppedOut: false },
    ];
    expect(findReclaimableEndedSlot(candidates, "sid-1")).toBeNull();
  });

  it("refuses a matching tab that's popped out, even though its last-known status reads session-ended", () => {
    const candidates: ReclaimCandidate[] = [
      { key: "s1", status: "session-ended", sessionId: "sid-1", poppedOut: true },
    ];
    expect(findReclaimableEndedSlot(candidates, "sid-1")).toBeNull();
  });

  it("falls through to append when the target sid matches no local tab", () => {
    const candidates: ReclaimCandidate[] = [
      { key: "s1", status: "session-ended", sessionId: "sid-2", poppedOut: false },
    ];
    expect(findReclaimableEndedSlot(candidates, "sid-1")).toBeNull();
  });

  it("never reclaims arbitrarily when no target sid is given — always append", () => {
    const candidates: ReclaimCandidate[] = [
      { key: "s1", status: "session-ended", sessionId: "sid-1", poppedOut: false },
    ];
    expect(findReclaimableEndedSlot(candidates, undefined)).toBeNull();
    expect(findReclaimableEndedSlot(candidates, null)).toBeNull();
  });

  it("refuses a matching tab whose status is error, not session-ended (only a genuinely-ended tab is reclaimable)", () => {
    const candidates: ReclaimCandidate[] = [
      { key: "s1", status: "error", sessionId: "sid-1", poppedOut: false },
    ];
    expect(findReclaimableEndedSlot(candidates, "sid-1")).toBeNull();
  });

  it("picks the matching tab out of several others", () => {
    const candidates: ReclaimCandidate[] = [
      { key: "s1", status: "connected", sessionId: "sid-other", poppedOut: false },
      { key: "s2", status: "session-ended", sessionId: "sid-1", poppedOut: false },
      { key: "s3", status: "session-ended", sessionId: "sid-3", poppedOut: false },
    ];
    expect(findReclaimableEndedSlot(candidates, "sid-1")).toBe("s2");
  });
});

describe("findReclaimableEndedSlotByKey (Start New Session from an ended tab's browse link)", () => {
  it("reclaims the ended tab matching the target key", () => {
    const candidates: ReclaimCandidate[] = [
      { key: "s1", status: "session-ended", sessionId: "sid-1", poppedOut: false },
    ];
    expect(findReclaimableEndedSlotByKey(candidates, "s1")).toBe("s1");
  });

  it("refuses a matching key that's still live", () => {
    const candidates: ReclaimCandidate[] = [
      { key: "s1", status: "connected", sessionId: "sid-1", poppedOut: false },
    ];
    expect(findReclaimableEndedSlotByKey(candidates, "s1")).toBeNull();
  });

  it("refuses a matching key that's popped out", () => {
    const candidates: ReclaimCandidate[] = [
      { key: "s1", status: "session-ended", sessionId: "sid-1", poppedOut: true },
    ];
    expect(findReclaimableEndedSlotByKey(candidates, "s1")).toBeNull();
  });

  it("falls through to append when the target key matches no local tab", () => {
    const candidates: ReclaimCandidate[] = [
      { key: "s1", status: "session-ended", sessionId: "sid-1", poppedOut: false },
    ];
    expect(findReclaimableEndedSlotByKey(candidates, "s2")).toBeNull();
  });

  it("never reclaims arbitrarily when no target key is given — always append", () => {
    const candidates: ReclaimCandidate[] = [
      { key: "s1", status: "session-ended", sessionId: "sid-1", poppedOut: false },
    ];
    expect(findReclaimableEndedSlotByKey(candidates, undefined)).toBeNull();
    expect(findReclaimableEndedSlotByKey(candidates, null)).toBeNull();
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

  it("gives a popped-out session its own calm chip, never lumped into 'needs attention'", () => {
    // A popped-out session's UNDERLYING socket is usually sitting in an
    // "error"/duplicate state at this exact moment (the 4001 preemption) —
    // the caller substitutes "popped-out" for it precisely so this summary
    // never misreads a deliberate pop-out as something wrong.
    const chips = summarizeSessionStatuses(["connected", "popped-out"]);
    expect(chips).toEqual([
      { tone: "popped", glyph: "⧉", count: 1, label: "1 popped out" },
      { tone: "ok", glyph: "●", count: 1, label: "1 connected" },
    ]);
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
