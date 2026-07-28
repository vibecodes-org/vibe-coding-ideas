import { describe, it, expect, vi } from "vitest";
import {
  composeBoardColumns,
  composeSuggestionsByTask,
  composeCoverImageUrls,
  fetchTaskLabelsByLabelIds,
} from "./board-refetch";
import { WORKFLOW_AI_ADJUDICATION_TIMEOUT_MS } from "@/lib/workflow-suggestion-constants";
import { IN_FILTER_CHUNK_SIZE } from "@/lib/db-helpers";
import type { BoardColumn, BoardTask } from "@/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

function makeColumn(overrides: Partial<BoardColumn> = {}): BoardColumn {
  return {
    id: "col-1",
    idea_id: "idea-1",
    title: "To Do",
    position: 0,
    is_done_column: false,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  } as BoardColumn;
}

function makeTask(overrides: Partial<BoardTask> & { assignee?: unknown } = {}): BoardTask & { assignee: unknown } {
  return {
    id: "task-1",
    idea_id: "idea-1",
    column_id: "col-1",
    title: "Task",
    description: null,
    position: 0,
    assignee_id: null,
    due_date: null,
    archived: false,
    attachment_count: 0,
    comment_count: 0,
    cover_image_path: null,
    workflow_step_total: 0,
    workflow_step_completed: 0,
    workflow_step_in_progress: 0,
    workflow_step_failed: 0,
    workflow_step_awaiting_approval: 0,
    workflow_step_started_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    assignee: null,
    ...overrides,
  } as unknown as BoardTask & { assignee: unknown };
}

describe("composeBoardColumns", () => {
  it("happy path: buckets tasks into their column, attaches assignee and labels", () => {
    const columns = [makeColumn({ id: "col-1" }), makeColumn({ id: "col-2", title: "Done" })];
    const user = { id: "user-1", full_name: "Ada" };
    const tasks = [
      makeTask({ id: "task-1", column_id: "col-1", assignee: user }),
      makeTask({ id: "task-2", column_id: "col-2", assignee: null }),
    ];
    const labelRows = [
      { task_id: "task-1", label: { id: "label-1", name: "Bug", color: "#f00" } },
      { task_id: "task-1", label: { id: "label-2", name: "P1", color: "#00f" } },
    ];

    const result = composeBoardColumns(columns, tasks, labelRows);

    expect(result).toHaveLength(2);
    const col1 = result.find((c) => c.id === "col-1")!;
    expect(col1.tasks).toHaveLength(1);
    expect(col1.tasks[0].id).toBe("task-1");
    expect(col1.tasks[0].assignee).toEqual(user);
    expect(col1.tasks[0].labels.map((l) => l.id).sort()).toEqual(["label-1", "label-2"]);

    const col2 = result.find((c) => c.id === "col-2")!;
    expect(col2.tasks).toHaveLength(1);
    expect(col2.tasks[0].assignee).toBeNull();
    expect(col2.tasks[0].labels).toEqual([]);
  });

  it("empty board: no columns, no tasks", () => {
    expect(composeBoardColumns([], [], [])).toEqual([]);
  });

  it("empty board: columns with no tasks get an empty tasks array", () => {
    const columns = [makeColumn({ id: "col-1" })];
    const result = composeBoardColumns(columns, [], null);
    expect(result).toEqual([{ ...columns[0], tasks: [] }]);
  });

  it("nullish assignee (falsy, not undefined) normalizes to null", () => {
    const columns = [makeColumn({ id: "col-1" })];
    const tasks = [makeTask({ id: "task-1", column_id: "col-1", assignee: undefined })];
    const result = composeBoardColumns(columns, tasks, null);
    expect(result[0].tasks[0].assignee).toBeNull();
  });

  it("drops label rows whose label join came back null (e.g. label since deleted)", () => {
    const columns = [makeColumn({ id: "col-1" })];
    const tasks = [makeTask({ id: "task-1", column_id: "col-1" })];
    const labelRows = [{ task_id: "task-1", label: null }];
    const result = composeBoardColumns(columns, tasks, labelRows);
    expect(result[0].tasks[0].labels).toEqual([]);
  });
});

describe("composeSuggestionsByTask", () => {
  const now = Date.parse("2026-07-11T12:00:00Z");

  it("happy path: maps one indicator per task", () => {
    const rows = [
      { task_id: "task-1", source: "ai" as const, reason: "Looks like a bug fix", adjudication_started_at: null },
      { task_id: "task-2", source: "heuristic" as const, reason: null, adjudication_started_at: null },
    ];
    const result = composeSuggestionsByTask(rows, now);
    expect(result).toEqual({
      "task-1": { source: "ai", adjudicating: false },
      "task-2": { source: "heuristic", adjudicating: false },
    });
  });

  it("empty board: null and empty-array rows both produce an empty map", () => {
    expect(composeSuggestionsByTask(null, now)).toEqual({});
    expect(composeSuggestionsByTask([], now)).toEqual({});
  });

  it("first open suggestion wins when a task has more than one row", () => {
    const rows = [
      { task_id: "task-1", source: "ai" as const, reason: "first", adjudication_started_at: null },
      { task_id: "task-1", source: "heuristic" as const, reason: "second", adjudication_started_at: null },
    ];
    const result = composeSuggestionsByTask(rows, now);
    expect(result["task-1"].source).toBe("ai");
  });

  it("marks adjudicating true only while reason is unset and within the timeout window", () => {
    const startedRecently = new Date(now - 1000).toISOString();
    const startedTooLongAgo = new Date(now - WORKFLOW_AI_ADJUDICATION_TIMEOUT_MS - 1000).toISOString();

    expect(
      composeSuggestionsByTask(
        [{ task_id: "task-1", source: "ai", reason: null, adjudication_started_at: startedRecently }],
        now
      )["task-1"].adjudicating
    ).toBe(true);

    expect(
      composeSuggestionsByTask(
        [{ task_id: "task-1", source: "ai", reason: null, adjudication_started_at: startedTooLongAgo }],
        now
      )["task-1"].adjudicating
    ).toBe(false);

    expect(
      composeSuggestionsByTask(
        [{ task_id: "task-1", source: "ai", reason: "resolved", adjudication_started_at: startedRecently }],
        now
      )["task-1"].adjudicating
    ).toBe(false);
  });
});

