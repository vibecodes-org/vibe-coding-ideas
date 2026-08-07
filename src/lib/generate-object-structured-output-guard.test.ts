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
 * `providerOptions: ANTHROPIC_STRUCTURED_OUTPUT_OPTIONS` (defined in
 * ai-helpers.ts). This guard scans the source tree and fails if any
 * `generateObject(`-style call site is missing that option, so a new AI
 * feature can't silently reintroduce the tool-mode fallback.
 *
 * NOT COVERED: the option's runtime effect (needs a live Anthropic call);
 * `generateText` call sites (no schema, immune to this failure mode).
 */

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
  it("every generateObject call passes ANTHROPIC_STRUCTURED_OUTPUT_OPTIONS", () => {
    const offenders: string[] = [];

    for (const file of walk(SRC_ROOT)) {
      const source = readFileSync(file, "utf8");
      // Match direct calls and the injectable `await generate({` form used by
      // workflow-matching; skip type/identifier references without a call.
      const callRegex = /await\s+(?:generateObject|generate)\(\{/g;
      let match: RegExpExecArray | null;
      while ((match = callRegex.exec(source)) !== null) {
        // The call's argument object runs until the matching close; a window
        // is enough — these calls are all < 40 lines.
        const window = source.slice(match.index, match.index + 2000);
        const callEnd = window.indexOf("});");
        const callBody = callEnd === -1 ? window : window.slice(0, callEnd);
        if (!callBody.includes("providerOptions: ANTHROPIC_STRUCTURED_OUTPUT_OPTIONS")) {
          offenders.push(
            `${relative(SRC_ROOT, file)}: \`${callBody.slice(0, 60).replace(/\s+/g, " ")}…\``
          );
        }
      }
    }

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
});
