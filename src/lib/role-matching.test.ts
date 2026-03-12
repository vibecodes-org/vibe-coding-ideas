import { describe, it, expect } from "vitest";
import {
  matchRoleToAgent,
  buildRoleMatcher,
  type AgentCandidate,
} from "./role-matching";

const agents: AgentCandidate[] = [
  { botId: "bot-qa", role: "QA Engineer" },
  { botId: "bot-fe", role: "Frontend Engineer" },
  { botId: "bot-be", role: "Backend Engineer" },
  { botId: "bot-fs", role: "Full Stack Developer" },
  { botId: "bot-pm", role: "Product Manager" },
  { botId: "bot-ceo", role: "CEO / Founder" },
];

describe("role-matching", () => {
  describe("Tier 1: Exact match", () => {
    it("matches exact role (case-insensitive)", () => {
      const result = matchRoleToAgent("QA Engineer", agents);
      expect(result).toEqual({ botId: "bot-qa", tier: "exact" });
    });

    it("matches with different casing", () => {
      const result = matchRoleToAgent("qa engineer", agents);
      expect(result).toEqual({ botId: "bot-qa", tier: "exact" });
    });

    it("matches with extra whitespace", () => {
      const result = matchRoleToAgent("  QA Engineer  ", agents);
      expect(result).toEqual({ botId: "bot-qa", tier: "exact" });
    });

    it("matches product manager exactly", () => {
      const result = matchRoleToAgent("Product Manager", agents);
      expect(result).toEqual({ botId: "bot-pm", tier: "exact" });
    });
  });

  describe("Tier 2: Substring match", () => {
    it("matches when step role is substring of agent role", () => {
      const result = matchRoleToAgent("Frontend", agents);
      expect(result).toEqual({ botId: "bot-fe", tier: "substring" });
    });

    it("matches when agent role is substring of step role", () => {
      const result = matchRoleToAgent("Senior Backend Engineer Lead", agents);
      expect(result).toEqual({ botId: "bot-be", tier: "substring" });
    });

    it("matches 'Backend' to 'Backend Engineer'", () => {
      const result = matchRoleToAgent("Backend", agents);
      expect(result).toEqual({ botId: "bot-be", tier: "substring" });
    });

    it("rejects short substrings (< 3 chars)", () => {
      const result = matchRoleToAgent("FE", agents);
      expect(result.tier).not.toBe("substring");
    });

    it("rejects 2-char match against short agent role", () => {
      const shortAgents: AgentCandidate[] = [{ botId: "bot-x", role: "QA" }];
      const result = matchRoleToAgent("QA Tester", shortAgents);
      // "QA" is only 2 chars normalized, below MIN_TOKEN_LENGTH for substring
      expect(result.tier).not.toBe("substring");
    });
  });

  describe("Tier 3: Word overlap (prefix match)", () => {
    it("matches prefix: 'Dev' → 'Full Stack Developer' (via substring since 'dev' appears in 'developer')", () => {
      const result = matchRoleToAgent("Dev", agents);
      expect(result).toEqual({ botId: "bot-fs", tier: "substring" });
    });

    it("matches prefix: 'Eng' → 'QA Engineer' (via substring since 'eng' appears in 'engineer')", () => {
      const result = matchRoleToAgent("Eng", agents);
      expect(result).toEqual({ botId: "bot-qa", tier: "substring" });
    });

    it("uses word-overlap when substring doesn't match", () => {
      // "Mgr" won't be a substring of "product manager" but "mgr" is a prefix of... no.
      // Better test: roles that share a word prefix but not a substring
      const specialAgents: AgentCandidate[] = [
        { botId: "bot-auto", role: "Automation Lead" },
      ];
      // "Auth" is not a substring of "automation lead", but "auth" is prefix of "auto"... no.
      // "Auto" IS a substring of "automation lead". Let's use a true word-prefix case:
      const agents2: AgentCandidate[] = [
        { botId: "bot-1", role: "Testing Coordinator" },
      ];
      // "Test" is substring of "testing coordinator" → tier 2
      // For a pure tier 3 test, we need tokens that prefix-match but aren't substrings
      const agents3: AgentCandidate[] = [
        { botId: "bot-1", role: "Dev Ops" },
      ];
      // Step role "Developer" has token "developer", agent has token "dev" → "developer".startsWith("dev") = true
      const result = matchRoleToAgent("Developer", agents3);
      expect(result).toEqual({ botId: "bot-1", tier: "word-overlap" });
    });

    it("handles separator tokenization: 'CEO / Founder' tokens", () => {
      const result = matchRoleToAgent("Founder", agents);
      // "founder" is a substring of "ceo / founder" → tier 2
      expect(result.botId).toBe("bot-ceo");
    });

    it("matches when agent token is prefix of step token", () => {
      // Step "Developer" → agent "Full Stack Developer" has token "developer" which starts with "dev"
      // But "developer" also matches by substring tier
      const result = matchRoleToAgent("Developer", agents);
      expect(result.botId).toBe("bot-fs");
    });
  });

  describe("No match", () => {
    it("returns none when no match found", () => {
      const result = matchRoleToAgent("Designer", agents);
      expect(result).toEqual({ botId: null, tier: "none" });
    });

    it("returns none for empty role", () => {
      const result = matchRoleToAgent("", agents);
      expect(result).toEqual({ botId: null, tier: "none" });
    });

    it("returns none for whitespace-only role", () => {
      const result = matchRoleToAgent("   ", agents);
      expect(result).toEqual({ botId: null, tier: "none" });
    });

    it("returns none with empty agent list", () => {
      const result = matchRoleToAgent("QA Engineer", []);
      expect(result).toEqual({ botId: null, tier: "none" });
    });
  });

  describe("Priority & tie-breaking", () => {
    it("prefers exact over substring", () => {
      const agentsWithOverlap: AgentCandidate[] = [
        { botId: "bot-1", role: "Frontend Engineer" },
        { botId: "bot-2", role: "Frontend" },
      ];
      const result = matchRoleToAgent("Frontend", agentsWithOverlap);
      // "Frontend" matches bot-2 exactly
      expect(result).toEqual({ botId: "bot-2", tier: "exact" });
    });

    it("first agent wins within same tier", () => {
      const dupes: AgentCandidate[] = [
        { botId: "bot-a", role: "QA Engineer" },
        { botId: "bot-b", role: "QA Engineer" },
      ];
      const result = matchRoleToAgent("QA Engineer", dupes);
      expect(result.botId).toBe("bot-a");
    });

    it("prefers substring over word-overlap", () => {
      const a: AgentCandidate[] = [
        { botId: "bot-1", role: "Full Stack Developer" },
        { botId: "bot-2", role: "Stack Overflow Expert" },
      ];
      const result = matchRoleToAgent("Stack", a);
      // "stack" is a substring of "full stack developer" → tier 2
      expect(result).toEqual({ botId: "bot-1", tier: "substring" });
    });
  });

  describe("buildRoleMatcher", () => {
    it("reuses pre-processed agents across multiple calls", () => {
      const matcher = buildRoleMatcher(agents);
      expect(matcher("QA Engineer").botId).toBe("bot-qa");
      expect(matcher("Frontend").botId).toBe("bot-fe");
      expect(matcher("Dev").botId).toBe("bot-fs");
      expect(matcher("Designer").botId).toBeNull();
    });

    it("filters out agents with empty roles", () => {
      const withEmpty: AgentCandidate[] = [
        { botId: "bot-1", role: "" },
        { botId: "bot-2", role: "  " },
        { botId: "bot-3", role: "QA Engineer" },
      ];
      const matcher = buildRoleMatcher(withEmpty);
      expect(matcher("QA Engineer").botId).toBe("bot-3");
    });
  });
});
