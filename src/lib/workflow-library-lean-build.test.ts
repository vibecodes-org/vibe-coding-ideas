// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Pins migration 00202 (lean Build step in the platform library, board task
// 5e654dd1 stage 8): one paragraph appended to Build in the two feature
// templates, the same text the owner approved for the board copies.

const migration = readFileSync(
  path.join(__dirname, "../../supabase/migrations/00202_library_lean_build.sql"),
  "utf8"
);

const paragraph = migration.match(/\$para\$([\s\S]*?)\$para\$/)?.[1] ?? "";

describe("migration 00202: lean Build step in the platform library", () => {
  it("targets only the two feature templates", () => {
    expect(migration).toMatch(
      /WHERE t\.name IN \('Feature Development', 'Web Application Feature'\);/
    );
  });

  it("only touches the Build step, and only once", () => {
    expect(migration).toContain("WHEN e.s->>'title' = 'Build'");
    expect(migration).toContain("position('Keep the build lean.' in e.s->>'description') = 0");
    expect(migration).toContain("ORDER BY e.ord");
  });

  it("appends the approved paragraph", () => {
    expect(paragraph.startsWith("Keep the build lean.")).toBe(true);
    expect(paragraph).toContain("don't start helper agents");
    expect(paragraph).toContain("read only the lines you need, at most about 150 at a time");
    expect(paragraph).toContain("the full suite once at the end.");
    expect(paragraph).toContain("past about 80 actions on one stage");
  });

  it("leaves tiers, roles and step count alone", () => {
    expect(migration).not.toMatch(/model_tier|requires_approval|'\{role\}'|'\{title\}'/);
  });
});
