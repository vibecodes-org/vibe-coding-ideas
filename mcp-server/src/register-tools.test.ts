import { describe, it, expect, vi } from "vitest";
import { registerTools } from "./register-tools";
import type { McpContext } from "./context";

const EXPECTED_TOOL_NAMES = [
  "list_ideas",
  "get_idea",
  "get_board",
  "get_task",
  "get_my_tasks",
  "create_task",
  "update_task",
  "move_task",
  "delete_task",
  "update_idea_description",
  "create_idea",
  "delete_idea",
  "update_idea_status",
  "update_idea_tags",
  "toggle_vote",
  "add_collaborator",
  "remove_collaborator",
  "list_collaborators",
  "create_column",
  "update_column",
  "delete_column",
  "reorder_columns",
  "manage_labels",
  "manage_checklist",
  "add_idea_comment",
  "add_task_comment",
  "report_bug",
  "list_discussions",
  "get_discussion",
  "add_discussion_reply",
  "create_discussion",
  "update_discussion",
  "delete_discussion",
  "get_discussions_ready_to_convert",
  "list_attachments",
  "upload_attachment",
  "delete_attachment",
  "list_notifications",
  "mark_notification_read",
  "mark_all_notifications_read",
  "get_agent_mentions",
  "update_profile",
  "list_agents",
  "get_agent_prompt",
  "set_agent_identity",
  "create_agent",
  "toggle_agent_vote",
  "clone_agent",
  "publish_agent",
  "list_community_agents",
  "list_featured_teams",
  "allocate_agent",
  "remove_idea_agent",
  "list_idea_agents",
];

function createMockServer() {
  return { tool: vi.fn() };
}

