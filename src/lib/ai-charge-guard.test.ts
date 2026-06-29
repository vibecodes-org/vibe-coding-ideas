import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, type Dirent } from "node:fs";
import { join, relative } from "node:path";

/**
 * Architecture guard: every source file that makes a direct AI SDK call MUST
 * route its credit charge through the single chokepoint (`chargeAiUsage` /
 * `chargeAiUpfront` in `@/lib/ai-helpers`). This stops a future AI feature from
 * silently skipping the platform-credit charge by forgetting the old per-site
 * `logAiUsage` + `decrementStarterCredit` convention.
 *
 * A new AI-calling file that doesn't reference the helper FAILS this test —
 * either wire it through the chokepoint, or, if it's genuinely free/exempt, add
 * it to ALLOWLIST below with a justification.
 */

// Directories scanned for AI SDK usage. Kept narrow on purpose — these are where
// server-side AI calls live.
const SCAN_DIRS = ["src/actions", "src/app/api/ai", "src/lib"];

// The four AI SDK entry points that actually spend tokens / money.
const AI_SDK_CALLS = ["generateText", "generateObject", "streamText", "streamObject"];

/**
 * Files that legitimately call the AI SDK but must NOT route through the charge
 * chokepoint. Each entry needs a comment justifying the exemption.
 */
const ALLOWLIST: ReadonlyArray<string> = [
  // (none) — every current AI-calling file charges via the chokepoint.
];

const repoRoot = process.cwd();

function walk(dir: string): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return []; // directory may not exist in some checkouts
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(full));
    } else if (
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".d.ts")
    ) {
      files.push(full);
    }
  }
  return files;
}

/** True if the file imports one of the AI SDK call symbols from the "ai" package. */
function importsAiSdkCall(content: string): boolean {
  const importRe = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["']ai["']/g;
  let match: RegExpExecArray | null;
  while ((match = importRe.exec(content)) !== null) {
    const named = match[1];
    if (AI_SDK_CALLS.some((call) => new RegExp(`\\b${call}\\b`).test(named))) {
      return true;
    }
  }
  return false;
}

/** True if the file routes its charge through the single chokepoint. */
function usesChargeChokepoint(content: string): boolean {
  return /\bchargeAiUsage\b/.test(content) || /\bchargeAiUpfront\b/.test(content);
}

describe("AI charge chokepoint guard", () => {
  const allFiles = SCAN_DIRS.flatMap((d) => walk(join(repoRoot, d)));
  const aiCallingFiles = allFiles.filter((f) =>
    importsAiSdkCall(readFileSync(f, "utf8"))
  );

  it("finds the known AI-calling files (sanity: the scan actually works)", () => {
    // If this drops to zero the scan is broken and the guard below is vacuous.
    expect(aiCallingFiles.length).toBeGreaterThanOrEqual(5);
  });

  it("every AI-calling file routes its charge through chargeAiUsage/chargeAiUpfront", () => {
    const violations: string[] = [];

    for (const file of aiCallingFiles) {
      const rel = relative(repoRoot, file).replace(/\\/g, "/");
      if (ALLOWLIST.includes(rel)) continue;
      if (!usesChargeChokepoint(readFileSync(file, "utf8"))) {
        violations.push(rel);
      }
    }

    expect(
      violations,
      `These files call the AI SDK but don't charge via the chokepoint ` +
        `(import chargeAiUsage/chargeAiUpfront from "@/lib/ai-helpers", or add to ALLOWLIST with a reason):\n` +
        violations.map((v) => `  - ${v}`).join("\n")
    ).toEqual([]);
  });
});
