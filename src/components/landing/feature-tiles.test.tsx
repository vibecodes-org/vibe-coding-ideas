import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@testing-library/react";
import { FeatureTiles, MCP_TOOL_COUNT } from "./feature-tiles";
import { INSTALL_COMMAND } from "./aurora-hero";

describe("FeatureTiles", () => {
  it("shows the real number of registered MCP tools", () => {
    const src = readFileSync(join(process.cwd(), "mcp-server/src/register-tools.ts"), "utf8");
    const registered = (src.match(/registerTool\(/g) ?? []).length;
    expect(MCP_TOOL_COUNT).toBe(registered);
  });

  it("renders the corrected sentences and the install command in the tools tile", () => {
    const { container } = render(<FeatureTiles />);
    const text = container.textContent ?? "";
    expect(text).toContain(String(MCP_TOOL_COUNT));
    expect(text).toContain("Private when you want it");
    expect(text).not.toContain("Private by default");
    expect(text).toContain("Nothing gets past them without it.");
    expect(text).not.toContain("Nothing ships without it");
    expect(container.querySelector("code")?.textContent).toBe(INSTALL_COMMAND);
  });
});
