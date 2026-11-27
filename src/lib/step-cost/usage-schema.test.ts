import { describe, it, expect } from "vitest";
import { stepUsageSchema } from "./usage-schema";

const base = { model: "claude-sonnet-5-5", calls: 1, input_tokens: 1, output_tokens: 5, cache_read_tokens: 0, cache_write_5m_tokens: 0, cache_write_1h_tokens: 0 };

describe("stepUsageSchema helper_output_tokens (card 80284573)", () => {
  it("keeps the field instead of silently dropping it", () => {
    const parsed = stepUsageSchema.parse({ models: [{ ...base, helper_output_tokens: 5 }] });
    expect(parsed.models[0].helper_output_tokens).toBe(5);
  });
  it("is optional, so older usage lines still parse", () => {
    expect(stepUsageSchema.safeParse({ models: [base] }).success).toBe(true);
  });
});
