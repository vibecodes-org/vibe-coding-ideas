import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, type Dirent } from "node:fs";
import { join, relative } from "node:path";

/**
 * Regression guard for the prod "Enhance with AI" outage of 2026-08-07
 * (masked Server Components error → "No object generated: response did not
 * match schema.").
 *
 * Root cause: `@ai-sdk/anthropic`'s built-in model capability table predates
 * `claude-sonnet-5`, so `getModelCapabilities()` treats it as an unknown model
 * with `supportsStructuredOutput: false` and generateObject falls back to
 * tool-mode JSON — which Sonnet 5 answers with the object double-encoded as a
 * string (`{"questions": "{\"questions\":[...]}"}`), failing zod validation on
 * every call.
 *
 * The fix is to force the native structured-output API per call:
 * `providerOptions: ANTHROPIC_STRUCTURED_OUTPUT_OPTIONS` (or its low-effort
 * variant, both in ai-helpers.ts). This guard scans the source tree and fails
 * if any `generateObject(` / `streamObject(` call site is missing that option,
 * so a new AI feature can't silently reintroduce the tool-mode fallback. The
 * stakes rose with Sonnet 5.5 / Opus 5.5: the fallback's FORCED tool choice is
 * rejected outright by those models, so a missed call site breaks on the model
 * flip. `streamObject` was originally missed here (generate-tasks route).
 *
 * NOT COVERED: the option's runtime effect (needs a live Anthropic call);
 * `generateText` / `streamText` call sites (no schema, immune to this
 * failure mode).
 */

const STRUCTURED_OUTPUT_OPTION =
  /providerOptions: ANTHROPIC_STRUCTURED_OUTPUT(?:_LOW_EFFORT)?_OPTIONS\b/;

// Direct awaited calls, the injectable `await generate({` form used by
// workflow-matching, and streamObject (not awaited — it returns a stream
// handle synchronously). Type/identifier references without a call don't match.
const CALL_REGEX = /(?:await\s+(?:generateObject|generate)|\bstreamObject)\(\{/g;

function findOffenders(source: string, label: string): string[] {
  const offenders: string[] = [];
  const callRegex = new RegExp(CALL_REGEX.source, "g");
  let match: RegExpExecArray | null;
  while ((match = callRegex.exec(source)) !== null) {
    // The call's argument object runs until the matching close; a window
    // is enough — these calls are all < 40 lines.
    const window = source.slice(match.index, match.index + 2000);
    const callEnd = window.indexOf("});");
    const callBody = callEnd === -1 ? window : window.slice(0, callEnd);
    if (!STRUCTURED_OUTPUT_OPTION.test(callBody)) {
      offenders.push(`${label}: \`${callBody.slice(0, 60).replace(/\s+/g, " ")}…\``);
    }
  }
  return offenders;
}

const SRC_ROOT = join(__dirname, "..");

function walk(dir: string): string[] {
  const entries: Dirent[] = readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
    return [full];
  });
}

describe("generateObject structured-output guard", () => {
  it("every generateObject / streamObject call passes a structured-output option", () => {
    const offenders = walk(SRC_ROOT).flatMap((file) =>
      findOffenders(readFileSync(file, "utf8"), relative(SRC_ROOT, file))
    );

    expect(
      offenders,
      `generateObject call(s) missing providerOptions: ANTHROPIC_STRUCTURED_OUTPUT_OPTIONS — ` +
        `without it, @ai-sdk/anthropic falls back to tool-mode JSON on model ids its ` +
        `capability table doesn't know (e.g. claude-sonnet-5), which double-encodes ` +
        `the object and fails schema validation:\n${offenders.join("\n")}`
    ).toEqual([]);
  });

  it("the shared option constant still forces outputFormat mode", () => {
    const helpers = readFileSync(join(SRC_ROOT, "lib", "ai-helpers.ts"), "utf8");
    expect(helpers).toContain('structuredOutputMode: "outputFormat"');
  });

  it("the low-effort variant keeps outputFormat mode", async () => {
    const { ANTHROPIC_STRUCTURED_OUTPUT_LOW_EFFORT_OPTIONS } = await import("./ai-helpers");
    expect(ANTHROPIC_STRUCTURED_OUTPUT_LOW_EFFORT_OPTIONS).toEqual({
      anthropic: { structuredOutputMode: "outputFormat", effort: "low" },
    });
  });

  describe("the scanner itself", () => {
    it("flags a streamObject call with no structured-output option", () => {
      const source = `const result = streamObject({\n  model,\n  schema: S,\n  maxOutputTokens: 8000,\n});`;
      expect(findOffenders(source, "x.ts")).toHaveLength(1);
    });

    it("flags an awaited generateObject call with no structured-output option", () => {
      const source = `const { object } = await generateObject({\n  model,\n  schema: S,\n});`;
      expect(findOffenders(source, "x.ts")).toHaveLength(1);
    });

    it("accepts either the plain or the low-effort option", () => {
      const plain = `streamObject({\n  schema: S,\n  providerOptions: ANTHROPIC_STRUCTURED_OUTPUT_OPTIONS,\n});`;
      const low = `await generateObject({\n  schema: S,\n  providerOptions: ANTHROPIC_STRUCTURED_OUTPUT_LOW_EFFORT_OPTIONS,\n});`;
      expect(findOffenders(plain, "x.ts")).toEqual([]);
      expect(findOffenders(low, "x.ts")).toEqual([]);
    });

    it("ignores imports and type references", () => {
      const source = `import { streamObject, generateObject } from "ai";\ntype T = typeof streamObject;`;
      expect(findOffenders(source, "x.ts")).toEqual([]);
    });
  });
});
