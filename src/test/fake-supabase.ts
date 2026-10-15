import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// A table-driven stand-in for a Supabase client: each table has a handler that
// answers a call, and every call is recorded so a test can assert what was
// written. Filters (eq, in, order, limit...) are recorded, not applied.

export type FakeResult = { data?: unknown; error?: { message: string } | null };
export type FakeCall = {
  table: string;
  op: "select" | "insert" | "update" | "upsert" | "delete";
  payload?: unknown;
  filters: [string, unknown][];
};

export function fakeSupabase(opts: {
  tables?: Record<string, (call: FakeCall) => FakeResult>;
  rpc?: (name: string, args: Record<string, unknown>) => FakeResult;
}) {
  const calls: FakeCall[] = [];
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];

  function from(table: string) {
    const call: FakeCall = { table, op: "select", filters: [] };
    const chain: Record<string, unknown> = {};
    const result = (): FakeResult => {
      calls.push(call);
      return opts.tables?.[table]?.(call) ?? { data: null, error: null };
    };
    for (const op of ["select", "insert", "update", "upsert", "delete"] as const) {
      chain[op] = (payload?: unknown) => {
        // `.insert(x).select()` stays an insert: only write verbs set the op.
        if (op !== "select") {
          call.op = op;
          call.payload = payload;
        }
        return chain;
      };
    }
    for (const filter of ["eq", "neq", "in", "ilike", "is", "not", "order", "limit", "or", "lt", "gte"]) {
      chain[filter] = (...args: unknown[]) => {
        call.filters.push([filter, args.length > 1 ? args : args[0]]);
        return chain;
      };
    }
    chain.maybeSingle = () => Promise.resolve(result());
    chain.single = () => Promise.resolve(result());
    chain.then = (resolve: (v: FakeResult) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result()).then(resolve, reject);
    return chain;
  }

  const client = {
    from,
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return Promise.resolve(opts.rpc?.(name, args) ?? { data: null, error: null });
    },
  } as unknown as SupabaseClient<Database>;

  return {
    client,
    calls,
    rpcCalls,
    writesTo: (table: string, op: FakeCall["op"]) => calls.filter((c) => c.table === table && c.op === op),
  };
}
