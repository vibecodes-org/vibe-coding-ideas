import { describe, it, expect, vi } from "vitest";
import { instrumentServer, type ToolLogEntry } from "./instrument";
import type { McpContext } from "./context";

// Mock AnyMcpServer
type ToolHandler = (...args: unknown[]) => unknown;
function createMockServer() {
  const registeredTools = new Map<string, ToolHandler>();
  return {
    server: {
      tool: vi.fn((name: string, ...rest: unknown[]) => {
        const handler = rest[rest.length - 1] as ToolHandler;
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

  // bot_id records the agent a call explicitly names — the only source for
  // per-persona analysis now that ambient identity is retired
  // (docs/agent-voice-comments-design.html §4.1): ctx.userId is always the
  // real human (remote) or a stdio install's static configured identity, so
  // it never carries a workflow bot id on its own.
  it("extracts bot_id from an explicit agent_id arg", async () => {
    const { server, registeredTools } = createMockServer();
    const logEntries: ToolLogEntry[] = [];

    const instrumented = instrumentServer(
      server,
      () => mockContext,
      (entry) => logEntries.push(entry),
      "stdio"
    );

    const handler = vi.fn(async () => ({ content: [] }));
    instrumented.tool("get_agent_skill_content", "desc", {}, handler);

    const wrappedHandler = registeredTools.get("get_agent_skill_content")!;
    await wrappedHandler({ agent_id: "bot-42", skill_name: "x" }, {});

    expect(logEntries[0].bot_id).toBe("bot-42");
  });

  it("falls back to a bot_id arg, and is null when the call names no agent", async () => {
    const { server, registeredTools } = createMockServer();
    const logEntries: ToolLogEntry[] = [];

    const instrumented = instrumentServer(
      server,
      () => mockContext,
      (entry) => logEntries.push(entry),
      "stdio"
    );

    const handler = vi.fn(async () => ({ content: [] }));
    instrumented.tool("set_agent_identity", "desc", {}, handler);
    instrumented.tool("plain_tool", "desc", {}, handler);

    await registeredTools.get("set_agent_identity")!({ bot_id: "bot-7" }, {});
    await registeredTools.get("plain_tool")!({ task_id: "task-1" }, {});

    expect(logEntries[0].bot_id).toBe("bot-7");
    expect(logEntries[1].bot_id).toBeNull();
  });

  it("records bot_id on the error path too", async () => {
    const { server, registeredTools } = createMockServer();
    const logEntries: ToolLogEntry[] = [];

    const instrumented = instrumentServer(
      server,
      () => mockContext,
      (entry) => logEntries.push(entry),
      "stdio"
    );

    const handler = vi.fn(async () => {
      throw new Error("Tool failed");
    });
    instrumented.tool("failing_agent_tool", "desc", {}, handler);

    const wrappedHandler = registeredTools.get("failing_agent_tool")!;
    await expect(wrappedHandler({ agent_id: "bot-9" }, {})).rejects.toThrow("Tool failed");

    expect(logEntries[0].bot_id).toBe("bot-9");
    expect(logEntries[0].is_error).toBe(true);
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

  it("calls mcpConnectFn with ownerUserId on successful tool call", async () => {
    const { server, registeredTools } = createMockServer();
    const logEntries: ToolLogEntry[] = [];
    const connectedOwners: string[] = [];

    const instrumented = instrumentServer(
      server,
      () => mockContext,
      (entry) => logEntries.push(entry),
      "stdio",
      (ownerUserId) => connectedOwners.push(ownerUserId)
    );

    const handler = vi.fn(async () => ({ content: [] }));
    instrumented.tool("connect_tool", "desc", {}, handler);

    const wrappedHandler = registeredTools.get("connect_tool")!;
    await wrappedHandler({}, {});

    // Should call mcpConnectFn with the ownerUserId
    expect(connectedOwners).toHaveLength(1);
    expect(connectedOwners[0]).toBe("owner-456");
  });

  it("falls back to userId when ownerUserId is undefined", async () => {
    const { server, registeredTools } = createMockServer();
    const connectedOwners: string[] = [];
    const ctxNoOwner: McpContext = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: {} as any,
      userId: "user-123",
      ownerUserId: undefined,
    };

    const instrumented = instrumentServer(
      server,
      () => ctxNoOwner,
      () => {},
      "stdio",
      (ownerUserId) => connectedOwners.push(ownerUserId)
    );

    const handler = vi.fn(async () => ({ content: [] }));
    instrumented.tool("fallback_tool", "desc", {}, handler);

    const wrappedHandler = registeredTools.get("fallback_tool")!;
    await wrappedHandler({}, {});

    expect(connectedOwners[0]).toBe("user-123");
  });

  it("does not break tool execution if mcpConnectFn fails", async () => {
    const { server, registeredTools } = createMockServer();

    const instrumented = instrumentServer(
      server,
      () => mockContext,
      () => {},
      "stdio",
      () => { throw new Error("Connect update failed"); }
    );

    const handler = vi.fn(async () => ({ content: [{ type: "text", text: "ok" }] }));
    instrumented.tool("safe_connect_tool", "desc", {}, handler);

    const wrappedHandler = registeredTools.get("safe_connect_tool")!;
    const result = await wrappedHandler({}, {});

    // Tool should still succeed despite mcpConnectFn failure
    expect(result).toEqual({ content: [{ type: "text", text: "ok" }] });
  });

  it("does not call mcpConnectFn when not provided", async () => {
    const { server, registeredTools } = createMockServer();
    const logEntries: ToolLogEntry[] = [];

    // No mcpConnectFn passed — should work fine (backward compatible)
    const instrumented = instrumentServer(
      server,
      () => mockContext,
      (entry) => logEntries.push(entry),
      "stdio"
    );

    const handler = vi.fn(async () => ({ content: [] }));
    instrumented.tool("no_connect_tool", "desc", {}, handler);

    const wrappedHandler = registeredTools.get("no_connect_tool")!;
    await wrappedHandler({}, {});

    expect(logEntries).toHaveLength(1);
    // No error thrown — backward compatible
  });

  // MCP usage steering (docs/mcp-usage-steering-design.html §6a): session_id
  // ties log rows into per-session sequences for the admin re-read queries.
  // Populated from ctx.sessionId when present, null otherwise — never blocks
  // or throws, matching the rest of this fire-and-forget log entry.
  it("logs session_id from ctx.sessionId when present", async () => {
    const { server, registeredTools } = createMockServer();
    const logEntries: ToolLogEntry[] = [];
    const ctxWithSession: McpContext = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: {} as any,
      userId: "user-123",
      ownerUserId: "owner-456",
      sessionId: "remote:jwt-session-abc",
    };

    const instrumented = instrumentServer(
      server,
      () => ctxWithSession,
      (entry) => logEntries.push(entry),
      "remote"
    );

    const handler = vi.fn(async () => ({ content: [] }));
    instrumented.tool("session_tool", "desc", {}, handler);

    await registeredTools.get("session_tool")!({}, {});

    expect(logEntries[0].session_id).toBe("remote:jwt-session-abc");
  });

  it("logs session_id as null when ctx.sessionId is absent", async () => {
    const { server, registeredTools } = createMockServer();
    const logEntries: ToolLogEntry[] = [];

    const instrumented = instrumentServer(
      server,
      () => mockContext, // mockContext has no sessionId
      (entry) => logEntries.push(entry),
      "stdio"
    );

    const handler = vi.fn(async () => ({ content: [] }));
    instrumented.tool("no_session_tool", "desc", {}, handler);

    await registeredTools.get("no_session_tool")!({}, {});

    expect(logEntries[0].session_id).toBeNull();
  });

  it("logs session_id on the error path too", async () => {
    const { server, registeredTools } = createMockServer();
    const logEntries: ToolLogEntry[] = [];
    const ctxWithSession: McpContext = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: {} as any,
      userId: "user-123",
      sessionId: "stdio:bot-user-1",
    };

    const instrumented = instrumentServer(
      server,
      () => ctxWithSession,
      (entry) => logEntries.push(entry),
      "stdio"
    );

    const handler = vi.fn(async () => {
      throw new Error("Tool failed");
    });
    instrumented.tool("failing_session_tool", "desc", {}, handler);

    await expect(
      registeredTools.get("failing_session_tool")!({}, {})
    ).rejects.toThrow("Tool failed");

    expect(logEntries[0].session_id).toBe("stdio:bot-user-1");
    expect(logEntries[0].is_error).toBe(true);
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
