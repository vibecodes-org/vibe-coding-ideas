import { describe, it, expect } from "vitest";
import {
  pickNewestSonnet,
  isNewer,
  shouldTestDrive,
  isRetryableAiError,
  buildModelWatchCard,
  modelWatchTitlePrefix,
  escapeLike,
  type AnthropicModel,
  type CheckResult,
} from "./model-watch";

const m = (id: string, created_at: string, display_name = id): AnthropicModel => ({
  id,
  created_at,
  display_name,
});

const models = [
  m("claude-opus-5-6", "2026-11-01T00:00:00Z"),
  m("claude-sonnet-5-5", "2026-10-01T00:00:00Z", "Claude Sonnet 5.5"),
  m("claude-haiku-5", "2026-11-05T00:00:00Z"),
  m("claude-sonnet-5-6", "2026-11-09T00:00:00Z", "Claude Sonnet 5.6"),
];

describe("pickNewestSonnet", () => {
  it("takes the newest Sonnet from unordered input, ignoring newer Opus/Haiku", () => {
    expect(pickNewestSonnet(models)?.id).toBe("claude-sonnet-5-6");
  });
  it("returns null with no Sonnets", () => {
    expect(pickNewestSonnet([])).toBeNull();
    expect(pickNewestSonnet([m("claude-opus-5", "2026-01-01T00:00:00Z")])).toBeNull();
  });
});

describe("isNewer / shouldTestDrive", () => {
  const cand = models[3];
  it("is newer than the current model", () => {
    expect(isNewer(cand, "claude-sonnet-5-5", models)).toBe(true);
  });
  it("is not newer than itself", () => {
    expect(isNewer(cand, "claude-sonnet-5-6", models)).toBe(false);
  });
  it("is newer when the current id is missing from the list", () => {
    expect(isNewer(cand, "something-else", models)).toBe(true);
  });
  it("is not newer when the current model is later", () => {
    expect(isNewer(models[1], "claude-sonnet-5-6", models)).toBe(false);
  });
  it("skips already-seen models", () => {
    expect(shouldTestDrive(cand, "claude-sonnet-5-5", models, ["claude-sonnet-5-6"])).toBe(false);
  });
  it("tests a new unseen model", () => {
    expect(shouldTestDrive(cand, "claude-sonnet-5-5", models, [])).toBe(true);
  });
  it("does nothing with no candidate", () => {
    expect(shouldTestDrive(null, "x", models, [])).toBe(false);
  });
});

describe("isRetryableAiError", () => {
  it("retries 429, 5xx and overloaded", () => {
    expect(isRetryableAiError({ statusCode: 429 })).toBe(true);
    expect(isRetryableAiError({ statusCode: 529 })).toBe(true);
    expect(isRetryableAiError({ status: 503 })).toBe(true);
    expect(isRetryableAiError(new Error("Overloaded"))).toBe(true);
  });
  it("does not retry other errors", () => {
    expect(isRetryableAiError({ statusCode: 400 })).toBe(false);
    expect(isRetryableAiError(new Error("bad request"))).toBe(false);
    expect(isRetryableAiError(null)).toBe(false);
  });
});

const ok = (name: CheckResult["name"]): CheckResult => ({
  name, ok: true, inputTokens: 10, outputTokens: 20, ms: 1500, finishReason: "stop",
});

describe("buildModelWatchCard", () => {
  const model = models[3];
  it("words a pass with switching steps", () => {
    const c = buildModelWatchCard({
      model,
      currentModel: "claude-sonnet-5-5",
      results: [ok("task generation"), ok("workflow matching"), ok("short rewrite")],
    });
    expect(c.title).toBe("Sonnet 5.6 is out and passed the app's checks: switch?");
    expect(c.description).toContain("Set `ANTHROPIC_MODEL` to `claude-sonnet-5-6`");
    expect(c.description).toContain("**workflow matching**: PASS");
    expect(c.description).toContain("your own-key users aren't tested");
  });
  it("words a fail with the first failing check and a cut error", () => {
    const long = "x".repeat(300);
    const c = buildModelWatchCard({
      model,
      currentModel: "claude-sonnet-5-5",
      results: [
        ok("task generation"),
        { ...ok("workflow matching"), ok: false, error: long, finishReason: undefined },
        { ...ok("short rewrite"), ok: false, error: "other" },
      ],
    });
    expect(c.title.startsWith("Sonnet 5.6 is out but fails workflow matching: ")).toBe(true);
    expect(c.title.length).toBeLessThan(150);
    expect(c.description).toContain(long);
    expect(c.description).toContain("Fix this before anyone switches");
  });
});

describe("modelWatchTitlePrefix / escapeLike", () => {
  const m = (display_name: string) => ({ id: "x", display_name, created_at: "2026-01-01T00:00:00Z" });
  const sonnet56 = m("Claude Sonnet 5.6");

  it("builds 'Sonnet <version> is out'", () => {
    expect(modelWatchTitlePrefix(sonnet56)).toBe("Sonnet 5.6 is out");
    expect(modelWatchTitlePrefix(m("Claude Sonnet 6"))).toBe("Sonnet 6 is out");
  });
  it("both card titles start with the prefix", () => {
    const fail = buildModelWatchCard({
      model: sonnet56,
      results: [{ name: "short rewrite", ok: false, inputTokens: 0, outputTokens: 0, ms: 1, error: "boom" }],
      currentModel: "a",
    });
    const pass = buildModelWatchCard({ model: sonnet56, results: [], currentModel: "a" });
    expect(fail.title.startsWith("Sonnet 5.6 is out")).toBe(true);
    expect(pass.title.startsWith("Sonnet 5.6 is out")).toBe(true);
  });
  it("5.6 and 6 give prefixes that cannot match each other's titles", () => {
    const six = modelWatchTitlePrefix(m("Claude Sonnet 6"));
    expect("Sonnet 5.6 is out and passed".startsWith(six)).toBe(false);
  });
  it("5.6 does not match a 5.60 title", () => {
    expect("Sonnet 5.60 is out and passed".startsWith(modelWatchTitlePrefix(sonnet56))).toBe(false);
  });
  it("escapes LIKE wildcards and backslashes", () => {
    expect(escapeLike("a%b_c\\d")).toBe("a\\%b\\_c\\\\d");
  });
});
