import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Supabase client chain
const mockMaybeSingle = vi.fn();
const mockSingle = vi.fn();
const chain: Record<string, unknown> = {};
const mockInsert = vi.fn(() => chain);
const mockSelect = vi.fn(() => chain);
const mockEq = vi.fn(() => chain);
const mockIlike = vi.fn(() => chain);
Object.assign(chain, {
  insert: mockInsert,
  select: mockSelect,
  eq: mockEq,
  ilike: mockIlike,
  single: mockSingle,
  maybeSingle: mockMaybeSingle,
});
const mockFrom = vi.fn(() => chain);
const mockGetUser = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: (...args: unknown[]) => mockFrom(...args),
    auth: {
      getUser: () => mockGetUser(),
    },
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const TEMPLATE_INPUT = {
  name: "Feature Development",
  description: "End-to-end feature workflow",
  steps: [{ title: "Requirements", role: "BA", requires_approval: false }],
  suggested_label_name: "Feature",
  suggested_label_color: "violet",
};

describe("importTemplateWithLabel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
    });
  });

  async function getImport() {
    const mod = await import("./workflow-templates");
    return mod.importTemplateWithLabel;
  }

  it("creates template only when autoWire is false", async () => {
    const importFn = await getImport();

    // Template insert succeeds
    mockSingle.mockResolvedValueOnce({
      data: { id: "tpl-1", idea_id: "idea-1", name: "Feature Development" },
      error: null,
    });

    const result = await importFn("idea-1", TEMPLATE_INPUT, false);

    expect(result.templateId).toBe("tpl-1");
    expect(result.labelId).toBeUndefined();
    expect(result.autoRuleId).toBeUndefined();
    // Should only call from() for workflow_templates, not board_labels
    expect(mockFrom).toHaveBeenCalledWith("workflow_templates");
    expect(mockFrom).not.toHaveBeenCalledWith("board_labels");
  });

  it("creates template + label + auto-rule when autoWire is true", async () => {
    const importFn = await getImport();

    // Template insert
    mockSingle.mockResolvedValueOnce({
      data: { id: "tpl-1" },
      error: null,
    });

    // Label lookup — no existing label
    mockIlike.mockReturnValueOnce(
      Promise.resolve({ data: [], error: null })
    );

    // Label insert
    mockSingle.mockResolvedValueOnce({
      data: { id: "label-1" },
      error: null,
    });

    // Auto-rule insert
    mockMaybeSingle.mockResolvedValueOnce({
      data: { id: "rule-1" },
      error: null,
    });

    const result = await importFn("idea-1", TEMPLATE_INPUT, true);

    expect(result.templateId).toBe("tpl-1");
    expect(result.labelId).toBe("label-1");
    expect(result.autoRuleId).toBe("rule-1");
  });

  it("reuses existing label (case-insensitive) and does not override color", async () => {
    const importFn = await getImport();

    // Template insert
    mockSingle.mockResolvedValueOnce({
      data: { id: "tpl-1" },
      error: null,
    });

    // Label lookup — existing label found
    mockIlike.mockReturnValueOnce(
      Promise.resolve({ data: [{ id: "existing-label", name: "feature", color: "blue" }], error: null })
    );

    // Auto-rule insert
    mockMaybeSingle.mockResolvedValueOnce({
      data: { id: "rule-1" },
      error: null,
    });

    const result = await importFn("idea-1", TEMPLATE_INPUT, true);

    // Should reuse the existing label ID
    expect(result.labelId).toBe("existing-label");
    // ilike was called for case-insensitive lookup
    expect(mockIlike).toHaveBeenCalledWith("name", "Feature");
    // from("board_labels") should be called for the lookup select, but NOT for insert
    // We verify by checking that insert was called only twice: once for workflow_templates, once for workflow_auto_rules
    // (not for board_labels)
    expect(mockInsert).toHaveBeenCalledTimes(2);
    expect(mockFrom).toHaveBeenCalledWith("workflow_templates");
    expect(mockFrom).toHaveBeenCalledWith("workflow_auto_rules");
  });

  it("silently skips auto-rule on unique constraint violation", async () => {
    const importFn = await getImport();

    // Template insert
    mockSingle.mockResolvedValueOnce({
      data: { id: "tpl-1" },
      error: null,
    });

    // Label lookup — no existing
    mockIlike.mockReturnValueOnce(
      Promise.resolve({ data: [], error: null })
    );

    // Label insert
    mockSingle.mockResolvedValueOnce({
      data: { id: "label-1" },
      error: null,
    });

    // Auto-rule insert — unique constraint violation
    mockMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: { code: "23505", message: "duplicate key" },
    });

    const result = await importFn("idea-1", TEMPLATE_INPUT, true);

    expect(result.templateId).toBe("tpl-1");
    expect(result.labelId).toBe("label-1");
    expect(result.autoRuleId).toBeUndefined();
  });

  it("skips label/rule when template has no suggested label", async () => {
    const importFn = await getImport();

    const inputWithoutLabel = {
      ...TEMPLATE_INPUT,
      suggested_label_name: null,
      suggested_label_color: null,
    };

    // Template insert
    mockSingle.mockResolvedValueOnce({
      data: { id: "tpl-1" },
      error: null,
    });

    const result = await importFn("idea-1", inputWithoutLabel, true);

    expect(result.templateId).toBe("tpl-1");
    expect(result.labelId).toBeUndefined();
    expect(result.autoRuleId).toBeUndefined();
  });

  it("still returns template on label creation failure (partial success)", async () => {
    const importFn = await getImport();

    // Template insert
    mockSingle.mockResolvedValueOnce({
      data: { id: "tpl-1" },
      error: null,
    });

    // Label lookup — no existing
    mockIlike.mockReturnValueOnce(
      Promise.resolve({ data: [], error: null })
    );

    // Label insert — fails
    mockSingle.mockResolvedValueOnce({
      data: null,
      error: { code: "42501", message: "permission denied" },
    });

    const result = await importFn("idea-1", TEMPLATE_INPUT, true);

    // Template still succeeded
    expect(result.templateId).toBe("tpl-1");
    expect(result.labelId).toBeUndefined();
    expect(result.autoRuleId).toBeUndefined();
  });
});
