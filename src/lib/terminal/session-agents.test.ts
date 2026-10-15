import { SYNC_MARKER } from "./session-agent-files";
import { describe, it, expect } from "vitest";
import { buildSkillsSection, personaWithSkills } from "../skills-section";
import {
  agentNameLine,
  buildSessionAgents,
  personaHash,
  sessionAgentClaimHint,
  sessionAgentName,
  sessionAgentTag,
  type SessionAgentInput,
} from "./session-agents";

const ATLAS = {
  id: "37e8ffb2-3f88-49e5-9ab4-a516c1088f77",
  name: "Atlas",
  role: "Full Stack Engineer",
  system_prompt: "## Goal\nShip it.",
};

function input(overrides: Partial<SessionAgentInput> = {}): SessionAgentInput {
  return { bot: ATLAS, tier: "frontier", model: "opus", effort: "high", skills: [], ...overrides };
}

describe("sessionAgentName", () => {
  it("is vc-<name>-<bot id prefix>-<tier>", () => {
    expect(sessionAgentName(ATLAS, "frontier")).toBe("vc-atlas-37e8ffb2-frontier");
    expect(sessionAgentName(ATLAS, "standard")).toBe("vc-atlas-37e8ffb2-standard");
  });

  it("drops the tier for Auto steps", () => {
    expect(sessionAgentName(ATLAS, null)).toBe("vc-atlas-37e8ffb2");
  });

  it("keeps two same-named agents apart by id", () => {
    const a = sessionAgentName({ id: "b0000000-0000-4000-a000-000000000004", name: "Sentinel" }, "standard");
    const b = sessionAgentName({ id: "da04a09c-c04f-43be-b167-d9b321fabdf6", name: "Sentinel" }, "standard");
    expect(a).not.toBe(b);
  });

  it("reduces any name to lowercase letters, digits and hyphens", () => {
    expect(sessionAgentName({ id: "abcdef12-x", name: "BA Bob / Café!" }, "cheap")).toBe("vc-ba-bob-cafe-abcdef12-cheap");
    expect(sessionAgentName({ id: "abcdef12-x", name: "🚀" }, null)).toBe("vc-agent-abcdef12");
  });
});

describe("sessionAgentTag", () => {
  it("changes when the persona, model or effort changes", () => {
    const base = sessionAgentTag("persona", "opus", "high");
    expect(sessionAgentTag("persona", "opus", "high")).toBe(base);
    expect(sessionAgentTag("persona edited", "opus", "high")).not.toBe(base);
    expect(sessionAgentTag("persona", "sonnet", "high")).not.toBe(base);
    expect(sessionAgentTag("persona", "opus", "medium")).not.toBe(base);
  });

  // AC8
  it("changes when a skill is added, edited or removed, and not otherwise", () => {
    const skills = [{ name: "a", content: "First." }];
    const tagFor = (s: { name: string; content: string }[]) =>
      sessionAgentTag("persona", "opus", "high", buildSkillsSection(ATLAS.id, s).text);
    const base = tagFor(skills);
    expect(tagFor([{ name: "a", content: "First." }])).toBe(base);
    expect(tagFor([{ name: "a", content: "First, edited." }])).not.toBe(base);
    expect(tagFor([...skills, { name: "b", content: "Second." }])).not.toBe(base);
    expect(tagFor([])).not.toBe(base);
  });

  it("is unchanged for an agent without skills, so sessions launched before skills were fingerprinted still match", () => {
    expect(sessionAgentTag("persona", "opus", "high", "")).toBe(sessionAgentTag("persona", "opus", "high"));
    expect(sessionAgentTag("persona", "opus", "high")).toBe(`[vc ${personaHash("persona")} opus high]`);
  });

  it("reads 'auto' for an untiered step", () => {
    expect(sessionAgentTag("p", null, null)).toBe(`[vc ${personaHash("p")} auto auto]`);
  });
});

