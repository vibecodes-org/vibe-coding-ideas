// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PLATFORM_AGENTS, PRIOR_WORK_RULE } from "./platform-agents";
import { generateInstructions, parseInstructions } from "./agent-instructions";

// Pins src/lib/platform-agents.ts and migration 00190 to
// docs/stage3-agents.json, the reviewed and approved source of the five
// platform agents (board task 472d5672, stage 3).

const ROOT = path.join(__dirname, "../..");
const data = JSON.parse(readFileSync(path.join(ROOT, "docs/stage3-agents.json"), "utf8")) as {
  agents: {
    platform_id: string;
    name: string;
    role: string;
    chip_icon: string;
    bio: string;
    tool_access: string;
    fields: { oneLine: string; job: string; handBack: string; mustNot: string; leftover: string };
    prompt: string;
  }[];
  platform_retire_unpublish: string[];
  template_role_swaps: { templates: string[]; to_full_stack: string[]; to_qa: string[] };
  kits_agent_roles: Record<string, { role: string; skills: string[]; name_suggestion: string }[]>;
  featured_teams: {
    deactivate: string[];
    new: { id: string; name: string; agents: { bot_id: string; display_order: number }[] };
  };
};
const migration = readFileSync(path.join(ROOT, "supabase/migrations/00190_stage3_agent_definitions.sql"), "utf8");

const FIVE = ["Planner", "Full Stack Engineer", "Code Reviewer", "QA Engineer", "DevOps Engineer"];

describe("platform-agents.ts vs docs/stage3-agents.json", () => {
  it("has the five agents in the starter order", () => {
    expect(PLATFORM_AGENTS.map((a) => a.role)).toEqual(FIVE);
    expect(data.agents.map((a) => a.role).sort()).toEqual([...FIVE].sort());
  });

  it("matches the data file field by field, and generates the approved prompt", () => {
    for (const a of PLATFORM_AGENTS) {
      const d = data.agents.find((x) => x.role === a.role)!;
      expect(a.id, a.role).toBe(d.platform_id);
      expect(a.name, a.role).toBe(d.name);
      expect(a.bio, a.role).toBe(d.bio);
      expect(a.toolAccess, a.role).toBe(d.tool_access);
      expect(a.chipIcon, a.role).toBe(d.chip_icon);
      expect(a.instructions, a.role).toEqual(d.fields);
      expect(generateInstructions(a.instructions), a.role).toBe(d.prompt);
    }
  });

  it("only Code Reviewer is Read-only", () => {
    expect(PLATFORM_AGENTS.filter((a) => a.toolAccess === "read_only").map((a) => a.role)).toEqual(["Code Reviewer"]);
  });

  it("reads back from its generated text into the same boxes", () => {
    for (const a of PLATFORM_AGENTS) {
      expect(parseInstructions(generateInstructions(a.instructions), a.role), a.role).toEqual({
        fields: a.instructions,
        source: "new",
      });
    }
  });

  it("is at most 1,900 characters, carries the prior-work rule, and names no product, person or machine", () => {
    for (const a of PLATFORM_AGENTS) {
      const prompt = generateInstructions(a.instructions);
      expect(prompt.length, `${a.role} is ${prompt.length}`).toBeLessThanOrEqual(1900);
      expect(a.instructions.mustNot, a.role).toContain(PRIOR_WORK_RULE);
      expect(prompt, a.role).toContain("fail_step");
      expect(prompt, a.role).not.toMatch(/\bNick\b|\bMac\b|vibecodes\.co\.uk|VibeCodes/);
    }
  });

  it("no agent is told to reassign the card to itself", () => {
    for (const a of PLATFORM_AGENTS) {
      expect(generateInstructions(a.instructions), a.role).not.toMatch(/reassign|assign (it|the card|the task) to yourself/i);
    }
  });
});

