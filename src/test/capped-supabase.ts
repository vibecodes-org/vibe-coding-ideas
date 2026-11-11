import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// A stand-in for a Supabase client that behaves like the real API where it
// matters for paging: every select answers with AT MOST 1,000 rows and no error
// (the server's `max-rows`), unless `.range()` asks for a later slice. Filters
// eq / in / order / range / limit are applied to in-memory rows; embedded joins
// in select() are ignored (rows come back as stored).

export const SERVER_MAX_ROWS = 1000;
type Row = Record<string, unknown>;

export function cappedSupabase(tables: Record<string, Row[]>) {
  const requests: { table: string; range: [number, number] | null }[] = [];

  function from(table: string) {
    const eqs: [string, unknown][] = [];
    const ins: [string, unknown[]][] = [];
    const orders: string[] = [];
    let range: [number, number] | null = null;
    let limit: number | null = null;
    const chain: Record<string, unknown> = {};
    const run = () => {
      requests.push({ table, range });
      let rows = (tables[table] ?? []).filter(
        (r) => eqs.every(([c, v]) => r[c] === v) && ins.every(([c, vs]) => vs.includes(r[c]))
      );
      rows = [...rows].sort((a, b) => {
        for (const col of orders) {
          const x = a[col] as string | number;
          const y = b[col] as string | number;
          if (x < y) return -1;
          if (x > y) return 1;
        }
        return 0;
      });
      const start = range ? range[0] : 0;
      const end = range ? range[1] + 1 : rows.length;
      let slice = rows.slice(start, end);
      if (limit !== null) slice = slice.slice(0, limit);
      return { data: slice.slice(0, SERVER_MAX_ROWS), error: null };
    };
    chain.select = () => chain;
    chain.eq = (c: string, v: unknown) => (eqs.push([c, v]), chain);
    chain.in = (c: string, vs: unknown[]) => (ins.push([c, vs]), chain);
    chain.order = (c: string) => (orders.push(c), chain);
    chain.range = (a: number, b: number) => ((range = [a, b]), chain);
    chain.limit = (n: number) => ((limit = n), chain);
    chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(run()).then(resolve, reject);
    return chain;
  }

  return { client: { from } as unknown as SupabaseClient<Database>, requests };
}