describe("buildSessionAgents", () => {
  it("defines one subagent per bot + tier with the persona as its prompt", () => {
    const agents = buildSessionAgents([input(), input({ tier: "standard", model: "sonnet", effort: "medium" })]);
    expect(Object.keys(agents!)).toEqual(["vc-atlas-37e8ffb2-frontier", "vc-atlas-37e8ffb2-standard"]);
    const frontier = agents!["vc-atlas-37e8ffb2-frontier"];
    expect(frontier.prompt).toBe(`You are Atlas, the Full Stack Engineer on this VibeCodes board.\n\n${ATLAS.system_prompt}`);
    expect(frontier.model).toBe("opus");
    expect(frontier.effort).toBe("high");
    expect(frontier.description.endsWith(sessionAgentTag(ATLAS.system_prompt, "opus", "high"))).toBe(true);
  });

  // Live persona test, 10 Oct 2026: Atlas and Sentinel couldn't name
  // themselves — their personas describe the job, never the name.
  it("opens the prompt with the agent's own name, without changing the tag", () => {
    const def = buildSessionAgents([input()])!["vc-atlas-37e8ffb2-frontier"];
    expect(def.prompt.startsWith("You are Atlas, the Full Stack Engineer on this VibeCodes board.\n\n")).toBe(true);
    // The tag hashes the persona alone, so the claim side (which never sees the
    // name line) still matches.
    expect(def.description.endsWith(sessionAgentTag(ATLAS.system_prompt, "opus", "high"))).toBe(true);
  });

  it("counts the name line against the size cap", () => {
    const agents = buildSessionAgents([input()])!;
    const bytes = Buffer.byteLength(JSON.stringify(agents), "utf8");
    expect(buildSessionAgents([input()], bytes)).toEqual(agents);
    expect(buildSessionAgents([input()], bytes - 1)).toBeNull();
  });

  it("leaves model and effort out on Auto steps so the subagent inherits the session's", () => {
    const agents = buildSessionAgents([input({ tier: null, model: null, effort: null })]);
    const def = agents!["vc-atlas-37e8ffb2"];
    expect(def).not.toHaveProperty("model");
    expect(def).not.toHaveProperty("effort");
  });

  it("folds the shared Skills section into the prompt, after the persona", () => {
    const skills = [{ name: "testing", content: "  Write the test first.\n" }];
    const agents = buildSessionAgents([input({ skills })]);
    const prompt = agents!["vc-atlas-37e8ffb2-frontier"].prompt;
    expect(prompt).toContain("### testing\nWrite the test first.");
    expect(prompt).toBe(
      personaWithSkills(
        `You are Atlas, the Full Stack Engineer on this VibeCodes board.\n\n${ATLAS.system_prompt}`,
        buildSkillsSection(ATLAS.id, skills).text,
      ),
    );
  });

  // AC2: one function builds the section on both sides, so the persona text
  // after the name line is exactly what claim_next_step sends as persona_prompt.
  it("is byte-identical to the claim's persona_prompt apart from the name line (AC2)", () => {
    const skills = [
      { name: "a", content: "First." },
      { name: "b", content: "Second." },
    ];
    const prompt = buildSessionAgents([input({ skills })])!["vc-atlas-37e8ffb2-frontier"].prompt;
    const claimPersona = personaWithSkills(ATLAS.system_prompt, buildSkillsSection(ATLAS.id, skills).text);
    expect(prompt).toBe(`${agentNameLine(ATLAS)}\n\n${claimPersona}`);
  });

  it("swaps skill content for load-on-demand pointers when the payload is too big", () => {
    const bigSkill = { name: "huge", content: "x".repeat(5000) };
    const agents = buildSessionAgents([input({ skills: [bigSkill] })], 2000);
    const prompt = agents!["vc-atlas-37e8ffb2-frontier"].prompt;
    expect(prompt).not.toContain("xxxx");
    expect(prompt).toContain(`get_agent_skill_content (agent_id "${ATLAS.id}")`);
    expect(prompt).toContain("huge");
  });

  // AC9
  it("never lets a names-only definition match a claim", () => {
    const skills = [{ name: "huge", content: "x".repeat(5000) }];
    const claimTag = sessionAgentTag(ATLAS.system_prompt, "opus", "high", buildSkillsSection(ATLAS.id, skills).text);

    const full = buildSessionAgents([input({ skills })])!["vc-atlas-37e8ffb2-frontier"];
    expect(full.description.endsWith(claimTag)).toBe(true);

    const namesOnly = buildSessionAgents([input({ skills })], 2000)!["vc-atlas-37e8ffb2-frontier"];
    expect(namesOnly.description.endsWith(claimTag)).toBe(false);
    expect(namesOnly.description).toMatch(/\[vc skills-names-only opus high\]$/);
  });

  it("keeps matching for agents without skills when another agent's skills force names-only", () => {
    const other = { ...ATLAS, id: "da04a09c-c04f-43be-b167-d9b321fabdf6", name: "Sentinel" };
    const agents = buildSessionAgents(
      [input({ bot: other, skills: [{ name: "huge", content: "x".repeat(5000) }] }), input()],
      2200,
    )!;
    const plain = agents["vc-atlas-37e8ffb2-frontier"];
    expect(plain.description.endsWith(sessionAgentTag(ATLAS.system_prompt, "opus", "high"))).toBe(true);
  });

  it("returns null when even the slimmed payload can't fit", () => {
    expect(buildSessionAgents([input({ bot: { ...ATLAS, system_prompt: "y".repeat(5000) } })], 2000)).toBeNull();
  });

  it("returns null when no agent has a persona", () => {
    expect(buildSessionAgents([])).toBeNull();
    expect(buildSessionAgents([input({ bot: { ...ATLAS, system_prompt: "   " } })])).toBeNull();
  });
});

