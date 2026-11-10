import { describe, it, expect, vi } from "vitest";
import { runModelChecks, type ModelWatchDeps } from "./model-watch-checks";

const goodBoard = { tasks: [{ title: "a" }] };
const goodAdj = { recommended_template_id: "t", confidence: 0.9, rationale: "fits" };
const usage = { inputTokens: 5, outputTokens: 7 };

function deps(over: Partial<{ stream: unknown; generate: unknown; text: unknown }> = {}) {
  return {
    stream: over.stream ?? (() => ({
      object: Promise.resolve(goodBoard),
      usage: Promise.resolve(usage),
      finishReason: Promise.resolve("stop"),
    })),
    generate: over.generate ?? (async () => ({ object: goodAdj, usage, finishReason: "stop" })),
    text: over.text ?? (async () => ({ text: "Better.", usage, finishReason: "stop" })),
  } as unknown as ModelWatchDeps;
}
const provider = () => ({}) as never;

describe("runModelChecks", () => {
  it("passes all three when everything completes and validates", async () => {
    const r = await runModelChecks(provider, "m", deps());
    expect(r.map((x) => [x.name, x.ok])).toEqual([
      ["task generation", true],
      ["workflow matching", true],
      ["short rewrite", true],
    ]);
    expect(r[0].outputTokens).toBe(7);
  });
  it("fails when cut off by the cap", async () => {
    const r = await runModelChecks(provider, "m", deps({
      text: async () => ({ text: "x", usage, finishReason: "length" }),
    }));
    expect(r[2].ok).toBe(false);
    expect(r[2].error).toContain("cut off");
  });
  it("fails when output does not match the schema", async () => {
    const r = await runModelChecks(provider, "m", deps({
      generate: async () => ({ object: { confidence: "high" }, usage, finishReason: "stop" }),
    }));
    expect(r[1].ok).toBe(false);
  });
  it("fails on empty rewrite text", async () => {
    const r = await runModelChecks(provider, "m", deps({
      text: async () => ({ text: "  ", usage, finishReason: "stop" }),
    }));
    expect(r[2].error).toBe("Output was empty");
  });
  it("fails at once on a non-retryable error", async () => {
    const generate = vi.fn(async () => {
      throw Object.assign(new Error("tool_choice not supported"), { statusCode: 400 });
    });
    const r = await runModelChecks(provider, "m", deps({ generate }));
    expect(generate).toHaveBeenCalledTimes(1);
    expect(r[1].ok).toBe(false);
    expect(r[1].error).toContain("tool_choice");
  });
  it("retries an overloaded error once, then succeeds", async () => {
    let n = 0;
    const generate = vi.fn(async () => {
      if (n++ === 0) throw Object.assign(new Error("Overloaded"), { statusCode: 529 });
      return { object: goodAdj, usage, finishReason: "stop" };
    });
    const r = await runModelChecks(provider, "m", deps({ generate }));
    expect(generate).toHaveBeenCalledTimes(2);
    expect(r[1].ok).toBe(true);
  });
  it("retries only once", async () => {
    const generate = vi.fn(async () => {
      throw Object.assign(new Error("Overloaded"), { statusCode: 529 });
    });
    const r = await runModelChecks(provider, "m", deps({ generate }));
    expect(generate).toHaveBeenCalledTimes(2);
    expect(r[1].ok).toBe(false);
  });
});