describe("migration 00190 vs docs/stage3-agents.json", () => {
  const updates = [
    ...migration.matchAll(
      /UPDATE public\.bot_profiles\s+SET system_prompt = \$agent\$([\s\S]*?)\$agent\$,\s+bio = '((?:[^']|'')*)',\s+tool_access = '(\w+)',\s+updated_at = now\(\)\s+WHERE id = '([^']+)';/g
    ),
  ].map((m) => ({ prompt: m[1], bio: m[2].replace(/''/g, "'"), toolAccess: m[3], id: m[4] }));

  it("rewrites exactly the five platform rows, each with the approved text, tagline and access", () => {
    expect(updates.map((u) => u.id).sort()).toEqual(data.agents.map((a) => a.platform_id).sort());
    for (const u of updates) {
      const a = PLATFORM_AGENTS.find((x) => x.id === u.id)!;
      expect(u.prompt, a.role).toBe(generateInstructions(a.instructions));
      expect(u.bio, a.role).toBe(a.bio);
      expect(u.toolAccess, a.role).toBe(a.toolAccess);
    }
  });

  it("unpublishes exactly the 19 others", () => {
    const block = migration.match(/SET is_published = false, updated_at = now\(\)\s+WHERE is_published AND id IN \(([\s\S]*?)\);/);
    expect(block).not.toBeNull();
    const ids = [...block![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(ids.sort()).toEqual([...data.platform_retire_unpublish].sort());
    expect(ids).toHaveLength(19);
    for (const a of data.agents) expect(ids).not.toContain(a.platform_id);
  });

  it("writes each kit's roles from the data file, all within the five", () => {
    const written = new Map(
      [
        ...migration.matchAll(
          /SET agent_roles = \$kit\$((?:(?!\$kit\$)[\s\S])*)\$kit\$::jsonb,\s+updated_at = now\(\)\s+WHERE name = '([^']+)';/g
        ),
      ].map((m) => [m[2], JSON.parse(m[1]) as { role: string }[]])
    );
    expect([...written.keys()].sort()).toEqual(Object.keys(data.kits_agent_roles).sort());
    for (const [kit, roles] of Object.entries(data.kits_agent_roles)) {
      expect(written.get(kit), kit).toEqual(roles);
      for (const r of written.get(kit)!) expect(FIVE, `${kit}: ${r.role}`).toContain(r.role);
    }
    expect(data.kits_agent_roles["Design System"].map((r) => r.role)).toContain("Code Reviewer");
  });

  it("switches off the five old teams and adds one with the five agents", () => {
    for (const id of data.featured_teams.deactivate) expect(migration).toContain(`'${id}'`);
    const n = data.featured_teams.new;
    expect(n.agents.map((x) => x.bot_id).sort()).toEqual(data.agents.map((a) => a.platform_id).sort());
    expect(migration).toContain(`VALUES ('${n.id}', '${n.name}'`);
    for (const x of n.agents) expect(migration).toContain(`('${n.id}', '${x.bot_id}'`);
  });

  it("keeps the backup, and writes no private text", () => {
    expect(migration).toContain("'pre-agent-definitions-00190'");
    expect(migration).not.toMatch(/INSERT INTO public\.bot_profiles/);
  });
});

describe("library template roles after the role swap", () => {
  const stage2 = JSON.parse(readFileSync(path.join(ROOT, "docs/stage2-templates.json"), "utf8")) as {
    templates: { key: string; name: string; steps?: { role: string }[] }[];
  };
  const swap = data.template_role_swaps;
  const swapRole = (r: string) =>
    swap.to_full_stack.includes(r) ? "Full Stack Engineer" : swap.to_qa.includes(r) ? "QA Engineer" : r;

  it("every platform library template uses only the five roles", () => {
    const library = stage2.templates.filter((t) => t.steps && !["quick-fix", "ux-ui-spike"].includes(t.key));
    expect(library.length).toBeGreaterThan(0);
    for (const t of library) {
      for (const s of t.steps!) expect(FIVE, `${t.name}: ${s.role}`).toContain(swapRole(s.role));
    }
  });

  it("the migration swaps exactly the listed roles on the seven templates", () => {
    for (const r of [...swap.to_full_stack, ...swap.to_qa]) expect(migration).toContain(`'${r}'`);
    for (const n of swap.templates) expect(migration).toContain(`'${n}'`);
    expect(swap.templates).toHaveLength(7);
  });
});
