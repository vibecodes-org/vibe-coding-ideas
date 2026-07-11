import { describe, it, expect } from "vitest";
import {
  clampCommentContent,
  groupStepComments,
  buildApprovalNotes,
  buildApproverGuidanceBlock,
  CONTENT_CLAMP_LENGTH,
  TRUNCATION_SUFFIX,
  MAX_STEP_COMMENTS,
  type StepCommentRow,
  type ApprovalNoteRow,
  type ApprovalNote,
} from "./step-comments";

const STEP_A = "00000000-0000-4000-a000-00000000000a";
const STEP_B = "00000000-0000-4000-a000-00000000000b";

function makeRow(overrides: Partial<StepCommentRow> = {}): StepCommentRow {
  return {
    id: "row-1",
    step_id: STEP_A,
    type: "comment",
    content: "hello",
    author_id: "author-1",
    created_at: "2026-01-01T00:00:00Z",
    users: { full_name: "Priya" },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// clampCommentContent — 2000-char clamp boundary
// ---------------------------------------------------------------------------

describe("clampCommentContent", () => {
  it("leaves content at exactly the clamp length untouched (1999 chars)", () => {
    const content = "a".repeat(CONTENT_CLAMP_LENGTH - 1);
    expect(clampCommentContent(content)).toBe(content);
  });

  it("leaves content at exactly the clamp length untouched (2000 chars)", () => {
    const content = "a".repeat(CONTENT_CLAMP_LENGTH);
    const result = clampCommentContent(content);
    expect(result).toBe(content);
    expect(result).not.toContain(TRUNCATION_SUFFIX);
  });

  it("clamps content one char over the limit (2001 chars) and appends the suffix", () => {
    const content = "a".repeat(CONTENT_CLAMP_LENGTH + 1);
    const result = clampCommentContent(content);
    expect(result).toBe("a".repeat(CONTENT_CLAMP_LENGTH) + TRUNCATION_SUFFIX);
    expect(result.startsWith("a".repeat(CONTENT_CLAMP_LENGTH))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// groupStepComments — grouping, cap, order, truncation flag
// ---------------------------------------------------------------------------

describe("groupStepComments", () => {
  it("groups rows by step_id, preserving the caller-provided (newest-first) order", () => {
    const rows = [
      makeRow({ id: "a1", step_id: STEP_A, created_at: "2026-01-03T00:00:00Z" }),
      makeRow({ id: "b1", step_id: STEP_B, created_at: "2026-01-02T00:00:00Z" }),
      makeRow({ id: "a2", step_id: STEP_A, created_at: "2026-01-01T00:00:00Z" }),
    ];

    const result = groupStepComments(rows, [STEP_A, STEP_B]);

    expect(result.get(STEP_A)!.comments.map((c) => c.id)).toEqual(["a1", "a2"]);
    expect(result.get(STEP_B)!.comments.map((c) => c.id)).toEqual(["b1"]);
  });

  it("returns comments: [] and comments_truncated: false for a step with no rows", () => {
    const result = groupStepComments([], [STEP_A]);
    expect(result.get(STEP_A)).toEqual({ comments: [], comments_truncated: false });
  });

  it("includes an entry for every requested step_id, even absent from rows", () => {
    const result = groupStepComments([makeRow({ step_id: STEP_A })], [STEP_A, STEP_B]);
    expect(result.has(STEP_A)).toBe(true);
    expect(result.has(STEP_B)).toBe(true);
    expect(result.get(STEP_B)).toEqual({ comments: [], comments_truncated: false });
  });

  it("caps comments at MAX_STEP_COMMENTS (10) and does not set comments_truncated at exactly 10", () => {
    const rows = Array.from({ length: MAX_STEP_COMMENTS }, (_, i) =>
      makeRow({ id: `row-${i}`, step_id: STEP_A })
    );
    const result = groupStepComments(rows, [STEP_A]);
    expect(result.get(STEP_A)!.comments).toHaveLength(MAX_STEP_COMMENTS);
    expect(result.get(STEP_A)!.comments_truncated).toBe(false);
  });

  it("sets comments_truncated: true and caps at 10 when 11 rows exist for a step", () => {
    const rows = Array.from({ length: MAX_STEP_COMMENTS + 1 }, (_, i) =>
      makeRow({ id: `row-${i}`, step_id: STEP_A })
    );
    const result = groupStepComments(rows, [STEP_A]);
    expect(result.get(STEP_A)!.comments).toHaveLength(MAX_STEP_COMMENTS);
    expect(result.get(STEP_A)!.comments_truncated).toBe(true);
  });

  it("does not filter by type — callers are responsible for excluding type='output' beforehand", () => {
    // Documents the assumption from board-read.ts's `.neq("type", "output")`
    // query: groupStepComments trusts its input and performs no type check.
    const rows = [makeRow({ id: "o1", type: "output" })];
    const result = groupStepComments(rows, [STEP_A]);
    expect(result.get(STEP_A)!.comments).toHaveLength(1);
    expect(result.get(STEP_A)!.comments[0].type).toBe("output");
  });

  it("clamps content and flattens author_name for each shaped comment", () => {
    const longContent = "x".repeat(CONTENT_CLAMP_LENGTH + 5);
    const rows = [makeRow({ content: longContent, users: { full_name: "Nick Ball" } })];
    const result = groupStepComments(rows, [STEP_A]);
    const shaped = result.get(STEP_A)!.comments[0];
    expect(shaped.content).toBe("x".repeat(CONTENT_CLAMP_LENGTH) + TRUNCATION_SUFFIX);
    expect(shaped.author_name).toBe("Nick Ball");
  });

  it("falls back author_name to null when the users join misses", () => {
    const rows = [makeRow({ users: null })];
    const result = groupStepComments(rows, [STEP_A]);
    expect(result.get(STEP_A)!.comments[0].author_name).toBeNull();
  });

  it("falls back author_name to null when users.full_name is null", () => {
    const rows = [makeRow({ users: { full_name: null } })];
    const result = groupStepComments(rows, [STEP_A]);
    expect(result.get(STEP_A)!.comments[0].author_name).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildApprovalNotes
// ---------------------------------------------------------------------------

describe("buildApprovalNotes", () => {
  function makeApprovalRow(overrides: Partial<ApprovalNoteRow> = {}): ApprovalNoteRow {
    return {
      step_id: STEP_A,
      content: "Approved — but rename the field.",
      author_id: "human-1",
      created_at: "2026-01-01T00:00:00Z",
      users: { full_name: "Nick Ball" },
      ...overrides,
    };
  }

  it("resolves step_title from the prior-steps list, not a second query", () => {
    const rows = [makeApprovalRow({ step_id: STEP_A })];
    const result = buildApprovalNotes(rows, [{ id: STEP_A, title: "Requirements" }]);
    expect(result).toEqual([
      {
        step_id: STEP_A,
        step_title: "Requirements",
        content: "Approved — but rename the field.",
        author_id: "human-1",
        author_name: "Nick Ball",
        created_at: "2026-01-01T00:00:00Z",
      },
    ]);
  });

  it("preserves chronological input order", () => {
    const rows = [
      makeApprovalRow({ step_id: STEP_A, created_at: "2026-01-01T00:00:00Z" }),
      makeApprovalRow({ step_id: STEP_B, created_at: "2026-01-02T00:00:00Z" }),
    ];
    const result = buildApprovalNotes(rows, [
      { id: STEP_A, title: "Requirements" },
      { id: STEP_B, title: "UX Design" },
    ]);
    expect(result.map((n) => n.step_title)).toEqual(["Requirements", "UX Design"]);
  });

  it("falls back author_name to null when the users join misses", () => {
    const rows = [makeApprovalRow({ users: null })];
    const result = buildApprovalNotes(rows, [{ id: STEP_A, title: "Requirements" }]);
    expect(result[0].author_name).toBeNull();
  });

  it("falls back step_title to 'Unknown step' when a row's step isn't in priorSteps", () => {
    const rows = [makeApprovalRow({ step_id: STEP_A })];
    const result = buildApprovalNotes(rows, []);
    expect(result[0].step_title).toBe("Unknown step");
  });

  it("returns [] for [] input", () => {
    expect(buildApprovalNotes([], [{ id: STEP_A, title: "Requirements" }])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildApproverGuidanceBlock — 0/1/2 notes
// ---------------------------------------------------------------------------

describe("buildApproverGuidanceBlock", () => {
  function makeNote(overrides: Partial<ApprovalNote> = {}): ApprovalNote {
    return {
      step_id: STEP_A,
      step_title: "Requirements",
      content: "Approved — but rename the field to retry_count.",
      author_id: "human-1",
      author_name: "Nick Ball",
      created_at: "2026-01-01T00:00:00Z",
      ...overrides,
    };
  }

  it("returns an empty string for 0 notes", () => {
    expect(buildApproverGuidanceBlock([])).toBe("");
  });

  it("formats a single note with heading, binding-constraint sentence, and one bullet", () => {
    const block = buildApproverGuidanceBlock([makeNote()]);
    expect(block).toContain("APPROVER GUIDANCE: A human approved 1 prior step(s) in this run with notes");
    expect(block).toContain("BINDING constraint");
    expect(block).toContain(
      '- After "Requirements" (Nick Ball, 2026-01-01T00:00:00Z): Approved — but rename the field to retry_count.'
    );
  });

  it("formats two notes as one bullet line each, in input order", () => {
    const notes = [
      makeNote({ step_title: "Requirements", content: "Note one" }),
      makeNote({ step_title: "UX Design", content: "Note two", author_name: "Priya" }),
    ];
    const block = buildApproverGuidanceBlock(notes);
    expect(block).toContain("A human approved 2 prior step(s)");
    const lines = block.split("\n").filter((l) => l.startsWith("- "));
    expect(lines).toEqual([
      '- After "Requirements" (Nick Ball, 2026-01-01T00:00:00Z): Note one',
      '- After "UX Design" (Priya, 2026-01-01T00:00:00Z): Note two',
    ]);
  });

  it("renders 'unknown' when author_name is null", () => {
    const block = buildApproverGuidanceBlock([makeNote({ author_name: null })]);
    expect(block).toContain("(unknown, 2026-01-01T00:00:00Z)");
  });
});
