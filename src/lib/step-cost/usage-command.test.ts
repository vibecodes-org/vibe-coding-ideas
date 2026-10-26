import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newUsageMarker, stepUsageCommand, stepUsageScript, stepUsageShortCommand, STEP_USAGE_SCRIPT_FILE, USAGE_COMMAND_PLACEHOLDER } from "./usage-command";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

// One transcript line per content block, shaped like Claude Code 2.1.300's.
function line(o: { id: string; model: string; block: object; input?: number; read?: number; write?: number; write1h?: number; out?: number; main?: boolean }) {
  return JSON.stringify({
    parentUuid: "p", isSidechain: !o.main, ...(o.main ? {} : { agentId: "x" }),
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

const MARK = "vcu_0123456789abcdef01234567";
/** The claim_next_step result as the session transcript records it: the marker sits inside usage_command. */
const claimLine = JSON.stringify({
  type: "user", isSidechain: false,
  message: { role: "user", content: [{ type: "tool_result", content: [{ type: "text", text: `{"done":false,"usage_command":"(\\nmark='${MARK}'"}` }] }] },
});

function sandbox(files: Record<string, string[]>, main?: string[]) {
  const root = mkdtempSync(join(tmpdir(), "step-usage-"));
  const project = join(root, "projects", "-repo");
  const dir = join(project, "session-1", "subagents");
  mkdirSync(dir, { recursive: true });
  for (const [id, lines] of Object.entries(files)) writeFileSync(join(dir, `agent-${id}.jsonl`), lines.join("\n") + "\n");
  if (main) writeFileSync(join(project, "session-1.jsonl"), main.join("\n") + "\n");
  return root;
}

function run(root: string, ids: string, shell = "bash") {
  return runCommand(root, stepUsageCommand(MARK, ids), shell);
}

function runCommand(root: string, command: string, shell = "bash") {
  const r = spawnSync(shell, ["-c", command], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", HOME: join(root, "nohome"), CLAUDE_CONFIG_DIR: root, NODE_ENV: "test" as const },
  });
  return r.stdout.trim();
}

const text = (t: string) => ({ type: "text", text: t });

describe("stepUsageCommand", () => {
  it("leaves the placeholder in by default, once, and only takes a well-formed marker", () => {
    const command = stepUsageCommand(newUsageMarker());
    expect(command).toContain(`ids='${USAGE_COMMAND_PLACEHOLDER}'`);
    expect(command.split(USAGE_COMMAND_PLACEHOLDER)).toHaveLength(2);
    expect(newUsageMarker()).not.toBe(newUsageMarker());
    expect(() => stepUsageCommand("vcu_'; rm -rf ~; '")).toThrow();
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
      // Unchanged means "I did the step myself": with no session transcript to read, nothing to report.
      expect(run(root, USAGE_COMMAND_PLACEHOLDER)).toBe("NO_TRANSCRIPT");
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

  // The session's own calls: the step's whole cost when it did the work itself.
  const mainBefore = line({ id: "msg_m0", model: "claude-opus-5-5", block: text("before the claim"), read: 999_000, main: true });
  const mainAfter = [
    line({ id: "msg_m1", model: "claude-opus-5-5", block: text("x".repeat(35)), read: 1000, main: true }),
    line({ id: "msg_m2", model: "claude-opus-5-5", block: text("x".repeat(35)), read: 2000, main: true }),
  ];

  it("counts the session's own calls after the claim when it ran the command unchanged", () => {
    const root = sandbox({}, [mainBefore, claimLine, userLine, ...mainAfter]);
    try {
      const out = JSON.parse(run(root, USAGE_COMMAND_PLACEHOLDER));
      expect(out.models).toEqual([expect.objectContaining({ model: "claude-opus-5-5", calls: 2, cache_read_tokens: 3000 })]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("adds the subagents' calls to the session's, even when every AGENT_ID in the command is replaced", () => {
    const root = sandbox(
      { a1: [line({ id: "msg_1", model: "claude-sonnet-5-5", block: text("hi"), read: 500 })] },
      [mainBefore, claimLine, ...mainAfter]
    );
    try {
      const command = stepUsageCommand(MARK).replaceAll(USAGE_COMMAND_PLACEHOLDER, "a1");
      const models = JSON.parse(runCommand(root, command)).models as { model: string; cache_read_tokens: number }[];
      expect(models.map((m) => `${m.model}:${m.cache_read_tokens}`).sort()).toEqual(["claude-opus-5-5:3000", "claude-sonnet-5-5:500"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reads the newest transcript holding the marker when a forked session repeats the claim", () => {
    const root = sandbox({}, [mainBefore, claimLine, mainAfter[0]]);
    const forked = join(root, "projects", "-repo", "session-2.jsonl");
    writeFileSync(forked, [mainBefore, claimLine, ...mainAfter].join("\n") + "\n");
    utimesSync(join(root, "projects", "-repo", "session-1.jsonl"), new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
    try {
      expect(JSON.parse(run(root, USAGE_COMMAND_PLACEHOLDER)).models[0].calls).toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("ignores a session transcript without this claim's marker", () => {
    const root = sandbox({}, [mainBefore, ...mainAfter]);
    try {
      expect(run(root, USAGE_COMMAND_PLACEHOLDER)).toBe("NO_TRANSCRIPT");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // Card 5e654dd1, stage 16: one session holding several claims at once.
  const MARK2 = "vcu_fedcba9876543210fedcba98";
  const claim2 = claimLine.replace(MARK, MARK2);
  const runUsage = (id: string, mark: string, read: number) =>
    line({ id, model: "claude-opus-5-5", block: { type: "tool_use", id: `toolu_${id}`, name: "Bash", input: { command: `sh f '${mark}' 'AGENT_ID'` } }, read, main: true });
  const call = (id: string, read: number) => line({ id, model: "claude-opus-5-5", block: text("x".repeat(35)), read, main: true });

  it("splits the session's own calls across the steps open at the time, and stops at this step's usage run", () => {
    const root = sandbox({}, [
      mainBefore, claimLine, call("msg_a", 1000), claim2, call("msg_b", 2000), call("msg_c", 4000),
      runUsage("msg_d", MARK2, 600), // the other step's cost run: shared, then that step is closed
      call("msg_e", 8000),
      runUsage("msg_f", MARK, 100), // this step's own run: counted, and nothing after it
      call("msg_g", 900_000),
    ]);
    try {
      const m = JSON.parse(run(root, USAGE_COMMAND_PLACEHOLDER)).models[0];
      // 1000 alone, then 2000 + 4000 + 600 split two ways, then 8000 + 100 alone.
      expect(m.cache_read_tokens).toBe(1000 + 1000 + 2000 + 300 + 8000 + 100);
      expect(m.calls).toBe(5); // 1 + 0.5 * 3 + 2 = 4.5, rounded
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("shares calls with a step claimed before this one and still open", () => {
    const root = sandbox({}, [claim2, call("msg_a", 50_000), claimLine, call("msg_b", 2000), runUsage("msg_c", MARK, 1000)]);
    try {
      expect(JSON.parse(run(root, USAGE_COMMAND_PLACEHOLDER)).models[0].cache_read_tokens).toBe(1500);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("still counts subagent calls in full while other steps are open", () => {
    const root = sandbox(
      { a1: [line({ id: "msg_s", model: "claude-sonnet-5-5", block: text("hi"), read: 500 })] },
      [claimLine, claim2, call("msg_a", 2000)],
    );
    try {
      const models = JSON.parse(run(root, "a1")).models as { model: string; cache_read_tokens: number }[];
      expect(models.map((m) => `${m.model}:${m.cache_read_tokens}`).sort()).toEqual(["claude-opus-5-5:1000", "claude-sonnet-5-5:500"]);
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
    const inline = sandbox({}, [mainBefore, claimLine, ...mainAfter]);
    try {
      expect(run(inline, USAGE_COMMAND_PLACEHOLDER, "zsh")).toBe(run(inline, USAGE_COMMAND_PLACEHOLDER, "bash"));
      expect(JSON.parse(run(inline, USAGE_COMMAND_PLACEHOLDER, "zsh")).models[0].calls).toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// Card 5e654dd1, stage 2b: the script the helper saves, and the short command
// that runs it.
describe("saved step-usage script and the short command", () => {
  const { file, body } = stepUsageScript();

  const mainAfterClaim = [
    line({ id: "msg_m1", model: "claude-opus-5-5", block: text("x".repeat(35)), read: 1000, main: true }),
    line({ id: "msg_m2", model: "claude-opus-5-5", block: text("x".repeat(35)), read: 2000, main: true }),
  ];

  function withScript(contents: string | null) {
    const root = sandbox({ a1: [line({ id: "msg_1", model: "claude-opus-5-5", block: text("s".repeat(70)), read: 10, out: 4 })] }, [claimLine, ...mainAfterClaim]);
    if (contents !== null) {
      mkdirSync(join(root, "vibecodes"), { recursive: true });
      writeFileSync(join(root, "vibecodes", file), contents);
    }
    return root;
  }

  it("names the file after its own text, and keeps to what the helper accepts", () => {
    expect(file).toMatch(STEP_USAGE_SCRIPT_FILE);
    expect(file).toBe(`step-usage-${createHash("sha256").update(body).digest("hex").slice(0, 8)}.sh`);
    expect(body.startsWith("#!/bin/sh\n")).toBe(true);
    expect(Buffer.byteLength(body)).toBeLessThan(16 * 1024);
    expect(stepUsageScript()).toEqual({ file, body });
  });

  it("the helper's own checks accept the real script (same file name rule, hash and size)", () => {
    const bridge = resolve(__dirname, "../../../terminal/bridge/src/step-usage-script.js");
    const r = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", `import { parseStepUsageScript } from ${JSON.stringify(bridge)}; const a = JSON.parse(process.argv[1]); process.stdout.write(JSON.stringify(parseStepUsageScript({ stepUsageScript: a })));`, JSON.stringify({ file, body })],
      { encoding: "utf8" },
    );
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ file, body });
  });

  it("the short command is about 200 characters and carries the marker, not the program", () => {
    const command = stepUsageShortCommand(MARK);
    expect(command.length).toBeLessThan(260);
    expect(command).toContain(MARK);
    expect(command).toContain(`ids='${USAGE_COMMAND_PLACEHOLDER}'`.replace("ids=", ""));
    expect(command).not.toContain("awk");
  });

  it("gives the same totals as the long command, with the placeholder and with real agent ids", () => {
    const root = withScript(body);
    try {
      expect(runCommand(root, stepUsageShortCommand(MARK))).toBe(runCommand(root, stepUsageCommand(MARK)));
      expect(runCommand(root, stepUsageShortCommand(MARK, file, "a1"))).toBe(runCommand(root, stepUsageCommand(MARK, "a1")));
      expect(JSON.parse(runCommand(root, stepUsageShortCommand(MARK, file, "a1"))).models[0].calls).toBeGreaterThan(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("prints NO_TRANSCRIPT no-script when the file is missing or empty (the step is never blocked)", () => {
    for (const contents of [null, ""]) {
      const root = withScript(contents);
      try {
        expect(runCommand(root, stepUsageShortCommand(MARK))).toBe("NO_TRANSCRIPT no-script");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it("falls back to the newest saved script when this version's file isn't there yet", () => {
    const root = withScript(null);
    try {
      mkdirSync(join(root, "vibecodes"), { recursive: true });
      writeFileSync(join(root, "vibecodes", "step-usage-00000000.sh"), body);
      expect(runCommand(root, stepUsageShortCommand(MARK))).toBe(runCommand(root, stepUsageCommand(MARK)));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses a bad marker or script name", () => {
    expect(() => stepUsageShortCommand("vcu_'; rm -rf ~; '")).toThrow();
    expect(() => stepUsageShortCommand(MARK, "../evil.sh")).toThrow();
    expect(() => stepUsageShortCommand(MARK, "step-usage-xyz.sh")).toThrow();
  });
});
