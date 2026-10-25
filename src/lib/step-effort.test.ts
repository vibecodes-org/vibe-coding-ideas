import { describe, it, expect } from "vitest";
import {
  isStepEffort,
  resolveModelTier,
  stepEffortForAgent,
  SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS,
} from "./platform-model-defaults";
import { validateWorkflowTemplateSteps, ValidationError } from "./validation";
import { tierResolutionLine } from "./constants";
import { sessionAgentName, sessionAgentClaimHint, buildSessionAgents } from "./terminal/session-agents";
import { selectSessionAgentPairs, normalizeStepEffort } from "./terminal/session-agent-selection";

// Per-step effort (card 5e654dd1, stage 5): a step may carry its own level that
// wins over its tier's effort.

describe("step effort levels", () => {
  it("accepts the five Claude levels and nothing else", () => {
    for (const level of ["low", "medium", "high", "xhigh", "max"]) expect(isStepEffort(level)).toBe(true);
    for (const bad of ["minimal", "ultra", "", null, undefined, 3]) expect(isStepEffort(bad)).toBe(false);
  });

  it("Claude takes the level as is; Codex runs max as xhigh", () => {
    expect(stepEffortForAgent("claude", "max")).toBe("max");
    expect(stepEffortForAgent("codex", "max")).toBe("xhigh");
    expect(stepEffortForAgent("codex", "high")).toBe("high");
    expect(stepEffortForAgent("claude", "bogus")).toBeNull();
    expect(stepEffortForAgent("codex", null)).toBeNull();
  });
});

describe("resolveModelTier with a step's own effort", () => {
  it("seed frontier on Claude is medium; a step level of high wins", () => {
    expect(SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS.defaults.frontier.claude.effort).toBe("medium");
    expect(resolveModelTier("frontier", "claude")?.effort).toBe("medium");
    expect(resolveModelTier("frontier", "claude", null, undefined, "high")?.effort).toBe("high");
  });

  it("wins over the user's own tier effort too, and leaves the model alone", () => {
    const map = { frontier: { claude: { model: "fable", effort: "low" } } };
    expect(resolveModelTier("frontier", "claude", map)).toMatchObject({ resolved: "fable", effort: "low" });
    expect(resolveModelTier("frontier", "claude", map, undefined, "xhigh")).toMatchObject({
      resolved: "fable",
      effort: "xhigh",
    });
  });

  it("an invalid or empty step level changes nothing", () => {
    for (const bad of [undefined, null, "", "minimal", "nope"]) {
      expect(resolveModelTier("frontier", "claude", null, undefined, bad)).toEqual(resolveModelTier("frontier", "claude"));
    }
  });

  it("Codex gets the step level, with max as xhigh", () => {
    expect(resolveModelTier("frontier", "codex", null, undefined, "medium")?.effort).toBe("medium");
    expect(resolveModelTier("frontier", "codex", null, undefined, "max")?.effort).toBe("xhigh");
    expect(resolveModelTier("frontier", "codex")?.effort).toBe("high");
  });
});

describe("validateWorkflowTemplateSteps with effort", () => {
  const base = { title: "Security review", role: "Code Reviewer" };

  it("passes a valid level through on a tiered step", () => {
    const [step] = validateWorkflowTemplateSteps([{ ...base, model_tier: "frontier", effort: "high" }]);
    expect(step.effort).toBe("high");
  });

  it("omits the key when absent or null", () => {
    expect(validateWorkflowTemplateSteps([{ ...base, model_tier: "frontier" }])[0]).not.toHaveProperty("effort");
    expect(validateWorkflowTemplateSteps([{ ...base, model_tier: "frontier", effort: null }])[0]).not.toHaveProperty("effort");
  });

  it("rejects an unknown level with a step-numbered message", () => {
    expect(() => validateWorkflowTemplateSteps([base, { ...base, model_tier: "frontier", effort: "turbo" }])).toThrow(
      /Step 2: invalid effort "turbo"/
    );
  });

  it("rejects a level on a step with no tier", () => {
    expect(() => validateWorkflowTemplateSteps([{ ...base, effort: "high" }])).toThrow(ValidationError);
    expect(() => validateWorkflowTemplateSteps([{ ...base, effort: "high" }])).toThrow(/Step 1: effort needs a model tier/);
  });
});

