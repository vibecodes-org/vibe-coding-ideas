import { describe, it, expect, vi, beforeEach } from "vitest";

// Two independently-configurable outcomes: the row lookup (`select().eq().eq()`)
// migrateLaunchPathPin makes first, and the `upsert(...).select(...).single()`
// both actions share (the `.select().single()` tail is what lets
// upsertProjectPath run its post-write ownership assertion — see
// launch-path.ts). A real supabase-js query builder is thenable itself (no
// `.single()` needed when the caller wants the raw {data, error} shape), so
// the select-lookup builder exposes its own `then` rather than requiring a
// terminal method call; the upsert builder terminates on `.single()` instead,
// matching how the real client is actually called.
let selectResult: { data: unknown; error: unknown } = { data: [], error: null };
let upsertResult: { data: unknown; error: unknown } = { data: null, error: null };
let userResult: { id: string } | null = { id: "user-1" };

function makeSelectBuilder() {
  const builder = {
    eq: vi.fn(() => builder),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(selectResult).then(resolve, reject),
  };
  return builder;
}

function makeUpsertBuilder() {
  const builder = {
    select: vi.fn(() => builder),
    single: vi.fn(() => Promise.resolve(upsertResult)),
  };
  return builder;
}

const mockUpsert = vi.fn(() => makeUpsertBuilder());
const mockSelect = vi.fn(() => makeSelectBuilder());
// Rest parameter (matching the real `.from(table)` call signature) rather than
// a zero-arg function: the wrapper below forwards `from`'s args on to this mock
// via a spread, which TS only allows into a function that declares a rest param.
const mockFrom = vi.fn((..._args: unknown[]) => ({ select: mockSelect, upsert: mockUpsert }));
const mockGetUser = vi.fn(() => Promise.resolve({ data: { user: userResult } }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: (...args: unknown[]) => mockFrom(...args),
    auth: { getUser: () => mockGetUser() },
  }),
}));

vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { migrateLaunchPathPin, saveManualProjectPath } from "./launch-path";
import { MANUAL_PIN_HOSTNAME } from "@/lib/launch-claude-code";

const IDEA_ID = "idea-1";
const PATH = "/Users/nick/projects/widget";
const REAL_HOSTNAME = "Nicks-MacBook-Pro.local";

/** The row the mocked upsert "returns" — owned by the caller unless a test overrides it. */
function ownedRow(hostname: string, absolutePath: string, ownerUserId = "user-1") {
  return { owner_user_id: ownerUserId, hostname, absolute_path: absolutePath };
}

beforeEach(() => {
  vi.clearAllMocks();
  selectResult = { data: [], error: null };
  upsertResult = { data: null, error: null };
  userResult = { id: "user-1" };
});

