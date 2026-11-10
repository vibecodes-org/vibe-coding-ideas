import { describe, it, expect, vi } from "vitest";
import type { McpContext } from "../context";
import { createBot, createBotSchema } from "./bots";
import { importAgentSkill, importAgentSkillSchema } from "./agent-skill";

// Card 5d8274fe, fixes 1 and 2 (MCP side).

const USER_ID = "00000000-0000-4000-a000-000000000001";
const BOT_ID = "00000000-0000-4000-a000-000000000002";

/** A query chain that resolves to `result`, recording every update payload. */
function chain(result: { data?: unknown; error?: { message: string } | null }, updates: unknown[] = []) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "insert", "order", "limit", "or", "filter"]) c[m] = vi.fn(() => c);
  c.update = vi.fn((p: unknown) => {
    updates.push(p);
    return c;
  });
  c.single = vi.fn(() => Promise.resolve({ data: { id: BOT_ID }, error: null }));
  c.maybeSingle = vi.fn(() => Promise.resolve({ data: { id: BOT_ID, name: "Lens" }, error: null }));
  c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve({ data: null, error: null, ...result }).then(res, rej);
  return c;
}

function ctxWith(table: unknown): McpContext {
  return {
    supabase: {
      from: vi.fn(() => table),
      rpc: vi.fn(() => Promise.resolve({ data: BOT_ID, error: null })),
    } as unknown as McpContext["supabase"],
    userId: USER_ID,
  };
}

describe("create_agent", () => {
  it("throws when the follow-up update fails, so Read-only can't silently not stick", async () => {
    const ctx = ctxWith(chain({ error: { message: "update failed" } }));
    await expect(
      createBot(ctx, createBotSchema.parse({ name: "Lens", tool_access: "read_only" })),
    ).rejects.toThrow("update failed");
  });
});

describe("import_agent_skill", () => {
  const md = (extra: string[]) =>
    ["---", "name: lens", "description: Code Reviewer agent", ...extra, "---", "", "Review it."].join("\n");

  it("throws when the follow-up update on a new agent fails", async () => {
    const ctx = ctxWith(chain({ error: { message: "update failed" } }));
    await expect(
      importAgentSkill(ctx, importAgentSkillSchema.parse({ skill_md_content: md(["disallowedTools: Edit"]) })),
    ).rejects.toThrow("update failed");
  });

  it("does not reset an existing agent's tool access for a mistyped value", async () => {
    const updates: unknown[] = [];
    const ctx = ctxWith(chain({}, updates));
    const file = md(["metadata:", "  source: vibecodes", `  source_id: ${BOT_ID}`, "  tool_access: readonly"]);
    await importAgentSkill(ctx, importAgentSkillSchema.parse({ skill_md_content: file }));
    expect(updates[0]).not.toHaveProperty("tool_access");
  });
});
