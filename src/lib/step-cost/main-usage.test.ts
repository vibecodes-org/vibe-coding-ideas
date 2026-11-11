// The main window's own usage (card f2a563ca): what is left of each main call
// after the workflow steps' share. Own + step share must be every call, once.
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mainWindowOwnUsage as scan } from "../../../terminal/shared/transcript-usage.mjs";
import { stepUsageCommand } from "./usage-command";

interface OwnUsage {
  hours: { hour: string; model: string; calls: number; input_tokens: number }[];
  stepIds: string[];
  firstCallAt: string | null;
  lastCallAt: string | null;
}
const mainWindowOwnUsage = (lines: string[]) => scan(lines) as unknown as OwnUsage;

const hex = (c: string, n: number) => c.repeat(n);
const CT1 = "ct_" + hex("a1", 24);
const CT2 = "ct_" + hex("b2", 24);
const MARK1 = "vcu_" + hex("0a", 12);
const MARK2 = "vcu_" + hex("0b", 12);
const STEP1 = "11111111-1111-4111-8111-111111111111";
const STEP2 = "22222222-2222-4222-8222-222222222222";

function call(id: string, ts: string, extra: Partial<{ block: object; main: boolean; model: string }> = {}) {
  return JSON.stringify({
    isSidechain: extra.main === false,
    message: {
      model: extra.model ?? "claude-opus-5-5", id, type: "message", role: "assistant",
      content: [extra.block ?? { type: "text", text: "x".repeat(70) }], stop_reason: null,
      usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 100, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 }, output_tokens: 1 },
    },
    type: "assistant", timestamp: ts,
  });
}
const claim = (mark: string, ct: string, stepId: string, ts: string) =>
  JSON.stringify({
    type: "user", isSidechain: false, timestamp: ts,
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_claim", content: [{ type: "text", text: JSON.stringify({ done: false, claim_token: ct, step: { id: stepId }, usage_command: `(\nmark='${mark}'` }) }] }] },
  });
const finishCall = (toolId: string, ct: string, ts: string) =>
  call("msg_fin_" + toolId, ts, { block: { type: "tool_use", id: toolId, name: "mcp__vibecodes__complete_step", input: { claim_token: ct } } });
const finishResult = (toolId: string, ts: string, error = false) =>
  JSON.stringify({ type: "user", isSidechain: false, timestamp: ts, message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolId, ...(error ? { is_error: true } : {}), content: "ok" }] } });