describe("tierResolutionLine", () => {
  const claude = { model: "opus", effort: "high" };
  const codex = { model: "gpt-6-astra", effort: "high" };

  it("is unchanged without a step level", () => {
    expect(tierResolutionLine("frontier", claude, codex)).toBe(
      "Frontier → Opus (high) on Claude · gpt-6-astra (high) on Codex"
    );
  });

  it("says the level was set on the step", () => {
    expect(tierResolutionLine("frontier", claude, codex, true)).toBe(
      "Frontier → Opus (high, set on this step) on Claude · gpt-6-astra (high, set on this step) on Codex"
    );
  });
});

describe("session agents for a step's own effort", () => {
  const ATLAS = { id: "37e8ffb2-3f88-49e5-9ab4-a516c1088f77", name: "Atlas" };

  it("steps without a level keep today's names", () => {
    expect(sessionAgentName(ATLAS, "frontier")).toBe("vc-atlas-37e8ffb2-frontier");
    expect(sessionAgentName(ATLAS, "frontier", null)).toBe("vc-atlas-37e8ffb2-frontier");
    expect(sessionAgentName(ATLAS, null)).toBe("vc-atlas-37e8ffb2");
  });

  it("a step with a level gets its own definition name; an untiered step never does", () => {
    expect(sessionAgentName(ATLAS, "frontier", "high")).toBe("vc-atlas-37e8ffb2-frontier-high");
    expect(sessionAgentName(ATLAS, null, "high")).toBe("vc-atlas-37e8ffb2");
  });

  it("the claim hint and the built definition agree on name and tag", () => {
    const bot = { ...ATLAS, role: "Full Stack Engineer", system_prompt: "## Goal\nShip it." };
    const hint = sessionAgentClaimHint({ bot, tier: "frontier", model: "opus", effort: "high", stepEffort: "high" });
    expect(hint.name).toBe("vc-atlas-37e8ffb2-frontier-high");
    const agents = buildSessionAgents([
      { bot, tier: "frontier", model: "opus", effort: "high", stepEffort: "high", skills: [] },
    ]);
    expect(agents?.[hint.name].description.endsWith(hint.tag)).toBe(true);
    expect(agents?.[hint.name]).toMatchObject({ model: "opus", effort: "high" });
  });
});

describe("selectSessionAgentPairs with a step's own effort", () => {
  const ATLAS = "bot-atlas";
  const LENS = "bot-lens";
  const pool = [
    { botId: ATLAS, role: "Full Stack Engineer" },
    { botId: LENS, role: "Code Reviewer" },
  ];

  it("normalizeStepEffort keeps a valid level on a tiered step only", () => {
    expect(normalizeStepEffort("frontier", "high")).toBe("high");
    expect(normalizeStepEffort("frontier", "nope")).toBeNull();
    expect(normalizeStepEffort(null, "high")).toBeNull();
  });

  it("keeps an overridden waiting step apart from the same agent and tier without one", () => {
    const { waiting } = selectSessionAgentPairs({
      claimableSteps: [
        { bot_id: LENS, model_tier: "frontier", effort_override: "high" },
        { bot_id: LENS, model_tier: "frontier", effort_override: null },
        { bot_id: LENS, model_tier: "frontier" },
      ],
      templates: [],
      pool,
      cachedMatches: null,
    });
    expect(waiting).toEqual([
      { botId: LENS, tier: "frontier", effort: null, uses: 2 },
      { botId: LENS, tier: "frontier", effort: "high", uses: 1 },
    ]);
  });

  it("reads a template step's effort for the optional agents", () => {
    const { optional } = selectSessionAgentPairs({
      claimableSteps: [],
      templates: [
        { steps: [{ role: "Code Reviewer", model_tier: "frontier", effort: "high" }, { role: "Code Reviewer", model_tier: "frontier" }] },
      ],
      pool,
      cachedMatches: null,
    });
    expect(optional).toEqual(
      expect.arrayContaining([
        { botId: LENS, tier: "frontier", effort: "high", uses: 1 },
        { botId: LENS, tier: "frontier", effort: null, uses: 1 },
      ])
    );
    expect(optional).toHaveLength(2);
  });
});
