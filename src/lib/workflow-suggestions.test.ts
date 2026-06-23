import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the heavy/IO dependencies before importing the module under test.
vi.mock("ai", () => ({
  generateObject: vi.fn(),
}));

vi.mock("@/lib/ai-helpers", () => ({
  AI_MODEL: "claude-sonnet-4-6",
  resolveAiProvider: vi.fn(),
  logAiUsage: vi.fn(),
  decrementStarterCredit: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import {
  decideAutoRuleApplication,
  dismissSuggestionsForLabel,
  type AutoRuleTemplate,
  type AutoRuleTask,
} from "./workflow-matching";
import { resolveAiProvider, logAiUsage, decrementStarterCredit } from "@/lib/ai-helpers";

const mockResolveAiProvider = vi.mocked(resolveAiProvider);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(logAiUsage).mockResolvedValue(undefined as never);
  vi.mocked(decrementStarterCredit).mockResolvedValue(undefined as never);
});

// ============================================================
// Test doubles
// ============================================================

const DISCOVERY_TEMPLATE: AutoRuleTemplate = {
  id: "tmpl-discovery",
  name: "Market discovery",
  description: "validation work",
  steps: [
    { title: "Competitor analysis", description: "market research", role: "Analyst" },
    { title: "Pricing & go/no-go", description: "validation", role: "PM" },
  ],
};

const BUILD_TEMPLATE: AutoRuleTemplate = {
  id: "tmpl-build",
  name: "Build feature",
  description: "engineering work",
  steps: [
    { title: "Implement API", description: "build backend", role: "Engineer" },
    { title: "Fix bug & deploy", description: "refactor", role: "Backend" },
  ],
};

const BUILD_TASK: AutoRuleTask = {
  id: "task-1",
  title: "Implement the new checkout API",
  description: "build and deploy the backend endpoint",
  labelNames: ["backend"],
};

interface SuggestionRow {
  id: string;
  task_id: string;
  label_id: string;
  status: string;
  source: string;
  ai_confidence: number | null;
  recommended_template_id: string | null;
  replacement_template_id: string | null;
  reason: string | null;
  adjudication_started_at: string | null;
  resolved_at: string | null;
  [k: string]: unknown;
}

/**
 * A tiny in-memory supabase double that supports just the chains the suggestion
 * lifecycle uses: insert/select/update on workflow_suggestions, with a partial
 * unique constraint on (task_id, label_id) WHERE status = 'suggested'.
 */
function createSuggestionDb(opts: { duplicateOpen?: SuggestionRow | null; insertFails?: boolean } = {}) {
  const rows: SuggestionRow[] = [];
  if (opts.duplicateOpen) rows.push(opts.duplicateOpen);
  let idSeq = 0;

  const inserts: SuggestionRow[] = [];
  const updates: { match: Record<string, unknown>; patch: Record<string, unknown> }[] = [];

  function from(table: string) {
    if (table !== "workflow_suggestions") {
      // Unused tables in these tests — return a no-op chain.
      return makeNoop();
    }
    return makeSuggestionChain();
  }

  function makeNoop() {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "not", "insert", "update", "in"]) {
      chain[m] = vi.fn(() => chain);
    }
    chain.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }));
    chain.then = (res: (v: unknown) => unknown) => res({ data: null, error: null });
    return chain;
  }

  function makeSuggestionChain() {
    let mode: "insert" | "update" | "select" = "select";
    let pendingInsert: SuggestionRow | null = null;
    let pendingPatch: Record<string, unknown> | null = null;
    const match: Record<string, unknown> = {};

    const chain: Record<string, unknown> = {};

    chain.insert = vi.fn((vals: Record<string, unknown>) => {
      mode = "insert";
      if (opts.insertFails) {
        pendingInsert = null;
        // simulate unexpected DB error
        chain.__error = { code: "XX000", message: "insert exploded" };
        return chain;
      }
      // Enforce partial unique: one open per (task,label).
      const dup = rows.find(
        (r) =>
          r.task_id === vals.task_id &&
          r.label_id === vals.label_id &&
          r.status === "suggested"
      );
      if (dup) {
        chain.__error = { code: "23505", message: "duplicate" };
        return chain;
      }
      const row: SuggestionRow = {
        id: `sug-${++idSeq}`,
        task_id: vals.task_id as string,
        label_id: vals.label_id as string,
        status: (vals.status as string) ?? "suggested",
        source: (vals.source as string) ?? "heuristic",
        ai_confidence: (vals.ai_confidence as number | null) ?? null,
        recommended_template_id: (vals.recommended_template_id as string | null) ?? null,
        replacement_template_id: (vals.replacement_template_id as string | null) ?? null,
        reason: (vals.reason as string | null) ?? null,
        adjudication_started_at: (vals.adjudication_started_at as string | null) ?? null,
        resolved_at: null,
        ...vals,
      };
      rows.push(row);
      inserts.push(row);
      pendingInsert = row;
      return chain;
    });

    chain.update = vi.fn((patch: Record<string, unknown>) => {
      mode = "update";
      pendingPatch = patch;
      return chain;
    });

    chain.select = vi.fn(() => {
      if (mode !== "insert" && mode !== "update") mode = "select";
      return chain;
    });

    chain.eq = vi.fn((col: string, val: unknown) => {
      match[col] = val;
      return chain;
    });

    chain.maybeSingle = vi.fn(() => {
      if (chain.__error) {
        const err = chain.__error;
        chain.__error = null;
        return Promise.resolve({ data: null, error: err });
      }
      if (mode === "insert") {
        return Promise.resolve({
          data: pendingInsert ? { id: pendingInsert.id } : null,
          error: null,
        });
      }
      // select existing
      const found = rows.find((r) =>
        Object.entries(match).every(([k, v]) => r[k] === v)
      );
      return Promise.resolve({ data: found ? { id: found.id } : null, error: null });
    });

    // Terminal for updates (no maybeSingle): make the chain thenable. Supports
    // both `await chain` (resolve fn passed) and `.then(undefined, onRejected)`.
    chain.then = (resolve?: (v: unknown) => unknown) => {
      if (mode === "update" && pendingPatch) {
        const targets = rows.filter((r) =>
          Object.entries(match).every(([k, v]) => r[k] === v)
        );
        for (const t of targets) Object.assign(t, pendingPatch);
        updates.push({ match: { ...match }, patch: pendingPatch });
      }
      const value = { data: null, error: null };
      return typeof resolve === "function"
        ? resolve(value)
        : Promise.resolve(value);
    };

    return chain;
  }

  return {
    client: { from: vi.fn(from) } as unknown as Parameters<typeof decideAutoRuleApplication>[0],
    rows,
    inserts,
    updates,
  };
}

