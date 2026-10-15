import { describe, it, expect } from "vitest";
import {
  EMPTY_INSTRUCTIONS,
  convertLegacy,
  convertLegacyText,
  generateInstructions,
  layoutOf,
  parseInstructions,
  toGuidedFallback,
  verifyConversion,
} from "./agent-instructions";

const LENS_LIKE = `## Goal
Review every code change for correctness and consistency. Catch bugs before they reach production.

## Expertise
- Prioritise feedback by severity.
- Review tests as critically as production code.

## Constraints
Never approve changes without reading every modified file. Do not nitpick formatting.

## Approach
When picking up a board task, reassign it to yourself. Read the PR description first.`;

const INLINE_LEGACY =
  "You are a Developer. Ship clean, tested code. Keep PRs small.\n\n" +
  "Domain expertise: Know the stack.\n\n" +
  "You must not: Skip tests.\n\n" +
  "Your approach: Write tests first.";

describe("generateInstructions", () => {
  it("writes the one line then the headed sections", () => {
    const text = generateInstructions({
      ...EMPTY_INSTRUCTIONS,
      oneLine: "You review code.",
      job: "1. Read the diff.",
      handBack: "A list of blockers.",
      mustNot: "Don't edit files.",
    });
    expect(text).toBe(
      "You review code.\n\n## Your job\n1. Read the diff.\n\n## What to hand back\nA list of blockers.\n\n## What not to do\nDon't edit files.",
    );
  });

  it("omits empty sections without leaving a heading", () => {
    const text = generateInstructions({ ...EMPTY_INSTRUCTIONS, oneLine: "Hi.", job: "Work." });
    expect(text).toBe("Hi.\n\n## Your job\nWork.");
    expect(text).not.toContain("hand back");
    expect(generateInstructions(EMPTY_INSTRUCTIONS)).toBe("");
  });

  it("keeps leftover Expertise under Notes from the old format", () => {
    const text = generateInstructions({ ...EMPTY_INSTRUCTIONS, oneLine: "Hi.", leftover: "- a\n- b" });
    expect(text).toBe("Hi.\n\n## Notes from the old format\n- a\n- b");
  });
});

describe("parseInstructions", () => {
  it("round-trips generated text", () => {
    const fields = {
      oneLine: "You plan.",
      job: "1. Read.\n2. Write.",
      handBack: "A plan.",
      mustNot: "No code.",
      leftover: "- old",
    };
    const parsed = parseInstructions(generateInstructions(fields));
    expect(parsed).toEqual({ fields, source: "new" });
  });

  it("accepts any case, ### depth and a trailing colon on headings", () => {
    const parsed = parseInstructions("Line.\n\n### YOUR JOB:\nDo it.\n\n# what not to do\nNothing.");
    expect(parsed?.source).toBe("new");
    expect(parsed?.fields).toMatchObject({ oneLine: "Line.", job: "Do it.", mustNot: "Nothing." });
  });

  it("does not misread a new-layout job that mentions 'You must not:' as legacy", () => {
    const parsed = parseInstructions("Line.\n\n## Your job\nTell them: You must not: touch it. Your approach: no.");
    expect(parsed?.source).toBe("new");
    expect(parsed?.fields.job).toContain("You must not:");
    expect(parsed?.fields.mustNot).toBe("");
  });

  it("opens a one-line-only agent as new", () => {
    expect(parseInstructions("You answer questions about the docs.")).toEqual({
      fields: { ...EMPTY_INSTRUCTIONS, oneLine: "You answer questions about the docs." },
      source: "new",
    });
  });

  it("returns null for text in neither layout", () => {
    expect(parseInstructions("First paragraph.\n\nSecond paragraph with no headings.")).toBeNull();
    expect(parseInstructions("")).toBeNull();
    expect(parseInstructions("   ")).toBeNull();
    expect(parseInstructions("x".repeat(400))).toBeNull();
  });

  it("converts the markdown old layout by the rule", () => {
    const parsed = parseInstructions(LENS_LIKE, "Code Reviewer");
    expect(parsed?.source).toBe("legacy");
    expect(parsed?.fields.oneLine).toBe(
      "Review every code change for correctness and consistency.",
    );
    expect(parsed?.fields.job).toBe(
      "Catch bugs before they reach production.\n\nWhen picking up a board task, reassign it to yourself. Read the PR description first.",
    );
    expect(parsed?.fields.mustNot).toBe(
      "Never approve changes without reading every modified file. Do not nitpick formatting.",
    );
    expect(parsed?.fields.leftover).toContain("Prioritise feedback by severity.");
    expect(parsed?.fields.handBack).toBe("");
  });

  it("converts the inline-marker old layout, stripping only the agent's own role prefix", () => {
    const matched = parseInstructions(INLINE_LEGACY, "Developer");
    expect(matched?.fields.oneLine).toBe("Ship clean, tested code.");
    expect(matched?.fields.job).toBe("Keep PRs small.\n\nWrite tests first.");
    expect(matched?.fields.mustNot).toBe("Skip tests.");
    expect(matched?.fields.leftover).toBe("Know the stack.");

    // A different role: the sentence is real content, so it stays.
    const other = parseInstructions(INLINE_LEGACY, "QA Tester");
    expect(other?.fields.oneLine).toBe("You are a Developer.");
  });

  it("keeps text before the first old heading as the start of the goal", () => {
    const parsed = parseInstructions(
      "You are a Reviewer.\nPreamble sentence one. Preamble two.\n\n## Goal\nDo the review.\n\n## Approach\nBe kind.",
      "Reviewer",
    );
    expect(parsed?.source).toBe("legacy");
    expect(parsed?.fields.oneLine).toBe("Preamble sentence one.");
    expect(parsed?.fields.job).toContain("Preamble two.");
    expect(parsed?.fields.job).toContain("Do the review.");
  });

  it("puts a first sentence too long for the one line into the job whole", () => {
    const long = `${"word ".repeat(80)}end.`;
    const parsed = parseInstructions(`## Goal\n${long} Second.\n\n## Approach\nGo.`);
    expect(parsed?.fields.oneLine).toBe("");
    expect(parsed?.fields.job.startsWith("word")).toBe(true);
    expect(parsed?.fields.job).toContain("Second.");
  });
});

