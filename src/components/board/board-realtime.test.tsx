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
// Non-postgres_changes .on() registrations (e.g. the "system" channel-error
// handler board-realtime wires up). Tracked separately so they don't
// masquerade as table subscriptions.
const systemEvents: string[] = [];
// Board-refresh-registry callback — replaces router.refresh() as of the
// force-dynamic loading.tsx skeleton fix. BoardRealtime must call this (and
// must NEVER call router.refresh, which always re-suspends this segment).
const mockRefreshBoard = vi.fn((_ideaId: string) => Promise.resolve());
const mockUnsubscribe = vi.fn();
// Status callbacks passed to `channel.subscribe(cb)`, in call order — one per
// createChannel() (the initial subscription, then one more per reconnect()).
// Lets tests drive SUBSCRIBED/TIMED_OUT/CHANNEL_ERROR without depending on a
// real Realtime connection.
type StatusCallback = (status: string) => void;
const subscribeCallbacks: StatusCallback[] = [];

// Build a chainable channel mock that records subscriptions. Only
// `postgres_changes` registrations are real table subscriptions; other events
// (e.g. "system") are recorded separately — board-realtime registers a
// channel-error logger via `.on("system", …)` that is NOT a table subscription
// and legitimately carries no table/filter.
function createChannelMock() {
  const channelObj = {
    on: vi.fn((event: string, opts: { table?: string; filter?: string }, handler: Handler) => {
      if (event === "postgres_changes") {
        subscriptions.push({ table: opts.table!, filter: opts.filter, handler });
      } else {
        systemEvents.push(event);
      }
      return channelObj;
    }),
    subscribe: vi.fn((cb: StatusCallback) => {
      subscribeCallbacks.push(cb);
      return channelObj;
    }),
    unsubscribe: mockUnsubscribe,
  };
  return channelObj;
}

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    channel: () => createChannelMock(),
  }),
}));

vi.mock("./board-refresh-registry", () => ({
  refreshBoard: (ideaId: string) => mockRefreshBoard(ideaId),
}));

// Must import after mocks are set up
import { BoardRealtime } from "./board-realtime";

describe("BoardRealtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    subscriptions.length = 0;
    systemEvents.length = 0;
    subscribeCallbacks.length = 0;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("subscribes to 6 tables (not 7 — comments and attachments removed)", () => {
    render(<BoardRealtime ideaId="idea-1" taskIds={["task-1", "task-2"]} />);

    const tables = subscriptions.map((s) => s.table);
    expect(tables).toContain("board_columns");
    expect(tables).toContain("board_tasks");
    expect(tables).toContain("board_labels");
    expect(tables).toContain("board_task_labels");
    expect(tables).toContain("task_workflow_steps");
    expect(tables).toContain("workflow_suggestions");
    expect(tables).not.toContain("board_task_comments");
    expect(tables).not.toContain("board_task_attachments");
    expect(tables).toHaveLength(6);
  });

  it("does not count the non-postgres 'system' channel-error handler as a table subscription", () => {
    render(<BoardRealtime ideaId="idea-1" taskIds={[]} />);

    // board-realtime also registers a `.on("system", …)` channel-error logger.
    // It must NOT be treated as a table subscription (it has no table/filter).
    // Regression guard for the prior failures where it inflated the count
    // and tripped the "filtered by idea_id" assertion with filter: undefined.
    expect(systemEvents).toContain("system");
    expect(subscriptions).toHaveLength(6);
    expect(subscriptions.every((s) => typeof s.table === "string" && s.table.length > 0)).toBe(true);
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
    expect(mockRefreshBoard).not.toHaveBeenCalled();

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
    expect(mockRefreshBoard).toHaveBeenCalledTimes(1);
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
    expect(mockRefreshBoard).toHaveBeenCalledTimes(1);
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
    expect(mockRefreshBoard).toHaveBeenCalledTimes(1);

    // Follow-up refresh at 1500ms
    vi.advanceTimersByTime(1000);
    expect(mockRefreshBoard).toHaveBeenCalledTimes(2);
  });

  it("cleans up timers and unsubscribes on unmount", () => {
    const { unmount } = render(<BoardRealtime ideaId="idea-1" taskIds={[]} />);
    unmount();
    expect(mockUnsubscribe).toHaveBeenCalled();
  });

  it("calls the board-refresh-registry callback with the ideaId, not router.refresh", () => {
    // This file intentionally does NOT mock "next/navigation" — board-realtime
    // no longer imports useRouter at all. If a future change reintroduces
    // router.refresh(), this suite fails at render time instead of silently
    // re-flashing the loading.tsx skeleton in production.
    render(<BoardRealtime ideaId="idea-42" taskIds={[]} />);

    const columnsSub = subscriptions.find((s) => s.table === "board_columns");
    columnsSub!.handler({
      eventType: "UPDATE",
      new: { id: "col-1", idea_id: "idea-42" },
      old: {},
      schema: "public",
      table: "board_columns",
      commit_timestamp: "",
      errors: null,
    } as unknown as RealtimePostgresChangesPayload<Record<string, unknown>>);

    vi.advanceTimersByTime(600);
    expect(mockRefreshBoard).toHaveBeenCalledTimes(1);
    expect(mockRefreshBoard).toHaveBeenCalledWith("idea-42");
  });

  it("refetches via the registry (not router.refresh) once reconnected after a dropped channel", () => {
    render(<BoardRealtime ideaId="idea-1" taskIds={[]} />);
    expect(subscribeCallbacks).toHaveLength(1);

    // Report the initial channel as errored — schedules reconnect() after
    // RECONNECT_DELAY_MS (2000ms).
    subscribeCallbacks[0]("CHANNEL_ERROR");
    expect(mockRefreshBoard).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2000);
    // reconnect() unsubscribed the dead channel, created a fresh one, and
    // called its own subscribe() — a second status callback is now available.
    expect(mockUnsubscribe).toHaveBeenCalled();
    expect(subscribeCallbacks).toHaveLength(2);

    // The fresh channel comes up healthy.
    subscribeCallbacks[1]("SUBSCRIBED");

    // Reconnect refetches immediately (no debounce) to pull full current
    // state — nothing is "missed" the way an incremental event stream could
    // drop one across the disconnect window.
    expect(mockRefreshBoard).toHaveBeenCalledTimes(1);
    expect(mockRefreshBoard).toHaveBeenCalledWith("idea-1");
  });
});
