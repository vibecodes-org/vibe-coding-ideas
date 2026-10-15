// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

// The three per-row checks are defence in depth: real prompts rarely fail them.
// Here the word-loss check is forced to fail so the run's reaction is pinned: a
// failed row is reported, never written, and doesn't stop the others.
vi.mock("./agent-instructions", async (importOriginal) => {
  const real = await importOriginal<typeof import("./agent-instructions")>();
  return {
    ...real,
    verifyConversion: (old: string) =>
      old.includes("FAIL-ME") ? { ok: false as const, reason: "3 word(s) lost in conversion" } : { ok: true as const },
  };
});

import { apply, formatReport, type ConversionStore } from "./agent-layout-conversion";

const GOOD = "## Goal\nShip it. Fast.\n\n## Approach\nBe careful.";
const BAD = "## Goal\nShip it. FAIL-ME.\n\n## Approach\nBe careful.";

function store() {
  const rows: { id: string; owner_id: string; name: string; role: string; system_prompt: string | null; updated_at: string }[] = [
    { id: "good", owner_id: "o", name: "n", role: "R", system_prompt: GOOD, updated_at: "t1" },
    { id: "bad", owner_id: "o", name: "n", role: "R", system_prompt: BAD, updated_at: "t1" },
  ];
  const writes: string[] = [];
  const s: ConversionStore = {
    listAgents: async () => rows.map((r) => ({ ...r })),
    listBackups: async () => rows.map((r) => ({ bot_id: r.id, system_prompt: r.system_prompt, backed_up_at: "t0" })),
    insertBackup: async () => {},
    setPrompt: async (id, text) => {
      writes.push(id);
      rows.find((r) => r.id === id)!.system_prompt = text;
      return true;
    },
  };
  return { s, rows, writes };
}

describe("apply — a row that fails the checks", () => {
  it("is reported as failed and left untouched, while the others convert", async () => {
    const { s, rows, writes } = store();
    const report = await apply(s);

    expect(writes).toEqual(["good"]);
    expect(rows.find((r) => r.id === "bad")!.system_prompt).toBe(BAD);
    expect(report.counts).toMatchObject({ converted: 1, failed: 1 });
    expect(report.rows.find((r) => r.id === "bad")).toMatchObject({
      status: "failed",
      reason: "3 word(s) lost in conversion",
    });
  });

  it("names the failure by id and reason, never the text", async () => {
    const { s } = store();
    const lines = formatReport(await apply(s)).join("\n");
    expect(lines).toContain("failed bad [other, legacy,");
    expect(lines).not.toContain("FAIL-ME");
  });
});

