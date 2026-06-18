import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The supabase mock is a tiny query builder that records the table + the
 * chained filters and, when terminated with `.maybeSingle()` / `.single()`,
 * resolves whatever the per-table handler returns. Handlers are installed per
 * test via `setTable()`.
 */

type Filters = Record<string, unknown>;

interface QueryState {
  table: string;
  op: "select" | "update" | "insert" | "delete";
  filters: Filters;
}

let handlers: Record<
  string,
  (state: QueryState) => { data: unknown; error: unknown }
>;
const calls: QueryState[] = [];

function makeBuilder(table: string) {
  const state: QueryState = { table, op: "select", filters: {} };

  const builder: Record<string, unknown> = {
    select: () => builder,
    insert: () => {
      state.op = "insert";
      return builder;
    },
    update: (v: unknown) => {
      state.op = "update";
      state.filters.__update = v;
      return builder;
    },
    delete: () => {
      state.op = "delete";
      return builder;
    },
    eq: (col: string, val: unknown) => {
      state.filters[col] = val;
      return builder;
    },
    maybeSingle: () => {
      calls.push({ ...state, filters: { ...state.filters } });
      return Promise.resolve(handlers[`${table}:${state.op}`](state));
    },
    single: () => {
      calls.push({ ...state, filters: { ...state.filters } });
      return Promise.resolve(handlers[`${table}:${state.op}`](state));
    },
  };
  return builder;
}

const mockGetUser = vi.fn();
const mockApply = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: (table: string) => makeBuilder(table),
    auth: { getUser: () => mockGetUser() },
  }),
}));

