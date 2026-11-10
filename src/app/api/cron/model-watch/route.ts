import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";
import { AI_MODEL, getPlatformAnthropicProvider } from "@/lib/ai-helpers";
import {
  buildModelWatchCard,
  escapeLike,
  modelWatchTitlePrefix,
  pickNewestSonnet,
  shouldTestDrive,
  type AnthropicModel,
  type ModelWatchState,
} from "@/lib/model-watch";
import { runModelChecks } from "@/lib/model-watch-checks";
import type { Database } from "@/types/database";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// This repo's own board (already public in CLAUDE.md). The "switch?" card goes here.
const MODEL_WATCH_IDEA_ID = "62e57071-3645-422f-96c0-b2042e39e6dd";
const SETTINGS_KEY = "model_watch";

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

async function listModels(apiKey: string): Promise<AnthropicModel[]> {
  const out: AnthropicModel[] = [];
  let afterId: string | undefined;
  for (let page = 0; page < 20; page++) {
    const url = new URL("https://api.anthropic.com/v1/models");
    url.searchParams.set("limit", "1000");
    if (afterId) url.searchParams.set("after_id", afterId);
    const res = await fetch(url, {
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    });
    if (!res.ok) {
      throw new Error(`Models API returned ${res.status}`);
    }
    const body = (await res.json()) as {
      data?: AnthropicModel[];
      has_more?: boolean;
      last_id?: string;
    };
    out.push(...(body.data ?? []));
    if (!body.has_more || !body.last_id) break;
    afterId = body.last_id;
  }
  return out;
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    logger.error("CRON_SECRET not configured; model-watch refusing to run");
    return json({ error: "Cron secret not configured" }, 503);
  }
  const header = request.headers.get("authorization") ?? "";
  if (!safeEqual(header, `Bearer ${secret}`)) {
    return json({ error: "Unauthorized" }, 401);
  }

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!apiKey || !url || !serviceKey) {
      throw new Error("Model watch is missing platform configuration");
    }
    const supabase = createClient<Database>(url, serviceKey);

    const models = await listModels(apiKey);

    const { data: row, error: readError } = await supabase
      .from("platform_settings")
      .select("value")
      .eq("key", SETTINGS_KEY)
      .maybeSingle();
    if (readError) throw new Error(`Reading settings failed: ${readError.message}`);
    const stored = (row?.value ?? null) as Partial<ModelWatchState> | null;
    const seen = Array.isArray(stored?.seen) ? stored.seen : [];

    const saveState = async (nextSeen: string[]) => {
      const { error } = await supabase.from("platform_settings").upsert({
        key: SETTINGS_KEY,
        value: { seen: nextSeen, last_checked_at: new Date().toISOString() },
        updated_at: new Date().toISOString(),
      });
      if (error) throw new Error(`Saving settings failed: ${error.message}`);
    };

    const candidate = pickNewestSonnet(models);

    if (!candidate || !shouldTestDrive(candidate, AI_MODEL, models, seen)) {
      // First run with nothing recorded: remember the model in use silently.
      const nextSeen =
        !row && candidate && candidate.id === AI_MODEL ? [candidate.id] : seen;
      await saveState(nextSeen);
      return json({ action: "none" });
    }

    // Guard against a double fire: a card for this model may already exist.
    // Match the exact start of the title the job writes ("Sonnet <version> is out").
    const titlePattern = `${escapeLike(modelWatchTitlePrefix(candidate))}%`;
    const cardExists = async (): Promise<boolean> => {
      const { data, error } = await supabase
        .from("board_tasks")
        .select("id")
        .eq("idea_id", MODEL_WATCH_IDEA_ID)
        .ilike("title", titlePattern)
        .limit(1);
      if (error) throw new Error(`Duplicate check failed: ${error.message}`);
      return !!data && data.length > 0;
    };
    if (await cardExists()) {
      await saveState([...seen, candidate.id]);
      return json({ action: "none", reason: "card already exists" });
    }

    const results = await runModelChecks(getPlatformAnthropicProvider(), candidate.id);
    const card = buildModelWatchCard({
      model: candidate,
      results,
      currentModel: AI_MODEL,
    });

    const { data: columns, error: colError } = await supabase
      .from("board_columns")
      .select("id, title, is_done_column, position")
      .eq("idea_id", MODEL_WATCH_IDEA_ID)
      .order("position", { ascending: true });
    if (colError) throw new Error(`Reading columns failed: ${colError.message}`);
    const column =
      columns?.find((c) => c.title.trim().toLowerCase() === "to do") ??
      columns?.find((c) => !c.is_done_column);
    if (!column) throw new Error("No To Do column found on the board");

    const { data: top } = await supabase
      .from("board_tasks")
      .select("position")
      .eq("column_id", column.id)
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle();

    // Check again right before inserting: the test run takes a while, and a
    // second run may have created the card meanwhile.
    if (await cardExists()) {
      await saveState([...seen, candidate.id]);
      return json({ action: "none", reason: "card already exists" });
    }

    const { error: insertError } = await supabase.from("board_tasks").insert({
      idea_id: MODEL_WATCH_IDEA_ID,
      column_id: column.id,
      title: card.title,
      description: card.description,
      position: (top?.position ?? 1000) - 1000,
    });
    if (insertError) throw new Error(`Creating the card failed: ${insertError.message}`);

    await saveState([...seen, candidate.id]);
    const passed = results.every((r) => r.ok);
    logger.info("Model watch created a card", { model: candidate.id, passed });
    return json({ action: "card", model: candidate.id, passed });
  } catch (err) {
    logger.error("Model watch failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return json({ error: "Model watch failed" }, 500);
  }
}