describe("migrateLaunchPathPin", () => {
  // pin-exists-and-migrates (0 rows, no known hostname)
  it("0 existing rows, hostname unknown: inserts under MANUAL_PIN_HOSTNAME", async () => {
    selectResult = { data: [], error: null };
    upsertResult = { data: ownedRow(MANUAL_PIN_HOSTNAME, PATH), error: null };
    const result = await migrateLaunchPathPin(IDEA_ID, PATH);
    expect(result).toEqual({
      ok: true,
      action: "insert",
      recorded: { hostname: MANUAL_PIN_HOSTNAME, absolute_path: PATH },
    });
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        idea_id: IDEA_ID,
        owner_user_id: "user-1",
        hostname: MANUAL_PIN_HOSTNAME,
        absolute_path: PATH,
      }),
      { onConflict: "idea_id,owner_user_id,hostname" }
    );
  });

  // Rework item 1 — the real hostname is now known (getMachineIdentity() on
  // the client), so a fresh insert lands under IT, not the fake sentinel.
  it("0 existing rows, real hostname known: inserts under the real hostname", async () => {
    selectResult = { data: [], error: null };
    upsertResult = { data: ownedRow(REAL_HOSTNAME, PATH), error: null };
    const result = await migrateLaunchPathPin(IDEA_ID, PATH, REAL_HOSTNAME);
    expect(result).toEqual({
      ok: true,
      action: "insert",
      recorded: { hostname: REAL_HOSTNAME, absolute_path: PATH },
    });
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: REAL_HOSTNAME, absolute_path: PATH }),
      { onConflict: "idea_id,owner_user_id,hostname" }
    );
  });

  // pin-and-record-disagree (exactly 1 row, different path, hostname unknown
  // or not matching that row) — updates the lone row in place regardless.
  it("exactly 1 existing row, hostname unknown: updates that row's own hostname in place", async () => {
    selectResult = { data: [{ hostname: "Old-Machine.local" }], error: null };
    upsertResult = { data: ownedRow("Old-Machine.local", PATH), error: null };
    const result = await migrateLaunchPathPin(IDEA_ID, PATH);
    expect(result).toEqual({
      ok: true,
      action: "update",
      recorded: { hostname: "Old-Machine.local", absolute_path: PATH },
    });
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: "Old-Machine.local", absolute_path: PATH }),
      { onConflict: "idea_id,owner_user_id,hostname" }
    );
  });

  // Precedence rule 1 — a row for the REAL hostname exists: that's the row to
  // update, regardless of how many other rows exist (the >1-row "skip" rule
  // existed only because the code couldn't tell which row was ours before).
  it("real hostname known and a row for it exists: updates THAT row, even alongside other rows", async () => {
    selectResult = {
      data: [{ hostname: "other-machine" }, { hostname: REAL_HOSTNAME }],
      error: null,
    };
    upsertResult = { data: ownedRow(REAL_HOSTNAME, PATH), error: null };
    const result = await migrateLaunchPathPin(IDEA_ID, PATH, REAL_HOSTNAME);
    expect(result).toEqual({
      ok: true,
      action: "update",
      recorded: { hostname: REAL_HOSTNAME, absolute_path: PATH },
    });
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: REAL_HOSTNAME, absolute_path: PATH }),
      { onConflict: "idea_id,owner_user_id,hostname" }
    );
    // The other machine's row is never touched — only one upsert, keyed on ours.
    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });

  // >1 rows, none matching, but we KNOW our hostname: insert our own row. This
  // used to skip, stranding the pin forever; the read (chooseLaunchCwd) now
  // prefers the row keyed to this machine, so the inserted row is the one it
  // picks — see decidePinMigration rule 4.
  it(">1 existing rows, none matching, real hostname known: inserts OUR row", async () => {
    selectResult = {
      data: [{ hostname: "mac" }, { hostname: "linux" }],
      error: null,
    };
    upsertResult = { data: ownedRow(REAL_HOSTNAME, PATH), error: null };
    const result = await migrateLaunchPathPin(IDEA_ID, PATH, REAL_HOSTNAME);
    expect(result).toEqual({
      ok: true,
      action: "insert",
      recorded: { hostname: REAL_HOSTNAME, absolute_path: PATH },
    });
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: REAL_HOSTNAME, absolute_path: PATH }),
      { onConflict: "idea_id,owner_user_id,hostname" }
    );
  });

  it(">1 existing rows, hostname unknown: skips — writes nothing", async () => {
    selectResult = {
      data: [{ hostname: "mac" }, { hostname: "linux" }],
      error: null,
    };
    const result = await migrateLaunchPathPin(IDEA_ID, PATH);
    expect(result).toEqual({ ok: true, action: "skip" });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  // migration run twice is a no-op (unknown hostname branch)
  it("running twice converges to the same row state (idempotent, hostname unknown)", async () => {
    // First run: 0 rows on file.
    selectResult = { data: [], error: null };
    upsertResult = { data: ownedRow(MANUAL_PIN_HOSTNAME, PATH), error: null };
    const first = await migrateLaunchPathPin(IDEA_ID, PATH);
    expect(first.action).toBe("insert");

    // Second run: the row from the first run is now on file (same hostname).
    selectResult = { data: [{ hostname: MANUAL_PIN_HOSTNAME }], error: null };
    const second = await migrateLaunchPathPin(IDEA_ID, PATH);
    expect(second).toEqual({
      ok: true,
      action: "update",
      recorded: { hostname: MANUAL_PIN_HOSTNAME, absolute_path: PATH },
    });
    // Both calls converge on the identical (idea, hostname) upsert key — no
    // duplicate/second row is ever created.
    expect(mockUpsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ hostname: MANUAL_PIN_HOSTNAME, absolute_path: PATH }),
      { onConflict: "idea_id,owner_user_id,hostname" }
    );
    expect(mockUpsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ hostname: MANUAL_PIN_HOSTNAME, absolute_path: PATH }),
      { onConflict: "idea_id,owner_user_id,hostname" }
    );
  });

  // The scenario the card explicitly calls out: migration writes under a real
  // hostname, then a later agent launch re-records that SAME hostname with
  // the same path (record_project_path's own upsert, mirrored here by a
  // second migrateLaunchPathPin call now that a row for our hostname is on
  // file) — must converge to ONE distinct row/path, never two.
  it("migrating then a later same-machine re-record converges to one row, not two", async () => {
    selectResult = { data: [], error: null };
    upsertResult = { data: ownedRow(REAL_HOSTNAME, PATH), error: null };
    const migrated = await migrateLaunchPathPin(IDEA_ID, PATH, REAL_HOSTNAME);
    expect(migrated).toEqual({
      ok: true,
      action: "insert",
      recorded: { hostname: REAL_HOSTNAME, absolute_path: PATH },
    });

    // The agent's own record_project_path self-heal call now sees that row.
    selectResult = { data: [{ hostname: REAL_HOSTNAME }], error: null };
    const relaunched = await migrateLaunchPathPin(IDEA_ID, PATH, REAL_HOSTNAME);
    expect(relaunched).toEqual({
      ok: true,
      action: "update",
      recorded: { hostname: REAL_HOSTNAME, absolute_path: PATH },
    });

    // Both writes target the SAME (idea, owner, hostname) conflict key — the
    // upsert can only ever converge on one row, never fork into two.
    expect(mockUpsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ hostname: REAL_HOSTNAME }),
      { onConflict: "idea_id,owner_user_id,hostname" }
    );
    expect(mockUpsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ hostname: REAL_HOSTNAME }),
      { onConflict: "idea_id,owner_user_id,hostname" }
    );
  });

  it("rejects a non-absolute pin path without touching the database", async () => {
    const result = await migrateLaunchPathPin(IDEA_ID, "~/relative/path");
    expect(result).toEqual({ ok: false, action: "invalid" });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  // Regression: `/` is a valid absolute path but must never be recorded — it
  // would poison every future launch on this machine.
  it("rejects the filesystem root `/` without touching the database", async () => {
    const result = await migrateLaunchPathPin(IDEA_ID, "/");
    expect(result).toEqual({ ok: false, action: "invalid" });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("returns unauthenticated when there's no session, and writes nothing", async () => {
    userResult = null;
    const result = await migrateLaunchPathPin(IDEA_ID, PATH);
    expect(result).toEqual({ ok: false, action: "unauthenticated" });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("surfaces a row-lookup failure as action 'error' without throwing", async () => {
    selectResult = { data: null, error: { message: "db unavailable" } };
    const result = await migrateLaunchPathPin(IDEA_ID, PATH);
    expect(result).toEqual({ ok: false, action: "error" });
  });

  it("surfaces an upsert failure as action 'error' without throwing", async () => {
    selectResult = { data: [], error: null };
    upsertResult = { data: null, error: { message: "db unavailable" } };
    const result = await migrateLaunchPathPin(IDEA_ID, PATH);
    expect(result).toEqual({ ok: false, action: "error" });
  });

  // A blank/whitespace-only hostname reads exactly like "not known" — falls
  // back to MANUAL_PIN_HOSTNAME on insert, same as omitting it entirely.
  it("treats a blank hostname the same as an unknown one", async () => {
    selectResult = { data: [], error: null };
    upsertResult = { data: ownedRow(MANUAL_PIN_HOSTNAME, PATH), error: null };
    const result = await migrateLaunchPathPin(IDEA_ID, PATH, "   ");
    expect(result.action).toBe("insert");
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: MANUAL_PIN_HOSTNAME }),
      { onConflict: "idea_id,owner_user_id,hostname" }
    );
  });

  // Belt-and-braces ownership assertion: the written row must belong to the
  // caller. If it doesn't (a future RLS-widening regression), fail loudly
  // rather than silently reporting success on someone else's row.
  it("fails when the upserted row comes back owned by someone else", async () => {
    selectResult = { data: [], error: null };
    upsertResult = { data: ownedRow(MANUAL_PIN_HOSTNAME, PATH, "someone-else"), error: null };
    const result = await migrateLaunchPathPin(IDEA_ID, PATH);
    expect(result).toEqual({ ok: false, action: "error" });
  });
});

describe("saveManualProjectPath (the 'Set exact folder' dialog's server-side Save)", () => {
  it("hostname unknown: upserts onto MANUAL_PIN_HOSTNAME regardless of existing rows (no row-count gating)", async () => {
    upsertResult = { data: ownedRow(MANUAL_PIN_HOSTNAME, PATH), error: null };
    const result = await saveManualProjectPath(IDEA_ID, `  ${PATH}  `);
    expect(result).toEqual({ ok: true, recorded: { hostname: MANUAL_PIN_HOSTNAME, absolute_path: PATH } });
    // Trimmed before it reaches the DB.
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: MANUAL_PIN_HOSTNAME, absolute_path: PATH }),
      { onConflict: "idea_id,owner_user_id,hostname" }
    );
    // Unlike migrateLaunchPathPin, no row lookup happens first — this is a
    // deliberate human write, not a migration decision.
    expect(mockSelect).not.toHaveBeenCalled();
  });

  // Rework item 1 — the dialog's Save now also prefers the real hostname.
  it("real hostname known: upserts onto that hostname's row instead of the fallback", async () => {
    upsertResult = { data: ownedRow(REAL_HOSTNAME, PATH), error: null };
    const result = await saveManualProjectPath(IDEA_ID, PATH, REAL_HOSTNAME);
    expect(result).toEqual({ ok: true, recorded: { hostname: REAL_HOSTNAME, absolute_path: PATH } });
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: REAL_HOSTNAME, absolute_path: PATH }),
      { onConflict: "idea_id,owner_user_id,hostname" }
    );
  });

  it("a null hostname (getMachineIdentity() never set) falls back to MANUAL_PIN_HOSTNAME", async () => {
    upsertResult = { data: ownedRow(MANUAL_PIN_HOSTNAME, PATH), error: null };
    const result = await saveManualProjectPath(IDEA_ID, PATH, null);
    expect(result).toEqual({ ok: true, recorded: { hostname: MANUAL_PIN_HOSTNAME, absolute_path: PATH } });
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: MANUAL_PIN_HOSTNAME }),
      { onConflict: "idea_id,owner_user_id,hostname" }
    );
  });

  it("rejects a non-absolute path", async () => {
    const result = await saveManualProjectPath(IDEA_ID, "not/absolute");
    expect(result).toEqual({ ok: false });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("rejects the filesystem root `/` without touching the database", async () => {
    const result = await saveManualProjectPath(IDEA_ID, "/");
    expect(result).toEqual({ ok: false });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  // Nick, 28 Aug 2026: a pasted `claude --worktree` path collapses to the
  // main project folder it hangs off — same rule as record_project_path.
  it("a worktree path (`…/.claude/worktrees/<id>`) is stored as the MAIN project folder", async () => {
    upsertResult = { data: ownedRow(REAL_HOSTNAME, PATH), error: null };
    const result = await saveManualProjectPath(IDEA_ID, `${PATH}/.claude/worktrees/785bd5e8`, REAL_HOSTNAME);
    expect(result).toEqual({ ok: true, recorded: { hostname: REAL_HOSTNAME, absolute_path: PATH } });
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: REAL_HOSTNAME, absolute_path: PATH }),
      { onConflict: "idea_id,owner_user_id,hostname" }
    );
  });

  it("fails closed when unauthenticated", async () => {
    userResult = null;
    const result = await saveManualProjectPath(IDEA_ID, PATH);
    expect(result).toEqual({ ok: false });
  });

  it("fails when the upserted row comes back owned by someone else", async () => {
    upsertResult = { data: ownedRow(MANUAL_PIN_HOSTNAME, PATH, "someone-else"), error: null };
    const result = await saveManualProjectPath(IDEA_ID, PATH);
    expect(result).toEqual({ ok: false });
  });
});
