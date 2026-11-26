import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({
  // Run the function straight through; the real cache needs the Next runtime.
  unstable_cache: <A extends unknown[], R>(fn: (...a: A) => Promise<R>) => fn,
}));

const createClientMock = vi.fn();
vi.mock("@supabase/supabase-js", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { countShippedByAgents, readLandingStats, getLandingStats } from "./landing-stats";
import { logger } from "@/lib/logger";

describe("countShippedByAgents", () => {
  it("counts different agents and different Done cards once each", () => {
    const steps = [
      { task_id: "t1", bot_id: "a" },
      { task_id: "t1", bot_id: "b" },
      { task_id: "t2", bot_id: "a" },
    ];
    expect(countShippedByAgents(steps, new Set(["t1", "t2"]))).toEqual({ agents: 2, cards: 2 });
  });

  it("ignores steps with no agent", () => {
    const steps = [
      { task_id: "t1", bot_id: null },
      { task_id: "t2", bot_id: "a" },
    ];
    expect(countShippedByAgents(steps, new Set(["t1", "t2"]))).toEqual({ agents: 1, cards: 1 });
  });

  it("ignores cards that are not Done", () => {
    const steps = [{ task_id: "t1", bot_id: "a" }];
    expect(countShippedByAgents(steps, new Set())).toEqual({ agents: 1, cards: 0 });
  });

  it("handles empty input", () => {
    expect(countShippedByAgents([], new Set())).toEqual({ agents: 0, cards: 0 });
  });
});

/** A fake client whose queries resolve per table; pages are served for .range(). */
function fakeDb(tables: Record<string, { rows?: unknown[]; error?: string }>) {
  return {
    from(table: string) {
      const t = tables[table];
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      for (const m of ["select", "eq", "not", "order"]) chain[m] = self;
      chain.range = (from: number, to: number) =>
        Promise.resolve(
          t.error
            ? { data: null, error: { message: t.error } }
            : { data: (t.rows ?? []).slice(from, to + 1), error: null }
        );
      // board_columns has no .range(): awaiting the chain resolves it
      chain.then = (res: (v: unknown) => unknown) =>
        Promise.resolve(
          t.error
            ? { data: null, error: { message: t.error } }
            : { data: t.rows ?? [], error: null }
        ).then(res);
      return chain;
    },
  } as never;
}

describe("readLandingStats", () => {
  it("reads every page of cards and steps", async () => {
    const tasks = Array.from({ length: 1500 }, (_, i) => ({ id: `t${i}`, column_id: "done" }));
    const steps = Array.from({ length: 2500 }, (_, i) => ({
      task_id: `t${i % 1500}`,
      bot_id: `bot${i % 7}`,
    }));
    const db = fakeDb({
      board_columns: { rows: [{ id: "done" }] },
      board_tasks: { rows: tasks },
      task_workflow_steps: { rows: steps },
    });
    // 1,500 cards need two pages; 2,500 steps need three.
    expect(await readLandingStats(db)).toEqual({ agents: 7, cards: 1500 });
  });

  it("only counts cards in a Done column", async () => {
    const db = fakeDb({
      board_columns: { rows: [{ id: "done" }] },
      board_tasks: {
        rows: [
          { id: "t1", column_id: "done" },
          { id: "t2", column_id: "todo" },
        ],
      },
      task_workflow_steps: {
        rows: [
          { task_id: "t1", bot_id: "a" },
          { task_id: "t2", bot_id: "a" },
        ],
      },
    });
    expect(await readLandingStats(db)).toEqual({ agents: 1, cards: 1 });
  });

  it("throws when a read fails so the failure is not cached", async () => {
    const db = fakeDb({
      board_columns: { rows: [{ id: "done" }] },
      board_tasks: { error: "boom" },
      task_workflow_steps: { rows: [] },
    });
    await expect(readLandingStats(db)).rejects.toThrow("boom");
  });
});

describe("getLandingStats", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    createClientMock.mockReset();
    vi.mocked(logger.warn).mockClear();
  });

  it("returns null when the settings are blank", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "   ");
    expect(await getLandingStats()).toBeNull();
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("returns null and logs when the read fails", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "key");
    createClientMock.mockReturnValue(
      fakeDb({ board_columns: { error: "down" }, board_tasks: {}, task_workflow_steps: {} })
    );
    expect(await getLandingStats()).toBeNull();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("returns the numbers when the read works", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "key");
    createClientMock.mockReturnValue(
      fakeDb({
        board_columns: { rows: [{ id: "done" }] },
        board_tasks: { rows: [{ id: "t1", column_id: "done" }] },
        task_workflow_steps: { rows: [{ task_id: "t1", bot_id: "a" }] },
      })
    );
    expect(await getLandingStats()).toEqual({ agents: 1, cards: 1 });
  });
});
