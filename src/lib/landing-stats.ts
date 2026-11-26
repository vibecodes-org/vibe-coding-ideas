/**
 * Live numbers for the public front page: how many different AI agents have
 * finished a workflow step on the VibeCodes board, and how many of that board's
 * Done cards had at least one step finished by an agent.
 *
 * Server only. It uses the service-role key because anonymous visitors cannot
 * read board tables. Import it only from a server component (the `server-only`
 * package is not installed). Only two numbers ever leave this file.
 */
import { unstable_cache } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { logger } from "@/lib/logger";

/** VibeCodes' own public board (same id as in .vibecodes/config). */
export const VIBECODES_BOARD_ID = "62e57071-3645-422f-96c0-b2042e39e6dd";

const PAGE_SIZE = 1000;

export type LandingStats = { agents: number; cards: number };

export function countShippedByAgents(
  finishedSteps: { task_id: string; bot_id: string | null }[],
  doneTaskIds: Set<string>
): LandingStats {
  const agents = new Set<string>();
  const cards = new Set<string>();
  for (const step of finishedSteps) {
    if (!step.bot_id) continue;
    agents.add(step.bot_id);
    if (doneTaskIds.has(step.task_id)) cards.add(step.task_id);
  }
  return { agents: agents.size, cards: cards.size };
}

type Db = ReturnType<typeof createClient<Database>>;

/** Reads every row of a query, 1,000 at a time (a single read stops at 1,000). */
async function readAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const got = data ?? [];
    rows.push(...got);
    if (got.length < PAGE_SIZE) return rows;
  }
}

/** Throws on any read error so a failure is never cached. */
export async function readLandingStats(db: Db): Promise<LandingStats> {
  const { data: doneCols, error: colErr } = await db
    .from("board_columns")
    .select("id")
    .eq("idea_id", VIBECODES_BOARD_ID)
    .eq("is_done_column", true);
  if (colErr) throw new Error(colErr.message);
  const doneColumnIds = new Set((doneCols ?? []).map((c) => c.id));

  const doneTasks = await readAll<{ id: string; column_id: string }>((from, to) =>
    db
      .from("board_tasks")
      .select("id, column_id")
      .eq("idea_id", VIBECODES_BOARD_ID)
      .order("id")
      .range(from, to)
  );
  const doneTaskIds = new Set(
    doneTasks.filter((t) => doneColumnIds.has(t.column_id)).map((t) => t.id)
  );

  const steps = await readAll<{ task_id: string; bot_id: string | null }>((from, to) =>
    db
      .from("task_workflow_steps")
      .select("task_id, bot_id")
      .eq("idea_id", VIBECODES_BOARD_ID)
      .eq("status", "completed")
      .not("bot_id", "is", null)
      .order("id")
      .range(from, to)
  );

  return countShippedByAgents(steps, doneTaskIds);
}

const cachedStats = unstable_cache(
  async (url: string, key: string) => readLandingStats(createClient<Database>(url, key)),
  ["landing-stats-v1"],
  { revalidate: 3600 }
);

/** Returns null (never throws) when the settings are blank or the read fails. */
export async function getLandingStats(): Promise<LandingStats | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  try {
    return await cachedStats(url, key);
  } catch (err) {
    logger.warn("Landing stats read failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