describe("toGuidedFallback", () => {
  it("puts every character in Its job", () => {
    const text = "Anything at all.\n\nIn two paragraphs, with ## odd bits.";
    expect(toGuidedFallback(`  ${text}  `)).toEqual({ ...EMPTY_INSTRUCTIONS, job: text });
  });
});

describe("layoutOf and convertLegacyText", () => {
  it("classifies each layout", () => {
    expect(layoutOf("")).toBe("empty");
    expect(layoutOf(null)).toBe("empty");
    expect(layoutOf(LENS_LIKE)).toBe("legacy");
    expect(layoutOf("One line.\n\n## Your job\nWork.")).toBe("new");
    expect(layoutOf("Para one.\n\nPara two.")).toBe("neither");
  });

  it("converts only old-layout text, and converted text is not converted again", () => {
    const first = convertLegacyText(LENS_LIKE, "Code Reviewer");
    expect(first).not.toBeNull();
    expect(layoutOf(first!.text)).toBe("new");
    expect(convertLegacyText(first!.text, "Code Reviewer")).toBeNull();
    expect(convertLegacyText("Para one.\n\nPara two.")).toBeNull();
  });

  it("convertLegacy handles a goal with no sentence end", () => {
    expect(
      convertLegacy({ goal: "Just help", constraints: "", approach: "" }),
    ).toEqual({ ...EMPTY_INSTRUCTIONS, oneLine: "Just help" });
  });
});

describe("verifyConversion", () => {
  it("passes a faithful conversion of both old layouts", () => {
    for (const [text, role] of [
      [LENS_LIKE, "Code Reviewer"],
      [INLINE_LEGACY, "Developer"],
    ] as const) {
      const c = convertLegacyText(text, role)!;
      expect(verifyConversion(text, c, role)).toEqual({ ok: true });
    }
  });

  it("fails when words are lost", () => {
    const c = convertLegacyText(LENS_LIKE, "Code Reviewer")!;
    const tampered = { ...c, text: c.text.replace("Read the PR description first.", "") };
    // keep the fields in step with the text so only the word check can fail
    const fields = { ...c.fields, job: c.fields.job.replace("Read the PR description first.", "").trim() };
    const result = verifyConversion(LENS_LIKE, { fields, text: tampered.text }, "Code Reviewer");
    expect(result.ok).toBe(false);
  });

  it("fails when the new text does not read back as the same boxes", () => {
    const c = convertLegacyText(LENS_LIKE, "Code Reviewer")!;
    const result = verifyConversion(
      LENS_LIKE,
      { fields: { ...c.fields, handBack: "invented" }, text: c.text },
      "Code Reviewer",
    );
    expect(result).toEqual({ ok: false, reason: "parsed fields differ from converted fields" });
  });
});
