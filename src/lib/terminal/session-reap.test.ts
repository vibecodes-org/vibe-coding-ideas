import { describe, it, expect, vi } from "vitest";
import { reapExpiredSessions } from "./session-reap";

const NOW = Date.parse("2026-08-12T03:58:00.000Z");

interface StubRow {
  id: string;
  status: "active" | "ended";
  expires_at: string;
}

/**
 * Mimics just enough of the supabase-js query builder for
 * `reapExpiredSessions`: a single `.select().eq().eq()` read that resolves
 * to `rows`, and a per-row `.update(payload).eq("id", …).eq("status", …)`
 * write whose filters land on the SAME thenable builder object (mirroring
 * how supabase-js chains additional filters onto one query) so each write's
 * exact `id` filter, `status` filter, and payload can be asserted.
 */
function createMockSupabase(rows: StubRow[]) {
  const updateCalls: { payload: Record<string, unknown>; filters: Record<string, unknown> }[] = [];

  const supabase = {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({ data: rows, error: null }),
        })),
      })),
      update: vi.fn((payload: Record<string, unknown>) => {
        const record = { payload, filters: {} as Record<string, unknown> };
        updateCalls.push(record);
        const builder = {
          eq: vi.fn((col: string, val: unknown) => {
            record.filters[col] = val;
            return builder;
          }),
          then: (resolve: (value: { data: null; error: null }) => void) =>
            resolve({ data: null, error: null }),
        };
        return builder;
      }),
    })),
  };

  return { supabase, updateCalls };
}

describe("reapExpiredSessions", () => {
  it("backdates a reaped row's ended_at to its OWN expires_at, not now", async () => {
    const expiresAt = new Date(NOW - 5 * 60 * 60 * 1000).toISOString(); // died ~5h ago
    const { supabase, updateCalls } = createMockSupabase([{ id: "row-1", status: "active", expires_at: expiresAt }]);

    const result = await reapExpiredSessions(supabase as never, "user-1", NOW);

    expect(result).toEqual({ activeBefore: 1, reapedIds: ["row-1"] });
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].payload).toEqual({ status: "ended", ended_at: expiresAt });
    expect(updateCalls[0].payload.ended_at).not.toBe(new Date(NOW).toISOString());
    expect(updateCalls[0].filters).toEqual({ id: "row-1", status: "active" });
  });

  it("gives each row in a mixed batch ITS OWN expires_at, not one shared value", async () => {
    const expiresAtA = new Date(NOW - 5 * 60 * 60 * 1000).toISOString();
    const expiresAtB = new Date(NOW - 30 * 60 * 1000).toISOString();
    const future = new Date(NOW + 60 * 60 * 1000).toISOString();
    const { supabase, updateCalls } = createMockSupabase([
      { id: "stale-a", status: "active", expires_at: expiresAtA },
      { id: "fresh", status: "active", expires_at: future },
      { id: "stale-b", status: "active", expires_at: expiresAtB },
    ]);

    const result = await reapExpiredSessions(supabase as never, "user-1", NOW);

    expect(result.activeBefore).toBe(3);
    expect(result.reapedIds.sort()).toEqual(["stale-a", "stale-b"]);
    expect(updateCalls).toHaveLength(2);
    const byId = Object.fromEntries(updateCalls.map((c) => [c.filters.id, c.payload.ended_at]));
    expect(byId["stale-a"]).toBe(expiresAtA);
    expect(byId["stale-b"]).toBe(expiresAtB);
  });

  it("never writes for a fresh active row", async () => {
    const future = new Date(NOW + 60_000).toISOString();
    const { supabase, updateCalls } = createMockSupabase([{ id: "row-1", status: "active", expires_at: future }]);

    const result = await reapExpiredSessions(supabase as never, "user-1", NOW);

    expect(result).toEqual({ activeBefore: 1, reapedIds: [] });
    expect(updateCalls).toHaveLength(0);
  });

  it("never touches an already-ended row's real ended_at", async () => {
    const past = new Date(NOW - 1).toISOString();
    // The read itself filters .eq("status", "active"), so an "ended" row
    // would never come back from a real query — but reapExpiredSessions'
    // underlying selectReapUpdates defensively re-checks status too.
    const { supabase, updateCalls } = createMockSupabase([{ id: "row-1", status: "ended", expires_at: past }]);

    const result = await reapExpiredSessions(supabase as never, "user-1", NOW);

    expect(result).toEqual({ activeBefore: 1, reapedIds: [] });
    expect(updateCalls).toHaveLength(0);
  });

  it("fails open on a read error, touching nothing", async () => {
    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } }),
          })),
        })),
      })),
    };

    const result = await reapExpiredSessions(supabase as never, "user-1", NOW);
    expect(result).toEqual({ activeBefore: 0, reapedIds: [] });
  });
});
