import { describe, it, expect } from "vitest";
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

  it("folds skill content into the prompt", () => {
    const agents = buildSessionAgents([input({ skills: [{ name: "testing", content: "Write the test first." }] })]);
    expect(agents!["vc-atlas-37e8ffb2-frontier"].prompt).toContain("### testing\nWrite the test first.");
  });

  it("swaps skill content for load-on-demand pointers when the payload is too big", () => {
    const bigSkill = { name: "huge", content: "x".repeat(5000) };
    const agents = buildSessionAgents([input({ skills: [bigSkill] })], 2000);
    const prompt = agents!["vc-atlas-37e8ffb2-frontier"].prompt;
    expect(prompt).not.toContain("xxxx");
    expect(prompt).toContain(`get_agent_skill_content (agent_id "${ATLAS.id}")`);
    expect(prompt).toContain("huge");
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

  it("tells the orchestrator to fall back when there's no match, and what to report when there is", () => {
    const { instruction } = sessionAgentClaimHint({ bot: ATLAS, tier: "frontier", model: "opus", effort: "high" });
    expect(instruction).toContain('"vc-atlas-37e8ffb2-frontier"');
    expect(instruction).toContain('persona_used "verbatim"');
    expect(instruction).toContain('model_used "opus", reasoning_effort_used "high"');
    expect(instruction).toContain("follow the steps above");
  });

  it("asks for no model report on an Auto step", () => {
    const { instruction } = sessionAgentClaimHint({ bot: ATLAS, tier: null, model: null, effort: null });
    expect(instruction).not.toContain("model_used");
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
