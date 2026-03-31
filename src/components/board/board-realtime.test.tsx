import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";

// Capture subscription handlers registered via .on()
type Handler = (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => void;
interface Subscription {
  table: string;
  filter?: string;
  handler: Handler;
}

const subscriptions: Subscription[] = [];
const mockRefresh = vi.fn();
const mockUnsubscribe = vi.fn();

// Build a chainable channel mock that records subscriptions
function createChannelMock() {
  const channelObj = {
    on: vi.fn((_event: string, opts: { table: string; filter?: string }, handler: Handler) => {
      subscriptions.push({ table: opts.table, filter: opts.filter, handler });
      return channelObj;
    }),
    subscribe: vi.fn(() => channelObj),
    unsubscribe: mockUnsubscribe,
  };
  return channelObj;
}

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    channel: () => createChannelMock(),
  }),
}));

// Must import after mocks are set up
import { BoardRealtime } from "./board-realtime";

describe("BoardRealtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    subscriptions.length = 0;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("subscribes to 5 tables (not 7 — comments and attachments removed)", () => {
    render(<BoardRealtime ideaId="idea-1" taskIds={["task-1", "task-2"]} />);

    const tables = subscriptions.map((s) => s.table);
    expect(tables).toContain("board_columns");
    expect(tables).toContain("board_tasks");
    expect(tables).toContain("board_labels");
    expect(tables).toContain("board_task_labels");
    expect(tables).toContain("task_workflow_steps");
    expect(tables).not.toContain("board_task_comments");
    expect(tables).not.toContain("board_task_attachments");
    expect(tables).toHaveLength(5);
  });

  it("filters board_task_labels by task_id — ignores events from other boards", () => {
    render(<BoardRealtime ideaId="idea-1" taskIds={["task-1", "task-2"]} />);

    const labelSub = subscriptions.find((s) => s.table === "board_task_labels");
    expect(labelSub).toBeDefined();
    expect(labelSub!.filter).toBeUndefined(); // Still unfiltered at Supabase level

    // Fire event for a task NOT on this board
    labelSub!.handler({
      eventType: "INSERT",
      new: { id: "tl-1", task_id: "task-other-board", label_id: "label-1" },
      old: {},
      schema: "public",
      table: "board_task_labels",
      commit_timestamp: "",
      errors: null,
    } as unknown as RealtimePostgresChangesPayload<Record<string, unknown>>);

    vi.advanceTimersByTime(600);
    expect(mockRefresh).not.toHaveBeenCalled();

    // Fire event for a task ON this board
    labelSub!.handler({
      eventType: "INSERT",
      new: { id: "tl-2", task_id: "task-1", label_id: "label-2" },
      old: {},
      schema: "public",
      table: "board_task_labels",
      commit_timestamp: "",
      errors: null,
    } as unknown as RealtimePostgresChangesPayload<Record<string, unknown>>);

    vi.advanceTimersByTime(600);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("filters board_task_labels DELETE events using old record", () => {
    render(<BoardRealtime ideaId="idea-1" taskIds={["task-1"]} />);

    const labelSub = subscriptions.find((s) => s.table === "board_task_labels");

    // DELETE event — new is empty, old has the task_id
    labelSub!.handler({
      eventType: "DELETE",
      new: {},
      old: { id: "tl-1", task_id: "task-1", label_id: "label-1" },
      schema: "public",
      table: "board_task_labels",
      commit_timestamp: "",
      errors: null,
    } as unknown as RealtimePostgresChangesPayload<Record<string, unknown>>);

    vi.advanceTimersByTime(600);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("all non-label subscriptions are filtered by idea_id", () => {
    render(<BoardRealtime ideaId="idea-123" taskIds={[]} />);

    const filteredSubs = subscriptions.filter((s) => s.table !== "board_task_labels");
    for (const sub of filteredSubs) {
      expect(sub.filter).toBe("idea_id=eq.idea-123");
    }
  });

  it("workflow steps use follow-up refresh (double debounce)", () => {
    render(<BoardRealtime ideaId="idea-1" taskIds={[]} />);

    const workflowSub = subscriptions.find((s) => s.table === "task_workflow_steps");

    workflowSub!.handler({
      eventType: "UPDATE",
      new: { id: "step-1", idea_id: "idea-1" },
      old: {},
      schema: "public",
      table: "task_workflow_steps",
      commit_timestamp: "",
      errors: null,
    } as unknown as RealtimePostgresChangesPayload<Record<string, unknown>>);

    // First refresh at 500ms
    vi.advanceTimersByTime(500);
    expect(mockRefresh).toHaveBeenCalledTimes(1);

    // Follow-up refresh at 1500ms
    vi.advanceTimersByTime(1000);
    expect(mockRefresh).toHaveBeenCalledTimes(2);
  });

  it("cleans up timers and unsubscribes on unmount", () => {
    const { unmount } = render(<BoardRealtime ideaId="idea-1" taskIds={[]} />);
    unmount();
    expect(mockUnsubscribe).toHaveBeenCalled();
  });
});