function openRow(): SuggestionRow {
  return {
    id: "sug-existing",
    task_id: "task-1",
    label_id: "label-1",
    status: "suggested",
    source: "heuristic",
    ai_confidence: null,
    recommended_template_id: null,
    replacement_template_id: null,
    reason: "prior",
    adjudication_started_at: new Date().toISOString(),
    resolved_at: null,
  };
}

// A generate() double matching the `ai` generateObject signature shape used.
function fakeGenerate(object: unknown) {
  return vi.fn(async () => ({ object, usage: { inputTokens: 1, outputTokens: 1 } })) as never;
}

function withAi() {
  mockResolveAiProvider.mockResolvedValue({
    ok: true,
    anthropic: (() => "model-handle") as never,
    keyType: "byok",
  } as never);
}

function noAi() {
  mockResolveAiProvider.mockResolvedValue({ ok: false, error: "no access", status: 402 } as never);
}

// ============================================================
// AC-1: clearly-good match
// ============================================================

describe("decideAutoRuleApplication — clearly-good fit (AC-1)", () => {
  it("auto-applies, writes NO suggestion, and never invokes AI", async () => {
    const db = createSuggestionDb();
    const applyFn = vi.fn().mockResolvedValue(undefined);
    const generate = fakeGenerate({});

    const result = await decideAutoRuleApplication(db.client, {
      ideaId: "idea-1",
      labelId: "label-1",
      ruleId: "rule-1",
      template: BUILD_TEMPLATE,
      task: BUILD_TASK, // build task + build template → not suspect
      applyFn,
      userId: "user-1",
      generate,
    });

    expect(result.applied).toBe(true);
    expect(result.suggested).toBe(false);
    expect(applyFn).toHaveBeenCalledWith("task-1", "tmpl-build");
    expect(db.inserts).toHaveLength(0);
    expect(generate).not.toHaveBeenCalled();
  });
});

// ============================================================
// AC-3 / AC-5: suspect → suggestion, no synchronous apply
// ============================================================

