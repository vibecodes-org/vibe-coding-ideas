// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Pins migration 00201 (Bug Fix v2 in the platform library, board task 5e654dd1
// stage 7): the Planner + Fix pair becomes one standard-tier "Investigate and fix"
// step that hands back ESCALATE for the top model.

interface Step {
  role: string;
  title: string;
  model_tier: string;
  description: string;
  deliverables: string[];
  requires_approval: boolean;
}

const migration = readFileSync(
  path.join(__dirname, "../../supabase/migrations/00201_library_bug_fix_v2.sql"),
  "utf8"
);

const updates = [
  ...migration.matchAll(
    /UPDATE public\.workflow_library_templates\s+SET steps = \$tpl\$([\s\S]*?)\$tpl\$::jsonb,\s+description = \$tpl\$([\s\S]*?)\$tpl\$,\s+updated_at = now\(\)\s+WHERE name = \$tpl\$([\s\S]*?)\$tpl\$;/g
  ),
].map((m) => ({ steps: JSON.parse(m[1]) as Step[], description: m[2], name: m[3] }));

const byName = (name: string) => updates.find((u) => u.name === name)!;

describe("migration 00201: Bug Fix v2 in the platform library", () => {
  it("updates exactly Bug Fix and Game Bug Fix, once each", () => {
    expect(updates.map((u) => u.name).sort()).toEqual(["Bug Fix", "Game Bug Fix"]);
  });

  it.each(["Bug Fix", "Game Bug Fix"])("%s: one standard-tier investigate-and-fix step, then frontier review, then the gate", (name) => {
    const steps = byName(name).steps;
    expect(steps.map((s) => [s.role, s.model_tier, s.requires_approval])).toEqual([
      ["Full Stack Engineer", "standard", false],
      ["Code Reviewer", "frontier", false],
      ["QA Engineer", "standard", true],
    ]);
    expect(steps[0].title).toBe("Investigate and fix");
    expect(steps[0].description).toContain('"ESCALATE: needs the top model"');
    expect(steps[0].description).toContain("update_step it to model_tier frontier");
  });

  it("no step still points at the removed steps", () => {
    for (const u of updates) {
      for (const s of u.steps) {
        expect(s.description, `${u.name} / ${s.title}`).not.toMatch(/Investigate and plan the fix|reset to Fix\b/);
        expect(s.role).not.toBe("Planner");
      }
    }
  });

  it("every step has a description and at least one deliverable", () => {
    for (const u of updates) {
      for (const s of u.steps) {
        expect(s.description.length).toBeGreaterThan(20);
        expect(s.deliverables.length).toBeGreaterThan(0);
      }
    }
  });

  it("platform wording never names a person, a machine or a site", () => {
    for (const u of updates) {
      const text = JSON.stringify(u);
      expect(text, u.name).not.toMatch(/\bNick\b/);
      expect(text, u.name).not.toMatch(/\bMac\b/);
      expect(text, u.name).not.toMatch(/vibecodes\.co\.uk/);
    }
  });
});
