import { describe, it, expect } from "vitest";
import { shortUsageCommandEnabled, stepUsageCommandForClaim, stepUsageFallbackCommandForClaim } from "./step-usage-delivery";
import { stepUsageCommand, stepUsagePlainCommand, stepUsageShortCommand, stepUsageScript } from "../../../src/lib/step-cost/usage-command";

const MARK = "vcu_0123456789abcdef01234567";

describe("step usage command delivery (stage 2b)", () => {
  it("is off unless STEP_USAGE_SHORT_COMMAND is switched on; blank counts as off", () => {
    for (const v of [undefined, "", "  ", "0", "false", "off", "yes please"]) {
      expect(shortUsageCommandEnabled({ STEP_USAGE_SHORT_COMMAND: v })).toBe(false);
    }
    for (const v of ["1", "true", "ON", " on "]) {
      expect(shortUsageCommandEnabled({ STEP_USAGE_SHORT_COMMAND: v })).toBe(true);
    }
  });

  it("off: every claim carries the full command, exactly as before", () => {
    expect(stepUsageCommandForClaim(MARK, {})).toBe(stepUsageCommand(MARK));
  });

  it("on: the wrapper command falls back to NO_TRANSCRIPT", () => {
    const command = stepUsageShortCommand(MARK);
    expect(command).toContain(`echo "NO_TRANSCRIPT no-script $m"`);
    expect(command.length).toBeLessThan(275);
  });

  it("on: the claim's first-choice command is the plain one, with the wrapper kept as the missing-script fallback (card 730f2549)", () => {
    const env = { STEP_USAGE_SHORT_COMMAND: "1" };
    expect(stepUsageCommandForClaim(MARK, env)).toBe(stepUsagePlainCommand(MARK, stepUsageScript().file));
    expect(stepUsageFallbackCommandForClaim(MARK, env)).toBe(stepUsageShortCommand(MARK));
    expect(stepUsageFallbackCommandForClaim(MARK, {})).toBeUndefined();
  });
});
