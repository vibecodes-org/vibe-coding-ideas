import { describe, it, expect, vi, beforeEach } from "vitest";

// Track revalidatePath calls — should never be called by board actions
const mockRevalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

// Mock Supabase client chain
const mockSingle = vi.fn().mockResolvedValue({ data: { id: "task-1" }, error: null });
const mockMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
const chain: Record<string, unknown> = {};
const mockInsert = vi.fn(() => chain);
const mockUpdate = vi.fn(() => chain);
const mockDelete = vi.fn(() => chain);
const mockSelect = vi.fn(() => chain);
const mockEq = vi.fn(() => chain);
const mockOrder = vi.fn(() => chain);
const mockLimit = vi.fn(() => chain);
Object.assign(chain, {
  insert: mockInsert,
  update: mockUpdate,
  delete: mockDelete,
  select: mockSelect,
  eq: mockEq,
  order: mockOrder,
  limit: mockLimit,
  single: mockSingle,
  maybeSingle: mockMaybeSingle,
});
const mockFrom = vi.fn(() => chain);
const mockGetUser = vi.fn().mockResolvedValue({
  data: { user: { id: "user-1" } },
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: (...args: unknown[]) => mockFrom(...args),
    auth: { getUser: () => mockGetUser() },
  }),
}));

vi.mock("@/lib/workflow-helpers", () => ({
  checkAndApplyAutoRules: vi.fn(),
  checkAutoRuleWorkflow: vi.fn(),
  removeAutoRuleWorkflow: vi.fn().mockResolvedValue({ removed: false }),
}));

vi.mock("@/actions/workflow-templates", () => ({
  applyWorkflowTemplate: vi.fn(),
  applyWorkflowTemplateWithContext: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  createBoardColumn,
  updateBoardColumn,
  deleteBoardColumn,
  createBoardTask,
  updateBoardTask,
  archiveColumnTasks,
  deleteBoardTask,
  moveBoardTask,
  reorderBoardColumns,
  createBoardLabel,
  updateBoardLabel,
  deleteBoardLabel,
  addLabelToTask,
  addLabelsToTask,
  removeLabelFromTask,
  createTaskComment,
  updateTaskComment,
  deleteTaskComment,
} from "./board";

describe("board actions — no revalidatePath", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset chain responses to success
    mockSingle.mockResolvedValue({ data: { id: "item-1", position: 0 }, error: null });
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockLimit.mockResolvedValue({ data: [{ position: 0 }], error: null });
    mockEq.mockReturnValue(chain);
    mockInsert.mockReturnValue(chain);
    mockUpdate.mockReturnValue(chain);
    mockDelete.mockReturnValue(chain);
    // For archiveColumnTasks
    mockSelect.mockReturnValue(chain);
  });

  const actions = [
    { name: "createBoardColumn", fn: () => createBoardColumn("idea-1", "New Column") },
    { name: "updateBoardColumn", fn: () => updateBoardColumn("col-1", "idea-1", "Updated") },
    { name: "deleteBoardColumn", fn: () => deleteBoardColumn("col-1", "idea-1") },
    { name: "createBoardTask", fn: () => createBoardTask("idea-1", "col-1", "Task") },
    { name: "updateBoardTask", fn: () => updateBoardTask("task-1", "idea-1", { title: "Updated" }) },
    { name: "deleteBoardTask", fn: () => deleteBoardTask("task-1", "idea-1") },
    { name: "moveBoardTask", fn: () => moveBoardTask("task-1", "idea-1", "col-2", 1000) },
    { name: "reorderBoardColumns", fn: () => reorderBoardColumns("idea-1", ["col-1", "col-2"]) },
    { name: "createBoardLabel", fn: () => createBoardLabel("idea-1", "Bug", "red") },
    { name: "updateBoardLabel", fn: () => updateBoardLabel("label-1", "idea-1", { name: "Feature" }) },
    { name: "deleteBoardLabel", fn: () => deleteBoardLabel("label-1", "idea-1") },
    { name: "addLabelToTask", fn: () => addLabelToTask("task-1", "label-1", "idea-1") },
    { name: "addLabelsToTask", fn: () => addLabelsToTask("task-1", ["label-1"], "idea-1") },
    { name: "removeLabelFromTask", fn: () => removeLabelFromTask("task-1", "label-1", "idea-1") },
    { name: "createTaskComment", fn: () => createTaskComment("task-1", "idea-1", "Hello") },
    { name: "updateTaskComment", fn: () => updateTaskComment("comment-1", "idea-1", "Updated") },
    { name: "deleteTaskComment", fn: () => deleteTaskComment("comment-1", "idea-1") },
  ];

  for (const { name, fn } of actions) {
    it(`${name} does not call revalidatePath`, async () => {
      await fn();
      expect(mockRevalidatePath).not.toHaveBeenCalled();
    });
  }
});
