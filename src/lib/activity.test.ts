import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabaseClient } from "@/test/mocks";

const mockClient = createMockSupabaseClient();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => mockClient,
}));

import { logTaskActivity } from "./activity";

describe("logTaskActivity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Make the chain resolve to simulate Supabase response
    mockClient._chain.insert.mockReturnValue({
      then: (cb: (result: { error: null }) => void) => cb({ error: null }),
    });
  });

  it("inserts into board_task_activity table", () => {
    logTaskActivity("task-1", "idea-1", "actor-1", "created");

    expect(mockClient.from).toHaveBeenCalledWith("board_task_activity");
    expect(mockClient._chain.insert).toHaveBeenCalledWith({
      task_id: "task-1",
      idea_id: "idea-1",
      actor_id: "actor-1",
      action: "created",
      details: null,
    });
  });

  it("passes details when provided", () => {
    logTaskActivity("task-1", "idea-1", "actor-1", "moved", {
      to_column: "In Progress",
    });

    expect(mockClient._chain.insert).toHaveBeenCalledWith({
      task_id: "task-1",
      idea_id: "idea-1",
      actor_id: "actor-1",
      action: "moved",
      details: { to_column: "In Progress" },
    });
  });

  it("defaults details to null when omitted", () => {
    logTaskActivity("task-1", "idea-1", "actor-1", "archived");

    expect(mockClient._chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ details: null })
    );
  });

  it("logs error to console.error on failure", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockClient._chain.insert.mockReturnValue({
      then: (cb: (result: { error: { message: string } }) => void) =>
        cb({ error: { message: "RLS violation" } }),
    });

    logTaskActivity("task-1", "idea-1", "actor-1", "created");

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to log activity")
    );
    consoleSpy.mockRestore();
  });

  it("does not throw on error (fire-and-forget)", () => {
    mockClient._chain.insert.mockReturnValue({
      then: (cb: (result: { error: { message: string } }) => void) =>
        cb({ error: { message: "failure" } }),
    });

    expect(() => {
      logTaskActivity("task-1", "idea-1", "actor-1", "created");
    }).not.toThrow();
  });
});
