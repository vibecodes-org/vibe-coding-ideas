import { describe, it, expect } from "vitest";
import { launchModeOptions, isBrowserLaunchAvailable } from "./launch-mode";

describe("launchModeOptions", () => {
  it("flag OFF → only the terminal-window mode (in-browser item not rendered)", () => {
    expect(launchModeOptions(false)).toEqual(["terminal-window"]);
    expect(isBrowserLaunchAvailable(false)).toBe(false);
  });

  it("flag ON → terminal-window (default, first) then browser", () => {
    const opts = launchModeOptions(true);
    expect(opts).toEqual(["terminal-window", "browser"]);
    // terminal-window is always present and always first — the existing default
    // action is never moved or removed by enabling the flag.
    expect(opts[0]).toBe("terminal-window");
    expect(isBrowserLaunchAvailable(true)).toBe(true);
  });
});
