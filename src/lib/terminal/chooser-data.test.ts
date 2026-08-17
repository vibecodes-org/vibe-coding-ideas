import { describe, it, expect } from "vitest";
import {
  RECENT_WINDOW_MS,
  RECENT_MAX,
  deriveChooserSections,
  chooserHeaderCounts,
  findLiveSessionForTask,
  findTaskSessionMatch,
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
    claudeSessionId: null,
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

  // Bug 9fb9fced (2026-08-17): this used to assert the row was hidden from
  // Recent entirely (the old F4 rule). Confirmed against live production
  // data — a session whose cwd never got recorded (the client's post-connect
  // PATCH only fires when the launch already had a known project path)
  // vanished from Recent COMPLETELY once it ended, not just its Resume
  // button, so a refresh right after found nothing live/recent anywhere and
  // silently launched a brand-new session. The row must now still appear —
  // with `cwd: null` — so the CALLER (the chooser UI) can render everything
  // it knows (sid, ended time, machine) and omit only the Resume action.
  it("keeps an ended row with no recorded folder in Recent, with cwd: null", () => {
    const rows = [
      row({ sid: "no-cwd", status: "ended", cwd: null, endedAt: new Date(NOW - 60_000).toISOString() }),
      row({ sid: "blank-cwd", status: "ended", cwd: "   ", endedAt: new Date(NOW - 30_000).toISOString() }),
    ];
    const recent = deriveChooserSections(rows, IDEA_A, NOW).recent;
    expect(recent.map((r) => r.sid)).toEqual(["blank-cwd", "no-cwd"]); // newest-ended first
    expect(recent.every((r) => r.cwd === null)).toBe(true);
  });

  it("never dedupes null-cwd rows against each other — there's no folder to collapse on", () => {
    const rows = [
      row({ sid: "no-cwd-a", status: "ended", cwd: null, endedAt: new Date(NOW - 3 * 60_000).toISOString() }),
      row({ sid: "no-cwd-b", status: "ended", cwd: null, endedAt: new Date(NOW - 2 * 60_000).toISOString() }),
      row({ sid: "no-cwd-c", status: "ended", cwd: null, endedAt: new Date(NOW - 1 * 60_000).toISOString() }),
    ];
    const recent = deriveChooserSections(rows, IDEA_A, NOW).recent.map((r) => r.sid);
    // All three kept (newest-ended first) — contrast with the recorded-cwd
    // dedupe test below, where two rows sharing a folder collapse to one.
    expect(recent).toEqual(["no-cwd-c", "no-cwd-b", "no-cwd-a"]);
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

  // Root-cause hardening (rework 5, card cbe60db5 — Nick's field test: a
  // Recent row was labelled "ended 8h 54m ago" when a newer conversation for
  // the same folder had ended minutes earlier). The dedupe above already
  // sorts by `endedAt` DESC before keeping one row per folder — these two
  // tests lock that in against regressions the task explicitly called out:
  // wrong INPUT ORDERING, and reading the wrong timestamp field.
  it("keeps the newest-ended row per folder regardless of the INPUT array's order (not first-seen)", () => {
    // The newer row is listed FIRST here — a naive "keep first-seen" dedupe
    // would already pass by accident. Flip the order so only a real
    // endedAt-based sort (not input order) can produce the right answer.
    const rows = [
      row({
        sid: "newer",
        status: "ended",
        cwd: "~/projects/dupe",
        endedAt: new Date(NOW - 1 * 60 * 60 * 1000).toISOString(),
      }),
      row({
        sid: "older",
        status: "ended",
        cwd: "~/projects/dupe",
        endedAt: new Date(NOW - 3 * 60 * 60 * 1000).toISOString(),
      }),
    ];
    const recent = deriveChooserSections(rows, IDEA_A, NOW).recent;
    expect(recent).toHaveLength(1);
    expect(recent[0].sid).toBe("newer");
  });

  it("orders Recent by endedAt across DIFFERENT folders too, not by createdAt or input order", () => {
    // Each row's createdAt/input-position is the OPPOSITE of its endedAt
    // recency, so only a correct endedAt-desc sort produces b, a, c.
    const rows = [
      row({
        sid: "a",
        status: "ended",
        cwd: "~/projects/a",
        createdAt: new Date(NOW - 10 * 60 * 60 * 1000).toISOString(),
        endedAt: new Date(NOW - 5 * 60 * 1000).toISOString(), // 5m ago — 2nd newest
      }),
      row({
        sid: "b",
        status: "ended",
        cwd: "~/projects/b",
        createdAt: new Date(NOW - 1 * 60 * 60 * 1000).toISOString(),
        endedAt: new Date(NOW - 1 * 60 * 1000).toISOString(), // 1m ago — newest
      }),
      row({
        sid: "c",
        status: "ended",
        cwd: "~/projects/c",
        createdAt: new Date(NOW - 20 * 60 * 60 * 1000).toISOString(),
        endedAt: new Date(NOW - 30 * 60 * 1000).toISOString(), // 30m ago — oldest
      }),
    ];
    const recent = deriveChooserSections(rows, IDEA_A, NOW).recent;
    expect(recent.map((r) => r.sid)).toEqual(["b", "a", "c"]);
  });

  it("Recent rows carry endedAt from the `ended_at` field, never createdAt — a stale label never masks a truly-recent end", () => {
    const staleCreatedAt = new Date(NOW - 30 * 60 * 60 * 1000).toISOString(); // 30h ago
    const freshEndedAt = new Date(NOW - 5 * 60 * 1000).toISOString(); // 5m ago
    const rows = [
      row({ sid: "x", status: "ended", cwd: "~/projects/x", createdAt: staleCreatedAt, endedAt: freshEndedAt }),
    ];
    const recent = deriveChooserSections(rows, IDEA_A, NOW).recent;
    expect(recent[0].endedAt).toBe(freshEndedAt);
    expect(recent[0].endedAt).not.toBe(staleCreatedAt);
  });

  it("carries claudeSessionId through to the Recent row (exact-conversation Resume, rework 5)", () => {
    const rows = [
      row({
        sid: "tracked",
        status: "ended",
        cwd: "~/projects/tracked",
        endedAt: new Date(NOW - 60_000).toISOString(),
        claudeSessionId: "99999999-8888-7777-6666-555555555555",
      }),
      row({ sid: "untracked", status: "ended", cwd: "~/projects/untracked", endedAt: new Date(NOW - 60_000).toISOString() }),
    ];
    const recent = deriveChooserSections(rows, IDEA_A, NOW).recent;
    expect(recent.find((r) => r.sid === "tracked")?.claudeSessionId).toBe("99999999-8888-7777-6666-555555555555");
    expect(recent.find((r) => r.sid === "untracked")?.claudeSessionId).toBeNull();
  });

  it("caps Recent at RECENT_MAX (now 10), newest first", () => {
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

  // Rework 8b (card cbe60db5) — Nick's explicit, superseding instruction:
  // "is there any way we can show MORE than one resume session?" → "yes,
  // make that change." Every ID-bearing ended session gets its own row; only
  // ID-less rows (which Resume genuinely can't tell apart) still collapse
  // one-per-folder. See chooser-data.ts's header comment for the full rule.
  describe("every resumable conversation (rework 8b — no dedupe for ID-bearing rows)", () => {
    it("shows every ID-bearing row for the SAME folder — none collapsed", () => {
      const rows = [
        row({
          sid: "convo-1",
          status: "ended",
          cwd: "~/projects/multi",
          endedAt: new Date(NOW - 3 * 60 * 60 * 1000).toISOString(),
          claudeSessionId: "11111111-1111-1111-1111-111111111111",
        }),
        row({
          sid: "convo-2",
          status: "ended",
          cwd: "~/projects/multi",
          endedAt: new Date(NOW - 2 * 60 * 60 * 1000).toISOString(),
          claudeSessionId: "22222222-2222-2222-2222-222222222222",
        }),
        row({
          sid: "convo-3",
          status: "ended",
          cwd: "~/projects/multi",
          endedAt: new Date(NOW - 1 * 60 * 60 * 1000).toISOString(),
          claudeSessionId: "33333333-3333-3333-3333-333333333333",
        }),
      ];
      const recent = deriveChooserSections(rows, IDEA_A, NOW).recent;
      // Newest-ended first; all three distinct conversations kept.
      expect(recent.map((r) => r.sid)).toEqual(["convo-3", "convo-2", "convo-1"]);
    });

    it("still collapses ID-LESS rows to the single newest per folder", () => {
      const rows = [
        row({
          sid: "idless-older",
          status: "ended",
          cwd: "~/projects/legacy",
          endedAt: new Date(NOW - 3 * 60 * 60 * 1000).toISOString(),
          claudeSessionId: null,
        }),
        row({
          sid: "idless-newer",
          status: "ended",
          cwd: "~/projects/legacy",
          endedAt: new Date(NOW - 1 * 60 * 60 * 1000).toISOString(),
          claudeSessionId: null,
        }),
      ];
      const recent = deriveChooserSections(rows, IDEA_A, NOW).recent;
      expect(recent.map((r) => r.sid)).toEqual(["idless-newer"]);
    });

    it("mixed folder: shows every ID-bearing row PLUS the single newest ID-less row for that same folder", () => {
      const rows = [
        row({
          sid: "id-a",
          status: "ended",
          cwd: "~/projects/mixed",
          endedAt: new Date(NOW - 4 * 60 * 60 * 1000).toISOString(),
          claudeSessionId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        }),
        row({
          sid: "id-b",
          status: "ended",
          cwd: "~/projects/mixed",
          endedAt: new Date(NOW - 1 * 60 * 60 * 1000).toISOString(),
          claudeSessionId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        }),
        row({
          sid: "idless-old-1",
          status: "ended",
          cwd: "~/projects/mixed",
          endedAt: new Date(NOW - 5 * 60 * 60 * 1000).toISOString(),
          claudeSessionId: null,
        }),
        row({
          sid: "idless-old-2",
          status: "ended",
          cwd: "~/projects/mixed",
          endedAt: new Date(NOW - 6 * 60 * 60 * 1000).toISOString(),
          claudeSessionId: null,
        }),
      ];
      const recent = deriveChooserSections(rows, IDEA_A, NOW).recent;
      // Both id-bearing rows shown, plus only the newest of the two id-less
      // rows ("idless-old-1", 5h ago beats "idless-old-2", 6h ago).
      expect(recent.map((r) => r.sid)).toEqual(["id-b", "id-a", "idless-old-1"]);
    });

    it("caps the combined id-bearing + id-less selection at RECENT_MAX, newest first", () => {
      const idBearing = Array.from({ length: RECENT_MAX }, (_, i) =>
        row({
          sid: `id-${i}`,
          status: "ended",
          cwd: "~/projects/flood",
          endedAt: new Date(NOW - i * 60_000).toISOString(),
          claudeSessionId: `${i}0000000-0000-0000-0000-000000000000`,
        }),
      );
      // An older row (would-be 11th) that must be truncated by the cap.
      const overflow = row({
        sid: "id-overflow",
        status: "ended",
        cwd: "~/projects/flood",
        endedAt: new Date(NOW - RECENT_MAX * 60_000).toISOString(),
        claudeSessionId: "99999999-0000-0000-0000-000000000000",
      });
      const recent = deriveChooserSections([...idBearing, overflow], IDEA_A, NOW).recent;
      expect(recent).toHaveLength(RECENT_MAX);
      expect(recent.map((r) => r.sid)).not.toContain("id-overflow");
      expect(recent[0].sid).toBe("id-0"); // newest (smallest offset) first
    });
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

  // Machine identity (Nick's sign-off change 2): Recent-section filtering
  // against this browser's own recorded machine identity.
  describe("machine identity filtering (Recent section only)", () => {
    function endedRow(overrides: Partial<ChooserRegistryRow> & { sid: string }): ChooserRegistryRow {
      return row({
        status: "ended",
        cwd: `~/projects/${overrides.sid}`,
        endedAt: new Date(NOW - 60_000).toISOString(),
        ...overrides,
      });
    }

    it("shows a Recent row whose machineLabel matches the stored identity", () => {
      const rows = [endedRow({ sid: "match", machineLabel: "Nicks-MacBook-Pro" })];
      const recent = deriveChooserSections(rows, IDEA_A, NOW, null, "Nicks-MacBook-Pro").recent;
      expect(recent.map((r) => r.sid)).toEqual(["match"]);
    });

    it("hides a Recent row whose machineLabel differs from the stored identity", () => {
      const rows = [endedRow({ sid: "mismatch", machineLabel: "Nicks-Mac-Studio" })];
      const recent = deriveChooserSections(rows, IDEA_A, NOW, null, "Nicks-MacBook-Pro").recent;
      expect(recent).toEqual([]);
    });

    it("shows a Recent row with a null machineLabel even when an identity is stored", () => {
      const rows = [endedRow({ sid: "no-label", machineLabel: null })];
      const recent = deriveChooserSections(rows, IDEA_A, NOW, null, "Nicks-MacBook-Pro").recent;
      expect(recent.map((r) => r.sid)).toEqual(["no-label"]);
    });

    it("shows every Recent row when no identity is stored, regardless of machineLabel", () => {
      const rows = [
        endedRow({ sid: "labeled", machineLabel: "Nicks-Mac-Studio" }),
        endedRow({ sid: "unlabeled", machineLabel: null }),
      ];
      const recent = deriveChooserSections(rows, IDEA_A, NOW, null, null).recent;
      expect(recent.map((r) => r.sid).sort()).toEqual(["labeled", "unlabeled"]);
    });

    it("never filters live sections, even on a machine mismatch", () => {
      const rows = [row({ sid: "live-mismatch", ideaId: IDEA_A, status: "active", machineLabel: "Nicks-Mac-Studio" })];
      const sections = deriveChooserSections(rows, IDEA_A, NOW, null, "Nicks-MacBook-Pro");
      expect(sections.liveHere.map((r) => r.sid)).toEqual(["live-mismatch"]);
    });
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

// Task-launch-skip-chooser (Nick's explicit product decision, 2026-08-16):
// `findTaskSessionMatch` is the ONE predicate the per-task launch keys on —
// unlike `findLiveSessionForTask` (live rows only, used for the full
// chooser's "already running for this task" badge), this also considers the
// Recent (ended, ≤48h) section, since a task launch must dedupe against a
// recently-ended session for that exact task too, never just a live one.
describe("findTaskSessionMatch", () => {
  function endedRow(overrides: Partial<ChooserRegistryRow> & { sid: string }): ChooserRegistryRow {
    return row({
      status: "ended",
      cwd: `~/projects/${overrides.sid}`,
      endedAt: new Date(NOW - 60_000).toISOString(),
      ...overrides,
    });
  }

  it("returns null for a board-level launch (no taskId)", () => {
    const sections = deriveChooserSections([], IDEA_A, NOW);
    expect(findTaskSessionMatch(sections, undefined)).toBeNull();
    expect(findTaskSessionMatch(sections, null)).toBeNull();
  });

  it("returns null when nothing anywhere matches the task — the auto-start case", () => {
    const rows = [
      row({ sid: "unrelated-live", ideaId: IDEA_B, status: "active", taskId: "task-OTHER" }),
      endedRow({ sid: "unrelated-recent", taskId: "task-OTHER" }),
    ];
    const sections = deriveChooserSections(rows, IDEA_A, NOW);
    expect(findTaskSessionMatch(sections, "task-1")).toBeNull();
  });

  it("matches a live 'here' row for the exact task, over an 'elsewhere' or recent one", () => {
    const rows = [
      row({ sid: "here", ideaId: IDEA_A, status: "active", taskId: "task-1" }),
      row({ sid: "elsewhere", ideaId: IDEA_B, status: "active", taskId: "task-1" }),
      endedRow({ sid: "recent", taskId: "task-1" }),
    ];
    const sections = deriveChooserSections(rows, IDEA_A, NOW);
    const match = findTaskSessionMatch(sections, "task-1");
    expect(match?.kind).toBe("live-here");
    expect(match?.row.sid).toBe("here");
  });

  it("falls back to a live 'elsewhere' row for the exact task when there is no 'here' match", () => {
    const rows = [
      row({ sid: "elsewhere", ideaId: IDEA_B, status: "active", taskId: "task-1" }),
      endedRow({ sid: "recent", taskId: "task-1" }),
    ];
    const sections = deriveChooserSections(rows, IDEA_A, NOW);
    const match = findTaskSessionMatch(sections, "task-1");
    expect(match?.kind).toBe("live-elsewhere");
    expect(match?.row.sid).toBe("elsewhere");
  });

  it("falls back to a Recent (ended, ≤48h) row for the exact task when nothing is live", () => {
    const rows = [endedRow({ sid: "recent", taskId: "task-1" })];
    const sections = deriveChooserSections(rows, IDEA_A, NOW);
    const match = findTaskSessionMatch(sections, "task-1");
    expect(match?.kind).toBe("recent");
    expect(match?.row.sid).toBe("recent");
  });

  it("never matches a DIFFERENT task's live or recent row (no false-positive dedupe)", () => {
    const rows = [
      row({ sid: "other-live", ideaId: IDEA_A, status: "active", taskId: "task-OTHER" }),
      endedRow({ sid: "other-recent", taskId: "task-OTHER" }),
    ];
    const sections = deriveChooserSections(rows, IDEA_A, NOW);
    expect(findTaskSessionMatch(sections, "task-1")).toBeNull();
  });

  it("ignores a Recent row past the 48h window for the exact task (deriveChooserSections already dropped it)", () => {
    const rows = [
      endedRow({
        sid: "stale",
        taskId: "task-1",
        endedAt: new Date(NOW - RECENT_WINDOW_MS - 60_000).toISOString(),
      }),
    ];
    const sections = deriveChooserSections(rows, IDEA_A, NOW);
    expect(findTaskSessionMatch(sections, "task-1")).toBeNull();
  });
});