describe("sessionAgentClaimHint", () => {
  it("names the same subagent and tag the payload defines", () => {
    const agents = buildSessionAgents([input()])!;
    const hint = sessionAgentClaimHint({ bot: ATLAS, tier: "frontier", model: "opus", effort: "high" });
    expect(agents[hint.name]).toBeDefined();
    expect(agents[hint.name].description.endsWith(hint.tag)).toBe(true);
  });

  it("names the same tag as a definition that carries the agent's skills", () => {
    const skills = [{ name: "testing", content: "Write the test first." }];
    const agents = buildSessionAgents([input({ skills })])!;
    const hint = sessionAgentClaimHint({
      bot: ATLAS,
      tier: "frontier",
      model: "opus",
      effort: "high",
      skillsText: buildSkillsSection(ATLAS.id, skills).text,
    });
    expect(agents[hint.name].description.endsWith(hint.tag)).toBe(true);
    // The same claim without the skills text no longer matches.
    const bare = sessionAgentClaimHint({ bot: ATLAS, tier: "frontier", model: "opus", effort: "high" });
    expect(agents[bare.name].description.endsWith(bare.tag)).toBe(false);
  });

  it("tells the orchestrator to fall back when there's no match, and what to report when there is", () => {
    const { instruction } = sessionAgentClaimHint({ bot: ATLAS, tier: "frontier", model: "opus", effort: "high" });
    expect(instruction).toContain('"vc-atlas-37e8ffb2-frontier"');
    expect(instruction).toContain('persona_used "verbatim"');
    expect(instruction).toContain('model_used "opus", reasoning_effort_used "high"');
    expect(instruction).toContain("follow the steps above");
  });

  describe("when the session wasn't launched by VibeCodes (cards 7939ee17, b9205d04)", () => {
    const IDEA = "62e57071-3645-422f-96c0-b2042e39e6dd";
    const STEP = "f78635ad-c57c-4907-8b0b-74b5c7fa8819";
    const base = { bot: ATLAS, tier: "frontier" as const, model: "opus", effort: "high" };
    const full = { ...base, ideaId: IDEA, stepId: STEP };

    it("tells the orchestrator to sync this step's agent if the subagent isn't offered at all", () => {
      const { instruction } = sessionAgentClaimHint(full);
      expect(instruction).toContain(`sync_board_agents (idea_id "${IDEA}", step_id "${STEP}")`);
      expect(instruction).toContain("in the background, then end your turn");
      expect(instruction).toContain("when you wake");
    });

    it("syncs each agent at most once per session and never again after a failure or NEW_FOLDER", () => {
      const { instruction } = sessionAgentClaimHint(full);
      expect(instruction).toContain(
        "Sync each agent at most once per session, and never sync again after a failure or NEW_FOLDER.",
      );
    });

    it("re-syncs a stale copy that carries the sync marker and skips one that doesn't", () => {
      const { instruction } = sessionAgentClaimHint(full);
      expect(instruction).toContain(`starts with "${SYNC_MARKER}"`);
      expect(instruction).toMatch(/stale copy, so sync again/);
      expect(instruction).toMatch(/without that marker, VibeCodes launched this session.*skip the sync/);
    });

    it("only trusts the subagent after the sync if its tag matches", () => {
      const { instruction, tag } = sessionAgentClaimHint(full);
      expect(instruction).toContain(`ends with ${tag}`);
      expect(instruction).toMatch(/still isn't offered with that tag/);
    });

    it("keeps the general-path fallback as the last word", () => {
      const { instruction } = sessionAgentClaimHint(full);
      expect(instruction.trim().endsWith("follow the steps above.")).toBe(true);
    });

    it("is one paragraph, so the pinned instruction hashes in workflows.test.ts hold", () => {
      expect(sessionAgentClaimHint(full).instruction).not.toContain("\n");
    });

    it("says nothing about syncing without both ids, or for Codex", () => {
      expect(sessionAgentClaimHint(base).instruction).not.toContain("sync_board_agents");
      expect(sessionAgentClaimHint({ ...base, ideaId: IDEA }).instruction).not.toContain("sync_board_agents");
      const codex = sessionAgentClaimHint({ ...full, agent: "codex" });
      expect(codex.instruction).not.toContain("sync_board_agents");
    });

    it("makes no mention of a network allowlist", () => {
      expect(sessionAgentClaimHint(full).instruction).not.toMatch(/allowed domains|allowlist|vibecodes\.co\.uk/i);
    });
  });

  it("asks for no model report on an Auto step", () => {
    const { instruction } = sessionAgentClaimHint({ bot: ATLAS, tier: null, model: null, effort: null });
    expect(instruction).not.toContain("model_used");
  });

  it("explicitly asking for Claude's wording changes nothing", () => {
    const hint = { bot: ATLAS, tier: "frontier" as const, model: "opus", effort: "high" };
    expect(sessionAgentClaimHint({ ...hint, agent: "claude" })).toEqual(sessionAgentClaimHint(hint));
  });

  describe("for Codex", () => {
    const codex = { bot: ATLAS, tier: "standard" as const, model: "gpt-5.6-sol", effort: "medium", agent: "codex" as const };

    it("names the same agent type and tag a Codex payload defines", () => {
      const agents = buildSessionAgents([input({ tier: "standard", model: "gpt-5.6-sol", effort: "medium" })])!;
      const hint = sessionAgentClaimHint(codex);
      expect(agents[hint.name]).toBeDefined();
      expect(agents[hint.name].description.endsWith(hint.tag)).toBe(true);
    });

    it("speaks Codex's spawn tool, not Claude's Agent tool", () => {
      const { instruction } = sessionAgentClaimHint(codex);
      expect(instruction).toContain('agent_type "vc-atlas-37e8ffb2-standard"');
      expect(instruction).toContain("spawn_agent");
      expect(instruction).not.toContain("Agent tool");
      expect(instruction).toContain("don't put persona_prompt in its message");
      expect(instruction).toContain('report agent "codex", persona_used "verbatim" and model_used "gpt-5.6-sol", reasoning_effort_used "medium"');
      expect(instruction).toContain("follow the steps above");
    });

    it("asks for no model report on an Auto step", () => {
      const { instruction } = sessionAgentClaimHint({ ...codex, tier: null, model: null, effort: null });
      expect(instruction).not.toContain("model_used");
    });
  });
});

describe("agentNameLine", () => {
  it("names the agent and its role", () => {
    expect(agentNameLine({ name: "Sentinel", role: "QA Engineer" })).toBe(
      "You are Sentinel, the QA Engineer on this VibeCodes board.",
    );
  });

  it("falls back to 'an agent' when there's no role", () => {
    expect(agentNameLine({ name: " Lens ", role: null })).toBe("You are Lens, an agent on this VibeCodes board.");
    expect(agentNameLine({ name: "Lens", role: "  " })).toBe("You are Lens, an agent on this VibeCodes board.");
  });
});

// Task 472d5672: a Read-only agent's session definition switches its file-
// editing tools off and carries the Tools note; Full access is untouched.
describe("tool access", () => {
  const READ_ONLY = { ...ATLAS, tool_access: "read_only" as const };
  const NOTE = "## Tools\nYou're read-only: don't create, edit or delete files";
  const key = "vc-atlas-37e8ffb2-frontier";

  it("gives a read-only agent disallowedTools and the Tools note in its prompt", () => {
    const def = buildSessionAgents([input({ bot: READ_ONLY })])![key];
    expect(def.disallowedTools).toEqual(["Edit", "Write", "NotebookEdit"]);
    expect(def.prompt).toContain(NOTE);
    expect(def.prompt.endsWith("Say what should change instead.")).toBe(true);
  });

  it("leaves a full-access definition exactly as it was, with no disallowedTools key", () => {
    const plain = buildSessionAgents([input()])![key];
    const explicit = buildSessionAgents([input({ bot: { ...ATLAS, tool_access: "full" } })])![key];
    expect(plain).not.toHaveProperty("disallowedTools");
    expect(explicit).toEqual(plain);
    expect(plain.prompt).not.toContain("## Tools");
  });

  // Regression: full-access tags must not move, or every running session stops matching.
  it("keeps a full-access agent's tag identical to the persona-only tag", () => {
    const def = buildSessionAgents([input({ bot: { ...ATLAS, tool_access: "full" } })])![key];
    expect(def.description.endsWith(sessionAgentTag(ATLAS.system_prompt, "opus", "high"))).toBe(true);
  });

  it("the claim-hint tag equals the definition tag for a read-only agent, with and without skills", () => {
    for (const skills of [[], [{ name: "testing", content: "Write the test first." }]]) {
      const def = buildSessionAgents([input({ bot: READ_ONLY, skills })])![key];
      const hint = sessionAgentClaimHint({
        bot: READ_ONLY,
        tier: "frontier",
        model: "opus",
        effort: "high",
        skillsText: buildSkillsSection(ATLAS.id, skills).text,
      });
      expect(def.description.endsWith(hint.tag), `skills: ${skills.length}`).toBe(true);
    }
  });

  it("a read-only agent no longer matches a full-access claim tag", () => {
    const def = buildSessionAgents([input({ bot: READ_ONLY })])![key];
    expect(def.description.endsWith(sessionAgentTag(ATLAS.system_prompt, "opus", "high"))).toBe(false);
  });
});

describe("buildSessionAgents with optional agents", () => {
  const PLANNER = { id: "d799aba2-dc93-4379-8172-786dd8be0246", name: "Planner", role: "Planner", system_prompt: "## Goal\nPlan it." };
  const waiting = () => input({ skills: [{ name: "testing", content: "x".repeat(2000) }] });
  const optional = () => input({ bot: PLANNER, skills: [{ name: "planning", content: "y".repeat(2000) }] });
  const size = (a: object) => Buffer.byteLength(JSON.stringify(a), "utf8");

  it("adds optional agents when there is room", () => {
    const agents = buildSessionAgents([waiting()], undefined, { optional: [optional()] })!;
    expect(Object.keys(agents)).toEqual(["vc-atlas-37e8ffb2-frontier", "vc-planner-d799aba2-frontier"]);
  });

  it("never lets an optional agent displace a waiting one on a tight budget", () => {
    const base = size(buildSessionAgents([waiting()])!);
    const agents = buildSessionAgents([waiting()], base + 10, { optional: [optional()] })!;
    expect(Object.keys(agents)).toEqual(["vc-atlas-37e8ffb2-frontier"]);
  });

  it("skips an optional agent that does not fit but still takes a smaller one after it", () => {
    const small = input({ bot: { ...PLANNER, id: "11111111-0000-0000-0000-000000000000", name: "Tiny" } });
    const base = size(buildSessionAgents([waiting()])!);
    const agents = buildSessionAgents([waiting()], base + 1500, { optional: [optional(), small] })!;
    expect(Object.keys(agents)).toEqual(["vc-atlas-37e8ffb2-frontier", "vc-tiny-11111111-frontier"]);
  });

  it("sends optional agents with their skills in full, never names-only", () => {
    const agents = buildSessionAgents([waiting()], undefined, { optional: [optional()] })!;
    expect(agents["vc-planner-d799aba2-frontier"].prompt).toContain("### planning");
    expect(agents["vc-planner-d799aba2-frontier"].description).not.toContain("names-only");
  });

  it("never exceeds the budget, whatever it is", () => {
    for (let max = 300; max < 9000; max += 350) {
      const agents = buildSessionAgents([waiting(), input({ tier: "standard" })], max, { optional: [optional()] });
      if (agents) expect(size(agents)).toBeLessThanOrEqual(max);
    }
  });

  it("keeps the waiting agents that fit instead of returning nothing when even names-only is over", () => {
    const big = input({ bot: { ...ATLAS, system_prompt: "z".repeat(3000) } });
    const small = input({ tier: "standard", model: "sonnet", effort: "medium" });
    const agents = buildSessionAgents([big, small], 1200)!;
    expect(Object.keys(agents)).toEqual(["vc-atlas-37e8ffb2-standard"]);
  });

  it("defines the optional agents when nothing is waiting, and returns null only when nothing at all", () => {
    expect(Object.keys(buildSessionAgents([], undefined, { optional: [optional()] })!)).toEqual([
      "vc-planner-d799aba2-frontier",
    ]);
    expect(buildSessionAgents([], undefined, { optional: [] })).toBeNull();
    expect(buildSessionAgents([input({ bot: { ...ATLAS, system_prompt: " " } })])).toBeNull();
  });

  it("gives an optional agent the same tag a claim hands out, for Claude and Codex", () => {
    const skills = [{ name: "planning", content: "y".repeat(50) }];
    for (const [model, effort, agent] of [["opus", "high", "claude"], ["gpt-6-astra", "high", "codex"]] as const) {
      const agents = buildSessionAgents([waiting()], undefined, {
        optional: [input({ bot: PLANNER, model, effort, skills })],
      })!;
      const hint = sessionAgentClaimHint({
        bot: PLANNER,
        tier: "frontier",
        model,
        effort,
        skillsText: buildSkillsSection(PLANNER.id, skills).text,
        agent,
      });
      expect(agents[hint.name].description.endsWith(hint.tag)).toBe(true);
    }
  });
});
