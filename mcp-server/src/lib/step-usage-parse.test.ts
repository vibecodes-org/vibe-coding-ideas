import { describe, it, expect } from "vitest";
import { parseReportedUsage } from "./step-usage";

const good = {
  models: [
    { model: "claude-opus-4-7", calls: 1, input_tokens: 1, output_tokens: 5, cache_read_tokens: 0, cache_write_5m_tokens: 0, cache_write_1h_tokens: 0 },
  ],
};

describe("parseReportedUsage (card 1553d11e)", () => {
  it("reads an object or a JSON string", () => {
    expect(parseReportedUsage(good)?.models[0].output_tokens).toBe(5);
    expect(parseReportedUsage(JSON.stringify(good))?.models[0].model).toBe("claude-opus-4-7");
  });
  it("floors a negative count instead of losing the report", () => {
    const neg = { models: [{ ...good.models[0], cache_write_5m_tokens: -3 }] };
    expect(parseReportedUsage(neg)?.models[0].cache_write_5m_tokens).toBe(0);
  });
  it("is null for nothing, NO_TRANSCRIPT, junk or a wrong shape", () => {
    expect(parseReportedUsage(undefined)).toBeNull();
    expect(parseReportedUsage("NO_TRANSCRIPT no-script vcu_x")).toBeNull();
    expect(parseReportedUsage("{not json")).toBeNull();
    expect(parseReportedUsage({ models: [] })).toBeNull();
  });
});
