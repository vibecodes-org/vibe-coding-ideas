import { describe, it, expect } from "vitest";
import { priceKey, usageCost, MODEL_PRICES } from "./pricing";

const zero = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_5m_tokens: 0, cache_write_1h_tokens: 0 };

describe("priceKey", () => {
  it("normalises provider prefixes, context markers and date suffixes", () => {
    expect(priceKey("claude-opus-5-5")).toBe("claude-opus-5-5");
    expect(priceKey("anthropic.claude-sonnet-5-5")).toBe("claude-sonnet-5-5");
    expect(priceKey("us.anthropic.claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
    expect(priceKey("claude-opus-4-8[1m]")).toBe("claude-opus-4-8");
    expect(priceKey("claude-haiku-4-5-20251001")).toBe("claude-haiku-4-5");
    expect(priceKey("claude-haiku-5-5+long")).toBe("claude-haiku-5-5+long");
  });

  it("returns null for models with no price, including Codex and bare aliases", () => {
    expect(priceKey("gpt-5.6-terra")).toBeNull();
    expect(priceKey("opus")).toBeNull();
    expect(usageCost({ model: "gpt-5.6-terra", ...zero, input_tokens: 10 })).toBeNull();
  });
});

describe("usageCost", () => {
  it("prices each token kind at its own rate", () => {
    // Opus 5.5: $4 in, $20 out, $5 5-minute write, $8 1-hour write, $0.20 read, per million.
    expect(usageCost({ model: "claude-opus-5-5", input_tokens: 1e6, output_tokens: 1e6, cache_write_5m_tokens: 1e6, cache_write_1h_tokens: 1e6, cache_read_tokens: 1e6 })).toBeCloseTo(4 + 20 + 5 + 8 + 0.2);
  });

  it("reproduces a real Plan step's cost from 15 Oct 2026", () => {
    expect(usageCost({ model: "claude-opus-5-5", input_tokens: 92, output_tokens: 15714, cache_read_tokens: 6513217, cache_write_5m_tokens: 217462, cache_write_1h_tokens: 0 })).toBeCloseTo(2.70, 2);
  });

  it("uses the special cache-read rates", () => {
    expect(MODEL_PRICES["claude-fable-5-1"].cacheRead).toBe(0.25);
    expect(MODEL_PRICES["claude-opus-5-5"].cacheRead).toBe(0.2);
    expect(MODEL_PRICES["claude-fable-5"].cacheRead).toBe(1);
    expect(MODEL_PRICES["claude-sonnet-4-6"].cacheWrite1h).toBe(6);
  });
});