describe("decideAutoRuleApplication — suspect (AC-3/AC-5)", () => {
  it("writes a suggestion row and does NOT call applyFn synchronously", async () => {
    withAi();
    const db = createSuggestionDb();
    const applyFn = vi.fn().mockResolvedValue(undefined);
    // discovery template on a build task → hard mismatch → suspect
    const generate = fakeGenerate({
      recommended_template_id: null,
      confidence: 0.4,
      rationale: "unsure",
    });

    const result = await decideAutoRuleApplication(db.client, {
      ideaId: "idea-1",
      labelId: "label-1",
      ruleId: "rule-1",
      template: DISCOVERY_TEMPLATE,
      task: BUILD_TASK,
      applyFn,
      userId: "user-1",
      generate,
      awaitAdjudication: true,
    });

    expect(result.suggested).toBe(true);
    expect(result.applied).toBe(false);
    expect(db.inserts).toHaveLength(1);
    expect(db.inserts[0].status).toBe("suggested");
    // applyFn must NOT run synchronously for a suspect case (verdict was uncertain)
    expect(applyFn).not.toHaveBeenCalled();
  });
});

// ============================================================
// AC-4: idempotent — duplicate open suggestion
// ============================================================

describe("decideAutoRuleApplication — idempotency (AC-4)", () => {
  it("does not create a duplicate when an open suggestion already exists", async () => {
    const db = createSuggestionDb({ duplicateOpen: openRow() });
    const applyFn = vi.fn();
    const generate = fakeGenerate({});

    const result = await decideAutoRuleApplication(db.client, {
      ideaId: "idea-1",
      labelId: "label-1",
      ruleId: "rule-1",
      template: DISCOVERY_TEMPLATE,
      task: BUILD_TASK,
      applyFn,
      userId: "user-1",
      generate,
      awaitAdjudication: true,
    });

    expect(result.suggested).toBe(true);
    expect(result.suggestionId).toBe("sug-existing");
    // No new row inserted, no AI dispatched for the dup.
    expect(db.inserts).toHaveLength(0);
    expect(generate).not.toHaveBeenCalled();
    expect(applyFn).not.toHaveBeenCalled();
  });
});

// ============================================================
// AC-18: non-throwing on persistence failure
// ============================================================

describe("decideAutoRuleApplication — non-throwing (AC-18)", () => {
  it("resolves (does not throw) when the suggestion insert fails", async () => {
    const db = createSuggestionDb({ insertFails: true });
    const applyFn = vi.fn();
    const generate = fakeGenerate({});

    const result = await decideAutoRuleApplication(db.client, {
      ideaId: "idea-1",
      labelId: "label-1",
      ruleId: "rule-1",
      template: DISCOVERY_TEMPLATE,
      task: BUILD_TASK,
      applyFn,
      userId: "user-1",
      generate,
      awaitAdjudication: true,
    });

    expect(result.applied).toBe(false);
    expect(result.suggested).toBe(false);
    expect(applyFn).not.toHaveBeenCalled();
  });
});

// ============================================================
// Async adjudication callback behaviour
// ============================================================