describe("mainWindowOwnUsage", () => {
  it("weighs calls before any claim, inside a step, with an unfinished overlap, and after the last step", () => {
    const lines = [
      call("msg_a", "2026-11-10T09:10:00Z"), // before any claim: own 1
      claim(MARK1, CT1, STEP1, "2026-11-10T09:20:00Z"),
      call("msg_b", "2026-11-10T09:30:00Z"), // inside step 1: own 0
      finishCall("toolu_1", CT1, "2026-11-10T09:40:00Z"), // the finishing call is still inside the step
      finishResult("toolu_1", "2026-11-10T09:41:00Z"),
      claim(MARK2, CT2, STEP2, "2026-11-10T10:05:00Z"), // never finishes
      call("msg_c", "2026-11-10T10:10:00Z"), // inside step 2 (never finished): own 1 (the claim doesn't close)
      call("msg_d", "2026-11-10T10:20:00Z"),
    ];
    const r = mainWindowOwnUsage(lines);
    const byHour = new Map(r.hours.map((h: { hour: string; calls: number }) => [h.hour, h.calls]));
    expect(byHour.get("2026-11-10T09:00:00.000Z")).toBe(1); // only msg_a; msg_b and the finish call belong to the step
    expect(byHour.get("2026-11-10T10:00:00.000Z")).toBe(2); // msg_c and msg_d: an unfinished claim takes nothing
    expect(r.stepIds).toEqual([STEP1]);
    expect(r.firstCallAt).toBe("2026-11-10T09:10:00Z");
    expect(r.lastCallAt).toBe("2026-11-10T10:20:00Z");
  });

  it("splits a call across overlapping claims: own = unfinished share", () => {
    const lines = [
      claim(MARK1, CT1, STEP1, "2026-11-10T09:00:00Z"),
      claim(MARK2, CT2, STEP2, "2026-11-10T09:01:00Z"),
      call("msg_a", "2026-11-10T09:10:00Z"), // two open, one closes later: own 0.5
      finishCall("toolu_1", CT1, "2026-11-10T09:20:00Z"),
      finishResult("toolu_1", "2026-11-10T09:21:00Z"),
    ];
    const r = mainWindowOwnUsage(lines);
    const total = r.hours.reduce((n: number, h: { input_tokens: number }) => n + h.input_tokens, 0);
    // msg_a own 0.5 (5 of 10 input tokens); the finishing call has 1 open claim that closes: own 0.5 of the other (STEP2 never closes -> 1/2)
    expect(total).toBe(Math.round(10 * 0.5) + Math.round(10 * 0.5));
    expect(r.stepIds).toEqual([STEP1]);
  });

  it("does not close a claim on an errored completion, and never counts sidechain lines", () => {
    const lines = [
      claim(MARK1, CT1, STEP1, "2026-11-10T09:00:00Z"),
      finishCall("toolu_1", CT1, "2026-11-10T09:10:00Z"),
      finishResult("toolu_1", "2026-11-10T09:11:00Z", true),
      call("msg_side", "2026-11-10T09:12:00Z", { main: false }),
      call("msg_a", "2026-11-10T09:13:00Z"),
    ];
    const r = mainWindowOwnUsage(lines);
    expect(r.stepIds).toEqual([]);
    expect(r.hours.reduce((n: number, h: { calls: number }) => n + h.calls, 0)).toBe(2); // finish call + msg_a, not the sidechain
  });

  it("counts a call once however many lines repeat it", () => {
    const l = call("msg_a", "2026-11-10T09:10:00Z");
    const r = mainWindowOwnUsage([l, l, l]);
    expect(r.hours[0].calls).toBe(1);
    expect(r.hours[0].input_tokens).toBe(10);
  });

  // Runs the live usage command once per marker over the same lines and returns the
  // token totals it gives the steps. Input tokens are exact in a transcript (output is
  // estimated by the command), so they are what we compare.
  function liveStepShare(lines: string[], marks: string[]) {
    const root = mkdtempSync(join(tmpdir(), "main-usage-"));
    try {
      mkdirSync(join(root, "projects", "-repo"), { recursive: true });
      writeFileSync(join(root, "projects", "-repo", "s.jsonl"), lines.join("\n") + "\n");
      let input = 0;
      for (const mark of marks) {
        const r = spawnSync("bash", ["-c", stepUsageCommand(mark, "")], {
          encoding: "utf8",
          env: { PATH: process.env.PATH ?? "", HOME: join(root, "nohome"), CLAUDE_CONFIG_DIR: root, NODE_ENV: "test" as const },
        });
        const out = r.stdout.trim();
        if (out.startsWith("{")) for (const m of JSON.parse(out).models) input += m.input_tokens;
      }
      return input;
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
  const usageRun = (id: string, mark: string, ts: string) =>
    call(id, ts, { block: { type: "tool_use", id: "toolu_" + id, name: "Bash", input: { command: `mark='${mark}'` } } });

  it("splits every call between the steps and the main window exactly like the live awk command", () => {
    // The real order: each step runs its usage command, THEN calls complete_step.
    // Nine calls of 10 input tokens each: the step share plus ours must be 90, exactly.
    const lines = [
      call("msg_a", "2026-11-10T09:00:00Z"),
      claim(MARK1, CT1, STEP1, "2026-11-10T09:05:00Z"),
      call("msg_b", "2026-11-10T09:10:00Z"),
      claim(MARK2, CT2, STEP2, "2026-11-10T09:11:00Z"),
      call("msg_c", "2026-11-10T09:12:00Z"), // two steps open: half each
      usageRun("msg_run1", MARK1, "2026-11-10T09:15:00Z"), // step 1's usage run closes it
      call("msg_d", "2026-11-10T09:16:00Z"),
      finishCall("toolu_1", CT1, "2026-11-10T09:17:00Z"), // complete_step comes after the usage run
      finishResult("toolu_1", "2026-11-10T09:17:30Z"),
      usageRun("msg_run2", MARK2, "2026-11-10T09:18:00Z"),
      finishCall("toolu_2", CT2, "2026-11-10T09:19:00Z"),
      finishResult("toolu_2", "2026-11-10T09:19:30Z"),
      call("msg_e", "2026-11-10T09:30:00Z"),
    ];
    const own = mainWindowOwnUsage(lines);
    const ownInput = own.hours.reduce((n, h) => n + h.input_tokens, 0);
    const stepInput = liveStepShare(lines, [MARK1, MARK2]);
    expect(stepInput + ownInput).toBe(90); // 9 calls x 10
    expect(own.stepIds).toEqual([STEP1, STEP2]);
  });

  it("a step completed without a usage run: its calls are in no step figure and not in ours", () => {
    // A step closed by its completion alone (no usage run) is never run through the usage
    // command, so no step figure holds it; the scanner takes its calls out of the main
    // window's figure too. Those calls are counted nowhere. Pinned, not ideal (see the notes).
    const lines = [
      claim(MARK1, CT1, STEP1, "2026-11-10T09:00:00Z"),
      call("msg_b", "2026-11-10T09:10:00Z"),
      finishCall("toolu_1", CT1, "2026-11-10T09:20:00Z"),
      finishResult("toolu_1", "2026-11-10T09:21:00Z"),
      call("msg_c", "2026-11-10T09:30:00Z"), // after the close: main window
    ];
    const own = mainWindowOwnUsage(lines);
    expect(own.hours.reduce((n, h) => n + h.input_tokens, 0)).toBe(10); // msg_c only
  });
});