describe("registerTools", () => {
  it("registers exactly 54 tools", () => {
    const server = createMockServer();
    const getContext = vi.fn();

    registerTools(server, getContext);

    expect(server.tool).toHaveBeenCalledTimes(54);
  });

  it("registers all expected tool names", () => {
    const server = createMockServer();
    const getContext = vi.fn();

    registerTools(server, getContext);

    const registeredNames = server.tool.mock.calls.map(
      (call: unknown[]) => call[0]
    );
    expect(registeredNames).toEqual(EXPECTED_TOOL_NAMES);
  });

  it("registers each tool with name, description, schema, and callback", () => {
    const server = createMockServer();
    const getContext = vi.fn();

    registerTools(server, getContext);

    for (const call of server.tool.mock.calls) {
      const [name, description, schema, callback] = call;
      expect(typeof name).toBe("string");
      expect(typeof description).toBe("string");
      expect(description.length).toBeGreaterThan(0);
      expect(typeof schema).toBe("object");
      expect(typeof callback).toBe("function");
    }
  });

  it("returns error result when getContext throws", async () => {
    const server = createMockServer();
    const getContext = vi.fn(() => {
      throw new Error("Authentication required");
    });

    registerTools(server, getContext);

    // Invoke the first tool callback (list_ideas)
    const callback = server.tool.mock.calls[0][3];
    const result = await callback({}, {});

    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("Authentication required");
  });

  it("returns error result when tool handler throws", async () => {
    const server = createMockServer();
    // Provide a context with a non-functional supabase client
    // The tool handler will fail when trying to use it
    const mockContext: McpContext = {
      supabase: {} as McpContext["supabase"],
      userId: "test-user",
    };
    const getContext = vi.fn(() => mockContext);

    registerTools(server, getContext);

    // Invoke create_task (index 5) with valid-shaped args that will fail at DB
    const callback = server.tool.mock.calls[5][3];
    const result = await callback(
      {
        idea_id: "00000000-0000-0000-0000-000000000001",
        column_id: "00000000-0000-0000-0000-000000000002",
        title: "Test task",
      },
      {}
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toMatch(/^Error: /);
  });

  it("returns error result on schema validation failure", async () => {
    const server = createMockServer();
    const getContext = vi.fn(() => ({
      supabase: {} as McpContext["supabase"],
      userId: "test-user",
    }));

    registerTools(server, getContext);

    // Invoke get_idea (index 1) with invalid args (missing required idea_id)
    const callback = server.tool.mock.calls[1][3];
    const result = await callback({}, {});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Error:");
  });

  it("calls getContext with the extra argument", async () => {
    const server = createMockServer();
    const getContext = vi.fn(() => {
      throw new Error("stop here");
    });

    registerTools(server, getContext);

    const extra = { authInfo: { token: "abc", userId: "user-1" } };
    const callback = server.tool.mock.calls[0][3];
    await callback({}, extra);

    expect(getContext).toHaveBeenCalledWith(extra);
  });

  it("includes agent tools in the registered set", () => {
    const server = createMockServer();
    const getContext = vi.fn();

    registerTools(server, getContext);

    const registeredNames = server.tool.mock.calls.map(
      (call: unknown[]) => call[0]
    );
    expect(registeredNames).toContain("list_agents");
    expect(registeredNames).toContain("get_agent_prompt");
    expect(registeredNames).toContain("set_agent_identity");
    expect(registeredNames).toContain("create_agent");
  });

  it("set_agent_identity calls onIdentityChange when provided", async () => {
    const server = createMockServer();
    // Mock supabase with chained update call for identity persistence
    const mockUpdate = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    const mockFrom = vi.fn().mockReturnValue({ update: mockUpdate });
    const mockContext: McpContext = {
      supabase: { from: mockFrom } as unknown as McpContext["supabase"],
      userId: "test-user",
    };
    const getContext = vi.fn(() => mockContext);
    const onIdentityChange = vi.fn();

    registerTools(server, getContext, onIdentityChange);

    // Find set_agent_identity tool
    const setIdentityCall = server.tool.mock.calls.find(
      (call: unknown[]) => call[0] === "set_agent_identity"
    );
    expect(setIdentityCall).toBeDefined();

    const callback = setIdentityCall![3];
    // Call with no args to reset identity
    const result = await callback({}, {});

    expect(result.isError).toBeUndefined();
    expect(onIdentityChange).toHaveBeenCalledWith(null);
    expect(mockFrom).toHaveBeenCalledWith("users");
    expect(mockUpdate).toHaveBeenCalledWith({ active_bot_id: null });
  });

  it("set_agent_identity uses noop when onIdentityChange not provided", async () => {
    const server = createMockServer();
    // Mock supabase with chained update call for identity persistence
    const mockUpdate = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    const mockFrom = vi.fn().mockReturnValue({ update: mockUpdate });
    const mockContext: McpContext = {
      supabase: { from: mockFrom } as unknown as McpContext["supabase"],
      userId: "test-user",
    };
    const getContext = vi.fn(() => mockContext);

    // Don't pass onIdentityChange
    registerTools(server, getContext);

    const setIdentityCall = server.tool.mock.calls.find(
      (call: unknown[]) => call[0] === "set_agent_identity"
    );
    const callback = setIdentityCall![3];

    // Should not throw when onIdentityChange is undefined
    const result = await callback({}, {});
    expect(result.isError).toBeUndefined();
  });

  it("list_agents returns error with non-functional supabase", async () => {
    const server = createMockServer();
    const mockContext: McpContext = {
      supabase: {} as McpContext["supabase"],
      userId: "test-user",
    };
    const getContext = vi.fn(() => mockContext);

    registerTools(server, getContext);

    const listBotsCall = server.tool.mock.calls.find(
      (call: unknown[]) => call[0] === "list_agents"
    );
    const callback = listBotsCall![3];
    const result = await callback({}, {});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/^Error: /);
  });

  it("create_agent validates required name field", async () => {
    const server = createMockServer();
    const mockContext: McpContext = {
      supabase: {} as McpContext["supabase"],
      userId: "test-user",
    };
    const getContext = vi.fn(() => mockContext);

    registerTools(server, getContext);

    const createBotCall = server.tool.mock.calls.find(
      (call: unknown[]) => call[0] === "create_agent"
    );
    const callback = createBotCall![3];

    // Missing required name
    const result = await callback({}, {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Error:");
  });
});
