// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Pins migration 00189 to docs/stage2-templates.json, the reviewed and approved
// source of the new platform workflow templates (board task 472d5672, stage 2).

interface DataStep {
  role: string;
  title: string;
  model_tier: string;
  description: string;
  deliverables: string[];
  requires_approval: boolean;
}
interface DataTemplate {
  key: string;
  name: string;
  kits: string[];
  description: string;
  steps?: DataStep[];
}

const ROOT = path.join(__dirname, "../..");
const data = JSON.parse(readFileSync(path.join(ROOT, "docs/stage2-templates.json"), "utf8")) as {
  templates: DataTemplate[];
  retired: { name: string }[];
};
const migration = readFileSync(
  path.join(ROOT, "supabase/migrations/00189_workflow_templates_best_practice.sql"),
  "utf8"
);

// Board-only templates are not in the platform library.
const BOARD_ONLY = new Set(["quick-fix", "ux-ui-spike"]);
const library = data.templates.filter((t) => !BOARD_ONLY.has(t.key));

const updates = [
  ...migration.matchAll(
    /UPDATE public\.workflow_library_templates\s+SET steps = \$tpl\$([\s\S]*?)\$tpl\$::jsonb,\s+description = \$tpl\$([\s\S]*?)\$tpl\$,\s+updated_at = now\(\)\s+WHERE name = \$tpl\$([\s\S]*?)\$tpl\$;/g
  ),
].map((m) => ({ steps: JSON.parse(m[1]) as DataStep[], description: m[2], name: m[3] }));

describe("migration 00189 vs docs/stage2-templates.json", () => {
  it("updates all 17 library templates, each once, by name", () => {
    expect(library).toHaveLength(17);
    expect(updates.map((u) => u.name).sort()).toEqual(library.map((t) => t.name).sort());
  });

  it.each(library.map((t) => [t.name, t] as const))("%s: steps and description match the data", (_name, t) => {
    const u = updates.find((x) => x.name === t.name);
    expect(u).toBeDefined();
    expect(u!.description).toBe(t.description);
    expect(u!.steps).toEqual(
      t.steps!.map((s) => ({
        role: s.role,
        title: s.title,
        model_tier: s.model_tier,
        description: s.description,
        deliverables: s.deliverables,
        requires_approval: s.requires_approval,
      }))
    );
  });

  it("every step has a role, title, tier, description and at least one deliverable", () => {
    for (const u of updates) {
      expect(u.steps.length).toBeGreaterThan(0);
      for (const s of u.steps) {
        expect(s.role).toBeTruthy();
        expect(s.title).toBeTruthy();
        expect(["frontier", "standard", "cheap"]).toContain(s.model_tier);
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

  it("switches off exactly the three retired platform templates", () => {
    const m = migration.match(/SET is_active = false,[\s\S]*?WHERE name IN \(([^)]*)\);/);
    expect(m).not.toBeNull();
    const names = [...m![1].matchAll(/\$tpl\$([\s\S]*?)\$tpl\$/g)].map((x) => x[1]).sort();
    expect(names).toEqual(["Client Project", "Design Review", "Product Launch"]);
    const retiredInData = data.retired.map((r) => r.name);
    for (const n of names) expect(retiredInData).toContain(n);
  });

  it("adds a guarded Planner to exactly the kits that ship a rewritten template", () => {
    const m = migration.match(
      /SET agent_roles = agent_roles \|\| \$tpl\$(\[[^$]*\])\$tpl\$::jsonb\s+WHERE name IN \(([^)]*)\)\s+AND NOT agent_roles @> \$tpl\$(\[[^$]*\])\$tpl\$::jsonb;/
    );
    expect(m).not.toBeNull();
    expect(JSON.parse(m![1])).toEqual([{ role: "Planner", skills: [], name_suggestion: "Planner" }]);
    expect(JSON.parse(m![3])).toEqual([{ role: "Planner" }]);
    const kits = [...m![2].matchAll(/\$tpl\$([\s\S]*?)\$tpl\$/g)].map((x) => x[1]).sort();
    const expected = [...new Set(library.flatMap((t) => t.kits))].sort();
    expect(kits).toEqual(expected);
    expect(kits).toHaveLength(7);
  });
});
