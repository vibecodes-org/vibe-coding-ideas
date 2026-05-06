import { describe, it, expect, vi, beforeEach } from "vitest";

// Supabase chain — every method returns the chain itself so calls can be
// chained arbitrarily; terminals (single/maybeSingle) return data/error.
const chain: Record<string, unknown> = {};
const mockFrom = vi.fn(() => chain);
const mockSelect = vi.fn(() => chain);
const mockUpdate = vi.fn(() => chain);
const mockInsert = vi.fn(() => Promise.resolve({ data: null, error: null }));
const mockEq = vi.fn(() => chain);
const mockIn = vi.fn(() => chain);
const mockSingle = vi.fn();
const mockMaybeSingle = vi.fn();
Object.assign(chain, {
  select: mockSelect,
  update: mockUpdate,
  insert: mockInsert,
  eq: mockEq,
  in: mockIn,
  single: mockSingle,
  maybeSingle: mockMaybeSingle,
});

const HUMAN_USER_ID = "human-user-1";
const BOT_USER_ID = "bot-user-1";

const mockGetUser = vi.fn().mockResolvedValue({
  data: { user: { id: HUMAN_USER_ID } },
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: (...args: unknown[]) => mockFrom(...args),
    auth: { getUser: () => mockGetUser() },
  }),
}));

vi.mock("@/lib/workflow-helpers", () => ({
  checkAndCompleteRun: vi.fn().mockResolvedValue(false),
}));

import { completeWorkflowStep, failWorkflowStep } from "./workflow";

describe("completeWorkflowStep — manual UI submission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not throw when the step is bot-assigned and the caller is a human", async () => {
    // First call: SELECT returns the existing step; second call: UPDATE returns the row.
    mockSingle.mockResolvedValueOnce({
      data: { human_check_required: false, idea_id: "idea-1" },
      error: null,
    });
    mockMaybeSingle.mockResolvedValueOnce({
      data: { id: "step-1", run_id: null, status: "completed" },
      error: null,
    });

    await expect(completeWorkflowStep("step-1")).resolves.toBeDefined();
  });

  it("transitions to awaiting_approval when human_check_required is true", async () => {
    mockSingle.mockResolvedValueOnce({
      data: { human_check_required: true, idea_id: "idea-1" },
      error: null,
    });
    mockMaybeSingle.mockResolvedValueOnce({
      data: { id: "step-1", run_id: null, status: "awaiting_approval" },
      error: null,
    });

    await completeWorkflowStep("step-1", "manual deliverable text");

    // Verify the update was issued with status = awaiting_approval and the
    // provided output. The first .update() call is the one we care about.
    const updateArgs = mockUpdate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(updateArgs?.status).toBe("awaiting_approval");
    expect(updateArgs?.output).toBe("manual deliverable text");
    // awaiting_approval must NOT set completed_at
    expect(updateArgs?.completed_at).toBeNull();
  });

  it("transitions to completed when human_check_required is false", async () => {
    mockSingle.mockResolvedValueOnce({
      data: { human_check_required: false, idea_id: "idea-1" },
      error: null,
    });
    mockMaybeSingle.mockResolvedValueOnce({
      data: { id: "step-1", run_id: null, status: "completed" },
      error: null,
    });

    await completeWorkflowStep("step-1");

    const updateArgs = mockUpdate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(updateArgs?.status).toBe("completed");
    expect(updateArgs?.completed_at).toBeTypeOf("string");
  });

  it("throws when the row is no longer in_progress", async () => {
    mockSingle.mockResolvedValueOnce({
      data: { human_check_required: false, idea_id: "idea-1" },
      error: null,
    });
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    await expect(completeWorkflowStep("step-1")).rejects.toThrow(
      /no longer in progress/i
    );
  });
});

describe("failWorkflowStep — manual UI rejection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not throw when the step is bot-assigned and the caller is a human", async () => {
    // failWorkflowStep updates the step (terminal: maybeSingle) — no SELECT
    // pre-fetch any more, so a single maybeSingle response covers it. Then
    // it does an unconditional update on workflow_runs (no terminal we await).
    mockMaybeSingle.mockResolvedValueOnce({
      data: { id: "step-1", run_id: null, idea_id: "idea-1", bot_id: BOT_USER_ID },
      error: null,
    });

    await expect(failWorkflowStep("step-1", "rejected by human")).resolves.toBeDefined();
  });

  it("throws when the row is not in a failable status", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    await expect(failWorkflowStep("step-1")).rejects.toThrow(
      /not in a state that can be failed/i
    );
  });
});
