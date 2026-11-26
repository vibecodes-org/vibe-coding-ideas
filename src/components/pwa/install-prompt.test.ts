import { describe, it, expect } from "vitest";
import { isInstallPromptHiddenOn } from "./install-prompt";

describe("isInstallPromptHiddenOn", () => {
  it("hides the install banner on the signed-out front page", () => {
    expect(isInstallPromptHiddenOn("/")).toBe(true);
  });

  it("leaves it alone everywhere else", () => {
    for (const p of ["/dashboard", "/login", "/guide", "/ideas/abc/board", null]) {
      expect(isInstallPromptHiddenOn(p)).toBe(false);
    }
  });
});