describe("async adjudication", () => {
  it("confident AI verdict for a DIFFERENT template surfaces it but never silently swaps", async () => {
    // The rule suggested tmpl-discovery; the AI confidently recommends a
    // DIFFERENT template (tmpl-build). Per workflow-matching.ts:436-443 we never
    // silently substitute a workflow the user didn't choose, so autoApply stays
    // false even at high confidence: applyFn is NOT called and the suggestion is
    // left OPEN with the recommended template surfaced for the user to choose.
    // (The same-template confident path — recommended === suggested — is the
    // auto-apply case and is exercised by the AC-1 / matching-unit tests.)
    withAi();
    const db = createSuggestionDb();
    const applyFn = vi.fn().mockResolvedValue(undefined);
    const generate = fakeGenerate({
      recommended_template_id: "tmpl-build",
      confidence: 0.95,
      rationale: "build template fits a build task",
    });

    const result = await decideAutoRuleApplication(db.client, {
      ideaId: "idea-1",
      labelId: "label-1",
      ruleId: "rule-1",
      template: DISCOVERY_TEMPLATE,
      task: BUILD_TASK,
      applyFn,
      userId: "user-1",
      isAutonomousAgent: false,
      candidateTemplates: [
        { id: "tmpl-discovery", name: "Market discovery", steps: [] },
        { id: "tmpl-build", name: "Build feature", steps: [] },
      ],
      generate,
      awaitAdjudication: true,
    });

    expect(result.adjudication?.source).toBe("ai");
    // Differing template → never silently substituted, so no apply.
    expect(applyFn).not.toHaveBeenCalled();
    const row = db.rows.find((r) => r.id === result.suggestionId)!;
    // Suggestion stays open with the AI verdict recorded for the user to choose.
    expect(row.status).toBe("suggested");
    expect(row.source).toBe("ai");
    expect(row.ai_confidence).toBe(0.95);
    expect(row.recommended_template_id).toBe("tmpl-build");
    expect(row.replacement_template_id).toBeNull();
    expect(row.resolved_at).toBeNull();
    expect(row.adjudication_started_at).toBeNull();
  });

  it("uncertain AI verdict updates the suggestion row but leaves it open", async () => {
    withAi();
    const db = createSuggestionDb();
    const applyFn = vi.fn().mockResolvedValue(undefined);
    const generate = fakeGenerate({
      recommended_template_id: "tmpl-build",
      confidence: 0.5,
      rationale: "leaning build but not confident",
    });

    const result = await decideAutoRuleApplication(db.client, {
      ideaId: "idea-1",
      labelId: "label-1",
      ruleId: "rule-1",
      template: DISCOVERY_TEMPLATE,
      task: BUILD_TASK,
      applyFn,
      userId: "user-1",
      candidateTemplates: [
        { id: "tmpl-discovery", name: "Market discovery", steps: [] },
        { id: "tmpl-build", name: "Build feature", steps: [] },
      ],
      generate,
      awaitAdjudication: true,
    });

    expect(applyFn).not.toHaveBeenCalled();
    const row = db.rows.find((r) => r.id === result.suggestionId)!;
    expect(row.status).toBe("suggested");
    expect(row.source).toBe("ai");
    expect(row.ai_confidence).toBe(0.5);
    expect(row.recommended_template_id).toBe("tmpl-build");
    expect(row.adjudication_started_at).toBeNull();
  });

  it("confident verdict in an autonomous-agent context does NOT auto-apply", async () => {
    withAi();
    const db = createSuggestionDb();
    const applyFn = vi.fn().mockResolvedValue(undefined);
    const generate = fakeGenerate({
      recommended_template_id: "tmpl-build",
      confidence: 0.95,
      rationale: "fits",
    });

    const result = await decideAutoRuleApplication(db.client, {
      ideaId: "idea-1",
      labelId: "label-1",
      ruleId: "rule-1",
      template: DISCOVERY_TEMPLATE,
      task: BUILD_TASK,
      applyFn,
      userId: "user-1",
      isAutonomousAgent: true,
      candidateTemplates: [{ id: "tmpl-build", name: "Build feature", steps: [] }],
      generate,
      awaitAdjudication: true,
    });

    expect(applyFn).not.toHaveBeenCalled();
    const row = db.rows.find((r) => r.id === result.suggestionId)!;
    expect(row.status).toBe("suggested");
    expect(row.source).toBe("ai");
  });

  it("AI-down leaves a heuristic-sourced open suggestion (no apply)", async () => {
    noAi();
    const db = createSuggestionDb();
    const applyFn = vi.fn().mockResolvedValue(undefined);
    const generate = fakeGenerate({});

    const result = await decideAutoRuleApplication(db.client, {
      ideaId: "idea-1",
      labelId: "label-1",
      ruleId: "rule-1",
      template: DISCOVERY_TEMPLATE,
      task: BUILD_TASK,
      applyFn,
      userId: "user-1",
      generate,
      awaitAdjudication: true,
    });

    expect(applyFn).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled(); // AI provider unavailable
    const row = db.rows.find((r) => r.id === result.suggestionId)!;
    expect(row.status).toBe("suggested");
    expect(row.source).toBe("heuristic");
    expect(row.adjudication_started_at).toBeNull();
  });
});

// ============================================================
// AC-8: auto-dismiss on label removal
// ============================================================

describe("dismissSuggestionsForLabel (AC-8)", () => {
  it("transitions an open suggestion to dismissed", async () => {
    const db = createSuggestionDb({ duplicateOpen: openRow() });

    await dismissSuggestionsForLabel(db.client, "task-1", "label-1");

    const row = db.rows.find((r) => r.id === "sug-existing")!;
    expect(row.status).toBe("dismissed");
    expect(row.reason).toBe("label_removed");
    expect(row.resolved_at).not.toBeNull();
  });

  it("does not throw if the update errors", async () => {
    const client = {
      from: vi.fn(() => {
        throw new Error("db down");
      }),
    } as unknown as Parameters<typeof dismissSuggestionsForLabel>[0];

    await expect(
      dismissSuggestionsForLabel(client, "task-1", "label-1")
    ).resolves.toBeUndefined();
  });
});
