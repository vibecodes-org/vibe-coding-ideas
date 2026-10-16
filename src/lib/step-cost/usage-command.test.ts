import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stepUsageCommand, USAGE_COMMAND_PLACEHOLDER } from "./usage-command";

// One transcript line per content block, shaped like Claude Code 2.1.300's.
function line(o: { id: string; model: string; block: object; input?: number; read?: number; write?: number; write1h?: number; out?: number }) {
  return JSON.stringify({
    parentUuid: "p", isSidechain: true, agentId: "x",
    message: {
      model: o.model, id: o.id, type: "message", role: "assistant",
      content: [o.block], container: null, stop_reason: null, stop_sequence: null,
      usage: {
        input_tokens: o.input ?? 2, cache_creation_input_tokens: o.write ?? 0, cache_read_input_tokens: o.read ?? 0,
        cache_creation: { ephemeral_5m_input_tokens: (o.write ?? 0) - (o.write1h ?? 0), ephemeral_1h_input_tokens: o.write1h ?? 0 },
        output_tokens: o.out ?? 3, service_tier: "standard",
      },
    },
    type: "assistant", uuid: "u", timestamp: "2026-10-15T00:00:00Z",
  });
}
const userLine = JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", content: '"type":"assistant" "usage":{"input_tokens":999999}' }] } });

function sandbox(files: Record<string, string[]>) {
  const root = mkdtempSync(join(tmpdir(), "step-usage-"));
  const dir = join(root, "projects", "-repo", "session-1", "subagents");
  mkdirSync(dir, { recursive: true });
  for (const [id, lines] of Object.entries(files)) writeFileSync(join(dir, `agent-${id}.jsonl`), lines.join("\n") + "\n");
  return root;
}

function run(root: string, ids: string, shell = "bash") {
  const r = spawnSync(shell, ["-c", stepUsageCommand(ids)], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", HOME: join(root, "nohome"), CLAUDE_CONFIG_DIR: root, NODE_ENV: "test" as const },
  });
  return r.stdout.trim();
}

const text = (t: string) => ({ type: "text", text: t });

describe("stepUsageCommand", () => {
  it("leaves the placeholder in by default", () => {
    expect(stepUsageCommand()).toContain(`ids='${USAGE_COMMAND_PLACEHOLDER}'`);
  });

  it("totals each call once per model and keeps exact input/cache counts", () => {
    const root = sandbox({
      a1: [
        line({ id: "msg_1", model: "claude-opus-5-5", block: { type: "thinking", thinking: "", signature: "S".repeat(4000) }, read: 1000, write: 500, write1h: 100 }),
        line({ id: "msg_1", model: "claude-opus-5-5", block: { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "x".repeat(700) } }, read: 1000, write: 500, write1h: 100 }),
        userLine,
        line({ id: "msg_2", model: "claude-opus-5-5", block: text("y".repeat(350)), read: 2000, write: 50 }),
      ],
    });
    try {
      const out = JSON.parse(run(root, "a1"));
      expect(out.output_estimated).toBe(true);
      expect(out.models).toHaveLength(1);
      const m = out.models[0];
      expect(m).toMatchObject({ model: "claude-opus-5-5", calls: 2, input_tokens: 4, cache_read_tokens: 3000, cache_write_5m_tokens: 450, cache_write_1h_tokens: 100 });
      // ~700 + ~350 characters written, at 3.5 a token; the 4,000-character signature isn't counted.
      expect(m.output_tokens).toBeGreaterThan(290);
      expect(m.output_tokens).toBeLessThan(340);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("sums several agents and splits by model, pricing big Haiku prompts separately", () => {
    const root = sandbox({
      a1: [line({ id: "msg_1", model: "claude-sonnet-5-5", block: text("hi"), write: 100 })],
      a2: [
        line({ id: "msg_2", model: "claude-haiku-5-5", block: text("hi"), read: 150000 }),
        line({ id: "msg_3", model: "claude-haiku-5-5", block: text("hi"), read: 10 }),
      ],
    });
    try {
      const models = JSON.parse(run(root, "a1 a2")).models as { model: string; calls: number }[];
      expect(models.map((m) => `${m.model}:${m.calls}`).sort()).toEqual(["claude-haiku-5-5+long:1", "claude-haiku-5-5:1", "claude-sonnet-5-5:1"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("uses the reported output count when it is larger than the estimate", () => {
    const root = sandbox({ a1: [line({ id: "msg_1", model: "claude-opus-5-5", block: text("hi"), out: 5000 })] });
    try {
      expect(JSON.parse(run(root, "a1")).models[0].output_tokens).toBe(5000);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("says NO_TRANSCRIPT for an unknown, unsafe or missing agent id, and never runs it", () => {
    const root = sandbox({ a1: [line({ id: "msg_1", model: "claude-opus-5-5", block: text("hi") })] });
    try {
      expect(run(root, "nope")).toBe("NO_TRANSCRIPT nope");
      expect(run(root, "a1 nope")).toBe("NO_TRANSCRIPT nope");
      expect(run(root, "$(touch pwned)")).toMatch(/^NO_TRANSCRIPT/);
      expect(run(root, "")).toBe("NO_TRANSCRIPT");
      expect(run(root, USAGE_COMMAND_PLACEHOLDER)).toBe("NO_TRANSCRIPT AGENT_ID");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("says NO_TRANSCRIPT when the transcript holds no real model call (a subagent that died on an API error)", () => {
    const synthetic = JSON.stringify({ type: "assistant", message: { model: "<synthetic>", id: "f0e1d2", role: "assistant", content: [text("API Error: overloaded")], usage: { input_tokens: 0, output_tokens: 0 } } });
    const root = sandbox({ a1: [synthetic, userLine] });
    try {
      expect(run(root, "a1")).toBe("NO_TRANSCRIPT");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  const hasZsh = spawnSync("zsh", ["-c", "true"]).status === 0;
  it.skipIf(!hasZsh)("gives the same answer under zsh, several agent ids included", () => {
    const root = sandbox({
      a1: [line({ id: "msg_1", model: "claude-opus-5-5", block: text("z".repeat(70)), read: 10 })],
      a2: [line({ id: "msg_2", model: "claude-opus-5-5", block: text("z".repeat(70)), read: 20 })],
    });
    try {
      expect(run(root, "a1", "zsh")).toBe(run(root, "a1", "bash"));
      expect(run(root, "a1 a2", "zsh")).toBe(run(root, "a1 a2", "bash"));
      expect(JSON.parse(run(root, "a1 a2", "zsh")).models[0].calls).toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
