import { describe, it, expect } from "vitest";
import { shortUsageCommandEnabled, stepUsageCommandForClaim } from "./step-usage-delivery";
import { stepUsageCommand, stepUsageShortCommand } from "../../../src/lib/step-cost/usage-command";

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

  it("on: the claim carries the short command, which falls back to NO_TRANSCRIPT", () => {
    const command = stepUsageCommandForClaim(MARK, { STEP_USAGE_SHORT_COMMAND: "1" });
    expect(command).toBe(stepUsageShortCommand(MARK));
    expect(command).toContain('echo "NO_TRANSCRIPT no-script"');
    expect(command.length).toBeLessThan(260);
  });
});