vi.mock("@/actions/workflow-templates", () => ({
  applyWorkflowTemplateWithContext: (...args: unknown[]) => mockApply(...args),
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

function setHandler(
  key: string,
  fn: (state: QueryState) => { data: unknown; error: unknown }
) {
  handlers[key] = fn;
}

/** Default: authed human, open suggestion, successful claim + apply. */
function happyDefaults(overrides?: {
  suggestion?: Record<string, unknown> | null;
  isBot?: boolean;
}) {
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });

  setHandler("users:select", () => ({
    data: { is_bot: overrides?.isBot ?? false },
    error: null,
  }));

  const suggestion =
    overrides?.suggestion === undefined
      ? {
          id: "sug-1",
          idea_id: "idea-1",
          task_id: "task-1",
          suggested_template_id: "tpl-1",
          status: "suggested",
        }
      : overrides.suggestion;

  setHandler("workflow_suggestions:select", () => ({
    data: suggestion,
    error: null,
  }));

  // Claim update succeeds (returns a row) by default.
  setHandler("workflow_suggestions:update", () => ({
    data: { id: "sug-1" },
    error: null,
  }));

  setHandler("workflow_templates:select", () => ({
    data: { id: "tpl-2" },
    error: null,
  }));

  mockApply.mockResolvedValue({ run: { id: "run-1" }, steps: [] });
}

function lastUpdate(table: string) {
  const update = [...calls]
    .reverse()
    .find((c) => c.table === table && c.op === "update");
  return update?.filters;
}

async function getActions() {
  return await import("./workflow-suggestions");
}

describe("workflow-suggestions server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handlers = {};
    calls.length = 0;
  });

  describe("keepWorkflowSuggestion (AC-5)", () => {
    it("applies the suggested template and marks the suggestion accepted", async () => {
      happyDefaults();
      const { keepWorkflowSuggestion } = await getActions();

      const result = await keepWorkflowSuggestion("sug-1");

      expect(result).toEqual({ success: true, run: { run: { id: "run-1" }, steps: [] } });
      // Applied the ORIGINAL suggested template.
      expect(mockApply).toHaveBeenCalledWith(
        expect.anything(),
        "user-1",
        "task-1",
        "tpl-1"
      );
      const upd = lastUpdate("workflow_suggestions")?.__update as Record<string, unknown>;
      expect(upd.status).toBe("accepted");
      expect(upd.resolved_by).toBe("user-1");
      expect(upd.resolved_at).toBeTruthy();
    });

    it("errors and does not apply when the suggestion is already resolved (concurrency guard)", async () => {
      happyDefaults();
      // The concurrency-guarded claim matches zero rows.
      setHandler("workflow_suggestions:update", () => ({ data: null, error: null }));

      const { keepWorkflowSuggestion } = await getActions();
      const result = await keepWorkflowSuggestion("sug-1");

      expect(result).toEqual({ error: "This suggestion has already been resolved." });
      expect(mockApply).not.toHaveBeenCalled();
    });

    it("errors when the suggestion no longer exists / is not 'suggested'", async () => {
      happyDefaults({ suggestion: null });
      const { keepWorkflowSuggestion } = await getActions();

      const result = await keepWorkflowSuggestion("sug-1");
      expect(result).toEqual({ error: "This suggestion has already been resolved." });
      expect(mockApply).not.toHaveBeenCalled();
    });
  });

  describe("replaceWorkflowSuggestion (AC-6)", () => {
    it("applies the replacement, not the original, and marks the suggestion replaced", async () => {
      happyDefaults();
      const { replaceWorkflowSuggestion } = await getActions();

      const result = await replaceWorkflowSuggestion("sug-1", "tpl-2");

      expect(result).toEqual({ success: true, run: { run: { id: "run-1" }, steps: [] } });
      // Applied the REPLACEMENT template, never the original tpl-1.
      expect(mockApply).toHaveBeenCalledWith(
        expect.anything(),
        "user-1",
        "task-1",
        "tpl-2"
      );
      expect(mockApply).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        "tpl-1"
      );
      const upd = lastUpdate("workflow_suggestions")?.__update as Record<string, unknown>;
      expect(upd.status).toBe("replaced");
      expect(upd.replacement_template_id).toBe("tpl-2");
    });

    it("rejects a template that is not in the idea's available templates", async () => {
      happyDefaults();
      // Replacement lookup scoped to idea returns nothing.
      setHandler("workflow_templates:select", () => ({ data: null, error: null }));

      const { replaceWorkflowSuggestion } = await getActions();
      const result = await replaceWorkflowSuggestion("sug-1", "tpl-other");

      expect(result).toEqual({ error: "That template isn't available for this idea." });
      expect(mockApply).not.toHaveBeenCalled();
    });

    it("errors and does not apply when already resolved (concurrency guard)", async () => {
      happyDefaults();
      setHandler("workflow_suggestions:update", () => ({ data: null, error: null }));

      const { replaceWorkflowSuggestion } = await getActions();
      const result = await replaceWorkflowSuggestion("sug-1", "tpl-2");

      expect(result).toEqual({ error: "This suggestion has already been resolved." });
      expect(mockApply).not.toHaveBeenCalled();
    });
  });

  describe("removeWorkflowSuggestion (AC-7)", () => {
    it("dismisses without applying any template (label untouched)", async () => {
      happyDefaults();
      const { removeWorkflowSuggestion } = await getActions();

      const result = await removeWorkflowSuggestion("sug-1");

      expect(result).toEqual({ success: true });
      expect(mockApply).not.toHaveBeenCalled();
      const upd = lastUpdate("workflow_suggestions")?.__update as Record<string, unknown>;
      expect(upd.status).toBe("dismissed");
      expect(upd.resolved_by).toBe("user-1");
      // No template/label fields touched.
      expect(upd.replacement_template_id).toBeUndefined();
    });

    it("errors when already resolved (concurrency guard)", async () => {
      happyDefaults();
      setHandler("workflow_suggestions:update", () => ({ data: null, error: null }));

      const { removeWorkflowSuggestion } = await getActions();
      const result = await removeWorkflowSuggestion("sug-1");

      expect(result).toEqual({ error: "This suggestion has already been resolved." });
    });
  });

  describe("auth & human-only enforcement", () => {
    it("errors (no throw) when the caller is unauthenticated", async () => {
      happyDefaults();
      mockGetUser.mockResolvedValue({ data: { user: null } });

      const { keepWorkflowSuggestion } = await getActions();
      const result = await keepWorkflowSuggestion("sug-1");

      expect(result).toEqual({
        error: "You must be signed in to resolve a suggestion.",
      });
      expect(mockApply).not.toHaveBeenCalled();
    });

    it("rejects a bot/agent identity — resolution is human-only (AC-23)", async () => {
      happyDefaults({ isBot: true });

      const { keepWorkflowSuggestion } = await getActions();
      const result = await keepWorkflowSuggestion("sug-1");

      expect(result).toEqual({
        error: "Workflow suggestions can only be resolved by a human team member.",
      });
      expect(mockApply).not.toHaveBeenCalled();
    });

    it("returns a toast-friendly error (not a throw) when apply fails", async () => {
      happyDefaults();
      mockApply.mockRejectedValue(new Error("This task already has an active workflow."));

      const { keepWorkflowSuggestion } = await getActions();
      const result = await keepWorkflowSuggestion("sug-1");

      expect(result).toEqual({ error: "This task already has an active workflow." });
    });
  });
});