describe("composeCoverImageUrls", () => {
  it("happy path: maps path → signedUrl", () => {
    const result = composeCoverImageUrls([
      { path: "a/cover.png", signedUrl: "https://signed/a" },
      { path: "b/cover.png", signedUrl: "https://signed/b" },
    ]);
    expect(result).toEqual({
      "a/cover.png": "https://signed/a",
      "b/cover.png": "https://signed/b",
    });
  });

  it("no cover images: null and empty array both produce an empty map", () => {
    expect(composeCoverImageUrls(null)).toEqual({});
    expect(composeCoverImageUrls([])).toEqual({});
  });

  it("skips entries the storage API could not sign (missing path or url)", () => {
    const result = composeCoverImageUrls([
      { path: "ok/cover.png", signedUrl: "https://signed/ok" },
      { path: null, signedUrl: "https://orphan" },
      { path: "empty/cover.png", signedUrl: "" },
    ]);
    expect(result).toEqual({ "ok/cover.png": "https://signed/ok" });
  });
});

describe("fetchTaskLabelsByLabelIds", () => {
  /**
   * Minimal chainable mock of the `.from(...).select(...).in("label_id", chunk)`
   * path this function issues — enough to assert call shape/count without a
   * real Supabase client.
   */
  function makeMockSupabase(
    handler: (labelIds: string[]) => { data: unknown[] | null; error: { message: string } | null }
  ) {
    const inCalls: string[][] = [];
    const from = vi.fn((_table: string) => ({
      select: vi.fn((_cols: string) => ({
        in: vi.fn((_col: string, ids: string[]) => {
          inCalls.push(ids);
          return Promise.resolve(handler(ids));
        }),
      })),
    }));
    return { client: { from } as unknown as SupabaseClient<Database>, from, inCalls };
  }

  it("empty labelIds: returns an empty result and issues no query at all", async () => {
    const { client, from } = makeMockSupabase(() => ({ data: [], error: null }));
    const result = await fetchTaskLabelsByLabelIds(client, []);
    expect(result).toEqual({ data: [], error: null });
    expect(from).not.toHaveBeenCalled();
  });

  it("happy path: labelIds under the chunk limit issue exactly one .in() call", async () => {
    const rows = [{ task_id: "task-1", label: { id: "label-1", name: "Bug" } }];
    const { client, inCalls } = makeMockSupabase(() => ({ data: rows, error: null }));
    const result = await fetchTaskLabelsByLabelIds(client, ["label-1"]);
    expect(result).toEqual({ data: rows, error: null });
    expect(inCalls).toEqual([["label-1"]]);
  });

  it("chunk boundary: exactly IN_FILTER_CHUNK_SIZE ids is one call, one more is two", async () => {
    const atLimit = Array.from({ length: IN_FILTER_CHUNK_SIZE }, (_, i) => `label-${i}`);
    const overLimit = [...atLimit, "label-overflow"];

    const atLimitMock = makeMockSupabase(() => ({ data: [], error: null }));
    await fetchTaskLabelsByLabelIds(atLimitMock.client, atLimit);
    expect(atLimitMock.inCalls).toHaveLength(1);
    expect(atLimitMock.inCalls[0]).toHaveLength(IN_FILTER_CHUNK_SIZE);

    const overLimitMock = makeMockSupabase(() => ({ data: [], error: null }));
    await fetchTaskLabelsByLabelIds(overLimitMock.client, overLimit);
    expect(overLimitMock.inCalls).toHaveLength(2);
    expect(overLimitMock.inCalls[0]).toHaveLength(IN_FILTER_CHUNK_SIZE);
    expect(overLimitMock.inCalls[1]).toEqual(["label-overflow"]);
  });

  it("results from every chunk are flattened into one array (this is the dashboard's multi-idea path)", async () => {
    const overLimit = Array.from({ length: IN_FILTER_CHUNK_SIZE + 1 }, (_, i) => `label-${i}`);
    const { client } = makeMockSupabase((ids) => ({
      data: ids.map((id) => ({ task_id: `task-${id}`, label: { id, name: id } })),
      error: null,
    }));
    const result = await fetchTaskLabelsByLabelIds(client, overLimit);
    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(overLimit.length);
  });

  it("error path: a failing chunk surfaces a single error and no partial data", async () => {
    const overLimit = Array.from({ length: IN_FILTER_CHUNK_SIZE + 1 }, (_, i) => `label-${i}`);
    let call = 0;
    const { client } = makeMockSupabase(() => {
      call++;
      // Fail the second chunk — proves a single bad chunk isn't silently
      // dropped in favour of the rest ("partial" results would hide data).
      return call === 2 ? { data: null, error: { message: "boom" } } : { data: [], error: null };
    });
    const result = await fetchTaskLabelsByLabelIds(client, overLimit);
    expect(result).toEqual({ data: null, error: { message: "boom" } });
  });
});
