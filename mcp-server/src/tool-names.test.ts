import { describe, it, expect, vi } from "vitest";
import { ALL_MCP_TOOL_NAMES } from "./tool-names";

// Collect tool names by intercepting server.tool() calls during registerTools()
describe("ALL_MCP_TOOL_NAMES", () => {
  it("matches the tools registered in registerTools()", async () => {
    const registeredNames: string[] = [];
    const mockServer = {
      tool: vi.fn((name: string) => {
        registeredNames.push(name);
      }),
    };

    // Dynamic import to avoid module-level side effects
    const { registerTools } = await import("./register-tools");
    const mockGetContext = vi.fn();
    registerTools(mockServer as never, mockGetContext);

    // Every registered tool should be in the static list
    for (const name of registeredNames) {
      expect(ALL_MCP_TOOL_NAMES).toContain(name);
    }

    // Every name in the static list should be registered
    for (const name of ALL_MCP_TOOL_NAMES) {
      expect(registeredNames).toContain(name);
    }

    // Same count
    expect(ALL_MCP_TOOL_NAMES.length).toBe(registeredNames.length);
  });
});
