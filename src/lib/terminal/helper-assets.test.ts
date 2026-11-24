import { describe, it, expect } from "vitest";
import { helperAssetUrls, macDmgUrl, winSetupUrl, HELPER_RELEASE_BASE } from "./helper-assets";

describe("helper release asset addresses", () => {
  it("builds the Mac disk image address per arch", () => {
    expect(macDmgUrl("0.4.0", "arm64")).toBe(`${HELPER_RELEASE_BASE}/terminal-helper-v0.4.0/VibeCodes-0.4.0-arm64.dmg`);
    expect(macDmgUrl("0.4.0", "x64")).toBe(`${HELPER_RELEASE_BASE}/terminal-helper-v0.4.0/VibeCodes-0.4.0-x64.dmg`);
  });

  it("builds the Windows installer address per arch", () => {
    expect(winSetupUrl("0.4.0", "x64")).toBe(
      `${HELPER_RELEASE_BASE}/terminal-helper-v0.4.0/VibeCodes-Setup-0.4.0-x64.exe`,
    );
    expect(winSetupUrl("0.4.0", "arm64")).toBe(
      `${HELPER_RELEASE_BASE}/terminal-helper-v0.4.0/VibeCodes-Setup-0.4.0-arm64.exe`,
    );
  });

  it("lists all 6 files a release must carry (4 Mac, 2 Windows), using the Mac names electron-builder really emits", () => {
    // The x64 Mac zip has no arch in its name (checked against the 0.3.39 release).
    const names = helperAssetUrls("0.4.0").map((u) => u.split("/").pop());
    expect(names).toEqual([
      "VibeCodes-0.4.0-arm64.dmg",
      "VibeCodes-0.4.0-x64.dmg",
      "VibeCodes-0.4.0-arm64-mac.zip",
      "VibeCodes-0.4.0-mac.zip",
      "VibeCodes-Setup-0.4.0-x64.exe",
      "VibeCodes-Setup-0.4.0-arm64.exe",
    ]);
  });
});
