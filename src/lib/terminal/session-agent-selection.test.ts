import { describe, it, expect, vi } from "vitest";
import { normalizeStepTier, resolveRolesWithoutAi, selectSessionAgentPairs } from "./session-agent-selection";

const PLANNER = "d799aba2-dc93-4379-8172-786dd8be0246";
const ATLAS = "37e8ffb2-3f88-49e5-9ab4-a516c1088f77";
const SENTINEL = "da04a09c-c04f-43be-b167-d9b321fabdf6";
const SENTINEL_2 = "aaaaaaaa-c04f-43be-b167-d9b321fabdf6";

const POOL = [
  { botId: PLANNER, role: "Planner" },
  { botId: ATLAS, role: "Full Stack Engineer" },
  { botId: SENTINEL, role: "QA Engineer" },
];

describe("normalizeStepTier", () => {
  it("keeps the three known tiers and treats anything else as untiered", () => {
    expect(normalizeStepTier("frontier")).toBe("frontier");
    expect(normalizeStepTier("cheap")).toBe("cheap");
    expect(normalizeStepTier(null)).toBeNull();
    expect(normalizeStepTier("turbo")).toBeNull();
    expect(normalizeStepTier(3)).toBeNull();
  });
});

describe("resolveRolesWithoutAi", () => {
  it("matches a role exactly, ignoring case and spacing, and returns every agent with it", () => {
    const pool = [...POOL, { botId: SENTINEL_2, role: "qa engineer" }];
    expect(resolveRolesWithoutAi([" QA Engineer "], pool, null).get(" QA Engineer ")).toEqual([SENTINEL, SENTINEL_2]);
  });

  it("uses the board's cached match when it is still allocated, and ignores a stale one", () => {
    const cache = { QA: { botId: SENTINEL }, Gone: { botId: "removed-bot" } };
    const resolved = resolveRolesWithoutAi(["QA", "Gone"], POOL, cache);
    expect(resolved.get("QA")).toEqual([SENTINEL]);
    expect(resolved.has("Gone")).toBe(false);
  });

  it("falls back to the fuzzy matcher, and skips a role nothing matches", () => {
    const resolved = resolveRolesWithoutAi(["Engineer", "Astronaut"], POOL, null);
    expect(resolved.get("Engineer")).toBeDefined();
    expect(resolved.has("Astronaut")).toBe(false);
  });

  it("never calls the AI matcher", async () => {
    const ai = await import("../ai-role-matching");
    const spy = vi.spyOn(ai, "matchRolesWithAi");
    resolveRolesWithoutAi(["QA"], POOL, null);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("selectSessionAgentPairs", () => {
  const templates = [
    {
      steps: [
        { role: "Planner", model_tier: "frontier" },
        { role: "Full Stack Engineer", model_tier: "standard" },
        { role: "Full Stack Engineer", model_tier: "standard" },
        { role: "QA Engineer" },
      ],
    },
  ];

  it("puts agents with a waiting step in waiting, counting steps and normalising tiers", () => {
    const { waiting } = selectSessionAgentPairs({
      claimableSteps: [
        { bot_id: ATLAS, model_tier: "standard" },
        { bot_id: ATLAS, model_tier: "standard" },
        { bot_id: SENTINEL, model_tier: "weird" },
        { bot_id: null, model_tier: "cheap" },
      ],
      templates: [],
      pool: POOL,
      cachedMatches: null,
    });
    expect(waiting).toEqual([
      { botId: ATLAS, tier: "standard", uses: 2 },
      { botId: SENTINEL, tier: null, uses: 1 },
    ]);
  });

  it("offers a template-only agent when it has no waiting step (the Planner case)", () => {
    const { waiting, optional } = selectSessionAgentPairs({
      claimableSteps: [{ bot_id: ATLAS, model_tier: "standard" }],
      templates,
      pool: POOL,
      cachedMatches: null,
    });
    expect(waiting).toHaveLength(1);
    expect(optional).toEqual(
      expect.arrayContaining([
        { botId: PLANNER, tier: "frontier", uses: 1 },
        { botId: SENTINEL, tier: null, uses: 1 },
      ]),
    );
  });

  it("never lists a waiting pair as optional, and orders optional by use", () => {
    const { optional } = selectSessionAgentPairs({
      claimableSteps: [{ bot_id: PLANNER, model_tier: "frontier" }],
      templates,
      pool: POOL,
      cachedMatches: null,
    });
    expect(optional.some((p) => p.botId === PLANNER)).toBe(false);
    expect(optional[0]).toEqual({ botId: ATLAS, tier: "standard", uses: 2 });
  });

  it("copes with malformed template steps", () => {
    const { optional } = selectSessionAgentPairs({
      claimableSteps: [],
      templates: [{ steps: null }, { steps: [null, { role: 5 }, { role: "  " }] }],
      pool: POOL,
      cachedMatches: null,
    });
    expect(optional).toEqual([]);
  });
});
