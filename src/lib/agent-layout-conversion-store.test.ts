// @vitest-environment node
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { createSupabaseConversionStore } from "./agent-layout-conversion-store";

type Call = { table: string; verb: string; payload?: unknown; filters: [string, unknown[]][]; range?: [number, number] };

/** A recording stand-in for the client chain the store uses (select/order/range/eq/insert/update). */
function fakeClient(answer: (c: Call) => { data?: unknown; error?: { message: string } | null }) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, verb: "select", filters: [] };
      const chain: Record<string, unknown> = {};
      for (const verb of ["insert", "update"] as const) {
        chain[verb] = (payload: unknown) => {
          call.verb = verb;
          call.payload = payload;
          return chain;
        };
      }
      chain.select = () => chain;
      chain.order = (...args: unknown[]) => (call.filters.push(["order", args]), chain);
      chain.eq = (...args: unknown[]) => (call.filters.push(["eq", args]), chain);
      chain.range = (from: number, to: number) => ((call.range = [from, to]), chain);
      chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
        calls.push(call);
        return Promise.resolve({ error: null, ...answer(call) }).then(resolve, reject);
      };
      return chain;
    },
  } as unknown as SupabaseClient<Database>;
  return { client, calls };
}

describe("createSupabaseConversionStore", () => {
  it("reads agents in pages until a short page", async () => {
    const full = Array.from({ length: 500 }, (_, i) => ({ id: `a${i}` }));
    const { client, calls } = fakeClient((c) => ({ data: c.range?.[0] === 0 ? full : [{ id: "last" }] }));
    const rows = await createSupabaseConversionStore(client).listAgents();

    expect(rows).toHaveLength(501);
    expect(calls.map((c) => c.range)).toEqual([[0, 499], [500, 999]]);
  });

  it("reads backups for one reason only", async () => {
    const { client, calls } = fakeClient(() => ({ data: [] }));
    await createSupabaseConversionStore(client).listBackups("pre-layout-conversion-00186");

    expect(calls[0].table).toBe("bot_profile_prompt_backups");
    expect(calls[0].filters).toContainEqual(["eq", ["reason", "pre-layout-conversion-00186"]]);
  });

  it("updates compare-and-set on updated_at and reports whether a row changed", async () => {
    const hit = fakeClient(() => ({ data: [{ id: "a1" }] }));
    expect(await createSupabaseConversionStore(hit.client).setPrompt("a1", "new", "t1")).toBe(true);
    expect(hit.calls[0].payload).toEqual({ system_prompt: "new" });
    expect(hit.calls[0].filters).toEqual(expect.arrayContaining([["eq", ["id", "a1"]], ["eq", ["updated_at", "t1"]]]));

    const miss = fakeClient(() => ({ data: [] }));
    expect(await createSupabaseConversionStore(miss.client).setPrompt("a1", "new", "stale")).toBe(false);
  });

  it("throws on a database error, without echoing any prompt text", async () => {
    const { client } = fakeClient(() => ({ data: null, error: { message: "boom" } }));
    const store = createSupabaseConversionStore(client);

    await expect(store.listAgents()).rejects.toThrow("Reading agents failed: boom");
    await expect(store.setPrompt("a1", "SECRET TEXT", "t")).rejects.toThrow("Updating a1 failed: boom");
    await expect(
      store.insertBackup({ bot_id: "a1", name: null, role: null, system_prompt: "SECRET TEXT", reason: "r" }),
    ).rejects.toThrow(/Writing a backup for a1 failed: boom$/);
  });
});
