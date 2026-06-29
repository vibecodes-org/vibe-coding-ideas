import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the heavy/IO dependencies before importing the module under test.
vi.mock("ai", () => ({
  generateObject: vi.fn(),
}));

vi.mock("@/lib/ai-helpers", () => ({
  AI_MODEL: "claude-sonnet-4-6",
  resolveAiProvider: vi.fn(),
  chargeAiUsage: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import {
  classifyTemplateCategory,
  classifyTaskCategory,
  detectMismatch,
  adjudicateWorkflowMatch,
  WORKFLOW_AI_AUTOAPPLY_THRESHOLD,
  WORKFLOW_MATCHING_MODEL,
  type AdjudicationCandidateTemplate,
} from "./workflow-matching";
import { resolveAiProvider, chargeAiUsage } from "@/lib/ai-helpers";

const mockResolveAiProvider = vi.mocked(resolveAiProvider);
const mockChargeAiUsage = vi.mocked(chargeAiUsage);

const fakeSupabase = {} as Parameters<typeof adjudicateWorkflowMatch>[0];
const mockAnthropicFn = vi.fn(() => "model-handle");

// ============================================================
// classifyTemplateCategory
// ============================================================

describe("classifyTemplateCategory", () => {
  it("classifies a discovery template", () => {
    const result = classifyTemplateCategory([
      { title: "Competitor analysis", description: "market research", role: "Analyst" },
      { title: "Pricing & go/no-go", description: "validation", role: "PM" },
    ]);
    expect(result.category).toBe("discovery");
    expect(result.discoveryHits.length).toBeGreaterThan(result.buildHits.length);
  });

  it("classifies a build template", () => {
    const result = classifyTemplateCategory([
      { title: "Implement API", description: "build the backend", role: "Engineer" },
      { title: "Fix bug & deploy", description: "refactor", role: "Backend" },
    ]);
    expect(result.category).toBe("build");
  });

  it("returns unknown for keyword-free steps", () => {
    const result = classifyTemplateCategory([
      { title: "Step one", description: "do the thing", role: "Person" },
    ]);
    expect(result.category).toBe("unknown");
    expect(result.discoveryHits).toEqual([]);
    expect(result.buildHits).toEqual([]);
  });

  it("handles an empty step list", () => {
    expect(classifyTemplateCategory([]).category).toBe("unknown");
  });
});

// ============================================================
// classifyTaskCategory
// ============================================================

describe("classifyTaskCategory", () => {
  it("uses label names as signal", () => {
    const result = classifyTaskCategory(
      { title: "Look into the thing", description: null },
      ["discovery"]
    );
    expect(result.category).toBe("discovery");
  });

  it("classifies an engineering investigation as build", () => {
    const result = classifyTaskCategory({
      title: "Investigate slow board render in CI",
      description: "instrument the render path and deploy a fix",
    });
    expect(result.category).toBe("build");
    expect(result.buildHits).toContain("render");
  });

  it("returns unknown when title is empty and no keywords", () => {
    expect(classifyTaskCategory({ title: "", description: "" }).category).toBe("unknown");
  });

  it("does not match 'api' inside an unrelated word (word boundary)", () => {
    const result = classifyTaskCategory({ title: "rapid capital growth", description: "" });
    expect(result.buildHits).not.toContain("api");
    expect(result.category).toBe("unknown");
  });
});

// ============================================================
// detectMismatch
// ============================================================

const discoverySteps = [
  { title: "Market research", description: "competitor analysis", role: "Analyst" },
  { title: "Go/no-go decision", description: "pricing validation", role: "PM" },
];
const buildSteps = [
  { title: "Implement feature", description: "build the api", role: "Engineer" },
  { title: "Fix & deploy", description: "refactor", role: "Backend" },
];

describe("detectMismatch", () => {
  it("clearly-good (same known category) → not suspect, not mismatch (TN)", () => {
    const r = detectMismatch(
      { steps: buildSteps, name: "Feature Development" },
      { title: "Implement the new API endpoint", description: "backend work" },
      ["Feature"]
    );
    expect(r.mismatch).toBe(false);
    expect(r.suspect).toBe(false);
    expect(r.categories).toEqual({ template: "build", task: "build" });
  });

  it("opposite known categories → suspect + mismatch (TP)", () => {
    const r = detectMismatch(
      { steps: discoverySteps, name: "Idea Validation" },
      { title: "Investigate slow board render in CI", description: "instrument & fix perf" },
      ["Research"]
    );
    expect(r.mismatch).toBe(true);
    expect(r.suspect).toBe(true);
    expect(r.categories).toEqual({ template: "discovery", task: "build" });
    // reason names both categories + matched keywords
    expect(r.reason).toContain("discovery / market-research");
    expect(r.reason).toContain("build / engineering");
    expect(r.reason).toMatch(/render|perf|fix|instrument/);
  });

  it("template unknown → suspect but not a hard mismatch (FN guard)", () => {
    const r = detectMismatch(
      { steps: [{ title: "Phase one", description: "do stuff", role: "Lead" }], name: "Generic" },
      { title: "Implement the API", description: "build it" },
      []
    );
    expect(r.mismatch).toBe(false);
    expect(r.suspect).toBe(true);
    expect(r.categories.template).toBe("unknown");
    expect(r.categories.task).toBe("build");
  });

  it("task unknown → suspect but not a hard mismatch", () => {
    const r = detectMismatch(
      { steps: buildSteps, name: "Feature Development" },
      { title: "Do the needful", description: "" },
      []
    );
    expect(r.mismatch).toBe(false);
    expect(r.suspect).toBe(true);
    expect(r.categories.task).toBe("unknown");
  });

  it("both unknown → suspect, not mismatch (boundary, no keywords)", () => {
    const r = detectMismatch(
      { steps: [{ title: "X", description: "", role: "Y" }], name: "Empty" },
      { title: "", description: "" },
      []
    );
    expect(r.mismatch).toBe(false);
    expect(r.suspect).toBe(true);
    expect(r.categories).toEqual({ template: "unknown", task: "unknown" });
  });

  it("tie in task keywords resolves to unknown (boundary, tie)", () => {
    // one discovery hit ("survey") + one build hit ("design") → tie → unknown
    const r = detectMismatch(
      { steps: buildSteps, name: "Feature Development" },
      { title: "survey and design", description: "" },
      []
    );
    expect(r.categories.task).toBe("unknown");
    expect(r.suspect).toBe(true);
    expect(r.mismatch).toBe(false);
  });
});

// ============================================================
// adjudicateWorkflowMatch
// ============================================================

const suggested: AdjudicationCandidateTemplate = {
  id: "tmpl-validation",
  name: "Idea Validation",
  description: "market discovery",
  steps: [
    { title: "Competitor analysis", role: "Analyst" },
    { title: "Go/no-go", role: "PM" },
  ],
};
const spike: AdjudicationCandidateTemplate = {
  id: "tmpl-spike",
  name: "Technical Spike",
  description: "time-boxed engineering investigation",
  steps: [{ title: "Investigate & implement", role: "Engineer" }],
};
const candidates = [suggested, spike];
const task = {
  title: "Investigate slow board render in CI",
  description: "instrument the render path and fix perf",
  labelNames: ["Research"],
};

function aiAvailable() {
  mockResolveAiProvider.mockResolvedValue({
    ok: true,
    anthropic: mockAnthropicFn as never,
    keyType: "byok",
  });
}

describe("adjudicateWorkflowMatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("confident AI pick of a DIFFERENT template does NOT auto-apply (confirm before swap)", async () => {
    aiAvailable();
    const generate = vi.fn().mockResolvedValue({
      object: {
        recommended_template_id: "tmpl-spike",
        confidence: 0.92,
        rationale: "Performance investigation — a build/spike workflow fits better.",
      },
      usage: { inputTokens: 100, outputTokens: 20 },
    });

    const result = await adjudicateWorkflowMatch(
      fakeSupabase,
      "user-1",
      suggested,
      candidates,
      task,
      { generate: generate as never, ideaId: "idea-1" }
    );

    expect(result.source).toBe("ai");
    // Recommendation is surfaced (pre-selected in Replace) but NOT auto-applied:
    // it differs from the rule's own template, so a human must confirm the swap.
    expect(result.recommendedTemplateId).toBe("tmpl-spike");
    expect(result.confidence).toBe(0.92);
    expect(result.autoApply).toBe(false);
    expect(mockChargeAiUsage).toHaveBeenCalledWith(
      fakeSupabase,
      expect.objectContaining({
        actionType: "workflow_matching",
        model: WORKFLOW_MATCHING_MODEL,
        ideaId: "idea-1",
        keyType: "byok",
      })
    );
  });

  it("confident AI confirmation of the RULE'S OWN template auto-applies (false-positive recovery)", async () => {
    aiAvailable();
    const generate = vi.fn().mockResolvedValue({
      object: {
        recommended_template_id: "tmpl-validation",
        confidence: 0.91,
        rationale: "On reflection the labelled validation workflow does fit.",
      },
      usage: { inputTokens: 90, outputTokens: 18 },
    });

    const result = await adjudicateWorkflowMatch(
      fakeSupabase,
      "user-1",
      suggested,
      candidates,
      task,
      { generate: generate as never, ideaId: "idea-1" }
    );

    expect(result.source).toBe("ai");
    expect(result.recommendedTemplateId).toBe("tmpl-validation");
    expect(result.autoApply).toBe(true);
  });

  it("uncertain AI verdict (<0.85) suggests without auto-apply", async () => {
    aiAvailable();
    const generate = vi.fn().mockResolvedValue({
      object: {
        recommended_template_id: "tmpl-spike",
        confidence: 0.6,
        rationale: "Probably build, but unsure.",
      },
      usage: { inputTokens: 80, outputTokens: 15 },
    });

    const result = await adjudicateWorkflowMatch(
      fakeSupabase,
      "user-1",
      suggested,
      candidates,
      task,
      { generate: generate as never }
    );

    expect(result.source).toBe("ai");
    expect(result.confidence).toBe(0.6);
    expect(result.autoApply).toBe(false);
    expect(result.recommendedTemplateId).toBe("tmpl-spike");
  });

  it("ignores a recommended id not in the candidate set", async () => {
    aiAvailable();
    const generate = vi.fn().mockResolvedValue({
      object: {
        recommended_template_id: "tmpl-ghost",
        confidence: 0.99,
        rationale: "Hallucinated template.",
      },
      usage: { inputTokens: 80, outputTokens: 15 },
    });

    const result = await adjudicateWorkflowMatch(
      fakeSupabase,
      "user-1",
      suggested,
      candidates,
      task,
      { generate: generate as never }
    );

    expect(result.recommendedTemplateId).toBeNull();
    // High confidence but no valid template → cannot auto-apply
    expect(result.autoApply).toBe(false);
  });

  it("charges via the chokepoint with platform key type", async () => {
    mockResolveAiProvider.mockResolvedValue({
      ok: true,
      anthropic: mockAnthropicFn as never,
      keyType: "platform",
    });
    const generate = vi.fn().mockResolvedValue({
      object: { recommended_template_id: "tmpl-spike", confidence: 0.9, rationale: "fits" },
      usage: { inputTokens: 10, outputTokens: 5 },
    });

    await adjudicateWorkflowMatch(fakeSupabase, "user-1", suggested, candidates, task, {
      generate: generate as never,
    });

    expect(mockChargeAiUsage).toHaveBeenCalledWith(
      fakeSupabase,
      expect.objectContaining({ keyType: "platform", actionType: "workflow_matching" })
    );
  });

  it("AI unavailable → heuristic fallback (no throw)", async () => {
    mockResolveAiProvider.mockResolvedValue({
      ok: false,
      error: "no credits",
      status: 403,
    });
    const generate = vi.fn();

    const result = await adjudicateWorkflowMatch(
      fakeSupabase,
      "user-1",
      suggested,
      candidates,
      task,
      { generate: generate as never }
    );

    expect(generate).not.toHaveBeenCalled();
    expect(result.source).toBe("heuristic");
    expect(result.autoApply).toBe(false);
    // discovery template vs build task → heuristic flags mismatch
    expect(result.rationale).toContain("mismatched");
    expect(result.confidence).toBeLessThan(WORKFLOW_AI_AUTOAPPLY_THRESHOLD);
  });

  it("AI call throws → heuristic fallback (no throw)", async () => {
    aiAvailable();
    const generate = vi.fn().mockRejectedValue(new Error("network error"));

    const result = await adjudicateWorkflowMatch(
      fakeSupabase,
      "user-1",
      suggested,
      candidates,
      task,
      { generate: generate as never }
    );

    expect(result.source).toBe("heuristic");
    expect(result.autoApply).toBe(false);
  });

  it("AI returns invalid output → heuristic fallback (no throw)", async () => {
    aiAvailable();
    const generate = vi.fn().mockResolvedValue({
      object: { confidence: "not-a-number", rationale: 5 },
      usage: { inputTokens: 10, outputTokens: 5 },
    });

    const result = await adjudicateWorkflowMatch(
      fakeSupabase,
      "user-1",
      suggested,
      candidates,
      task,
      { generate: generate as never }
    );

    expect(result.source).toBe("heuristic");
    expect(mockChargeAiUsage).not.toHaveBeenCalled();
  });
});
