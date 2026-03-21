import { describe, it, expect, vi } from "vitest";
import { instrumentServer, type ToolLogEntry } from "./instrument";
import type { McpContext } from "./context";

// Mock AnyMcpServer
function createMockServer() {
  const registeredTools = new Map<string, Function>();
  return {
    server: {
      tool: vi.fn((name: string, ...rest: unknown[]) => {
        const handler = rest[rest.length - 1] as Function;
        registeredTools.set(name, handler);
      }),
    },
    registeredTools,
  };
}

const mockContext: McpContext = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: {} as any,
  userId: "user-123",
  ownerUserId: "owner-456",
};

describe("instrumentServer", () => {
  it("wraps tool registrations and logs successful calls", async () => {
    const { server, registeredTools } = createMockServer();
    const logEntries: ToolLogEntry[] = [];

    const instrumented = instrumentServer(
      server,
      () => mockContext,
      (entry) => logEntries.push(entry),
      "stdio"
    );

    // Register a tool through the instrumented server
    const handler = vi.fn(async () => ({ content: [{ type: "text", text: "ok" }] }));
    instrumented.tool("test_tool", "description", {}, handler);

    // The original server.tool should have been called
    expect(server.tool).toHaveBeenCalledOnce();

    // Execute the wrapped handler
    const wrappedHandler = registeredTools.get("test_tool")!;
    const result = await wrappedHandler({ idea_id: "idea-789" }, {});

    // Original handler should have been called
    expect(handler).toHaveBeenCalledOnce();
    expect(result).toEqual({ content: [{ type: "text", text: "ok" }] });

    // Log entry should have been created
    expect(logEntries).toHaveLength(1);
    expect(logEntries[0]).toMatchObject({
      tool_name: "test_tool",
      user_id: "user-123",
      owner_user_id: "owner-456",
      is_error: false,
      mode: "stdio",
      idea_id: "idea-789",
    });
    expect(logEntries[0].duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("logs errors when tool handler throws", async () => {
    const { server, registeredTools } = createMockServer();
    const logEntries: ToolLogEntry[] = [];

    const instrumented = instrumentServer(
      server,
      () => mockContext,
      (entry) => logEntries.push(entry),
      "remote"
    );

    const handler = vi.fn(async () => {
      throw new Error("Tool failed");
    });
    instrumented.tool("failing_tool", "desc", {}, handler);

    const wrappedHandler = registeredTools.get("failing_tool")!;
    await expect(wrappedHandler({}, {})).rejects.toThrow("Tool failed");

    expect(logEntries).toHaveLength(1);
    expect(logEntries[0]).toMatchObject({
      tool_name: "failing_tool",
      is_error: true,
      mode: "remote",
    });
  });

  it("detects isError in result object", async () => {
    const { server, registeredTools } = createMockServer();
    const logEntries: ToolLogEntry[] = [];

    const instrumented = instrumentServer(
      server,
      () => mockContext,
      (entry) => logEntries.push(entry),
      "stdio"
    );

    const handler = vi.fn(async () => ({
      content: [{ type: "text", text: "Error: something went wrong" }],
      isError: true,
    }));
    instrumented.tool("error_result_tool", "desc", {}, handler);

    const wrappedHandler = registeredTools.get("error_result_tool")!;
    await wrappedHandler({}, {});

    expect(logEntries[0].is_error).toBe(true);
  });

  it("extracts idea_id from args", async () => {
    const { server, registeredTools } = createMockServer();
    const logEntries: ToolLogEntry[] = [];

    const instrumented = instrumentServer(
      server,
      () => mockContext,
      (entry) => logEntries.push(entry),
      "stdio"
    );

    const handler = vi.fn(async () => ({ content: [] }));
    instrumented.tool("tool_with_idea", "desc", {}, handler);

    const wrappedHandler = registeredTools.get("tool_with_idea")!;
    await wrappedHandler({ idea_id: "abc-123", other: "arg" }, {});

    expect(logEntries[0].idea_id).toBe("abc-123");
  });

  it("sets idea_id to null when not in args", async () => {
    const { server, registeredTools } = createMockServer();
    const logEntries: ToolLogEntry[] = [];

    const instrumented = instrumentServer(
      server,
      () => mockContext,
      (entry) => logEntries.push(entry),
      "stdio"
    );

    const handler = vi.fn(async () => ({ content: [] }));
    instrumented.tool("no_idea_tool", "desc", {}, handler);

    const wrappedHandler = registeredTools.get("no_idea_tool")!;
    await wrappedHandler({ task_id: "task-1" }, {});

    expect(logEntries[0].idea_id).toBeNull();
  });

  it("does not break tool execution if logging fails", async () => {
    const { server, registeredTools } = createMockServer();

    const instrumented = instrumentServer(
      server,
      () => mockContext,
      () => { throw new Error("Log insert failed"); },
      "stdio"
    );

    const handler = vi.fn(async () => ({ content: [{ type: "text", text: "ok" }] }));
    instrumented.tool("safe_tool", "desc", {}, handler);

    const wrappedHandler = registeredTools.get("safe_tool")!;
    const result = await wrappedHandler({}, {});

    // Tool should still succeed despite logging failure
    expect(result).toEqual({ content: [{ type: "text", text: "ok" }] });
    expect(handler).toHaveBeenCalledOnce();
  });

  it("does not break tool execution if context resolution fails", async () => {
    const { server, registeredTools } = createMockServer();
    const logEntries: ToolLogEntry[] = [];

    const instrumented = instrumentServer(
      server,
      () => { throw new Error("Auth failed"); },
      (entry) => logEntries.push(entry),
      "stdio"
    );

    const handler = vi.fn(async () => ({ content: [{ type: "text", text: "ok" }] }));
    instrumented.tool("no_ctx_tool", "desc", {}, handler);

    const wrappedHandler = registeredTools.get("no_ctx_tool")!;
    const result = await wrappedHandler({}, {});

    // Tool should still succeed
    expect(result).toEqual({ content: [{ type: "text", text: "ok" }] });
    // No log entry since context failed
    expect(logEntries).toHaveLength(0);
  });
});
