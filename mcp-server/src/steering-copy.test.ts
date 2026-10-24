import { describe, it, expect } from "vitest";
import { SERVER_INSTRUCTIONS, LIVE_DATA_SENTENCE, RESPONSE_REMINDER, COMPACTION_RULES } from "./steering-copy";

// docs/mcp-usage-steering-design.html §3: one vocabulary across every
// surface — an agent that has seen any one surface should recognise every
// other instantly. These assertions pin the key directives, not the exact
// prose, so copy can still be refined without the test becoming brittle.
describe("steering-copy", () => {
  describe("SERVER_INSTRUCTIONS", () => {
    it("states the positive action: call the tool again", () => {
      expect(SERVER_INSTRUCTIONS).toMatch(/call the tool again/i);
    });

    it("blocks the stale-transcript path", () => {
      expect(SERVER_INSTRUCTIONS).toMatch(/never re-read an earlier response/i);
    });

    it("blocks the script-parse path", () => {
      expect(SERVER_INSTRUCTIONS).toMatch(/never write scripts to parse/i);
    });

    it("frames board data as live and shared", () => {
      expect(SERVER_INSTRUCTIONS).toMatch(/live and shared/i);
    });
  });

  describe("COMPACTION_RULES (soft landing, task 5e654dd1)", () => {
    it("is part of the server instructions", () => {
      expect(SERVER_INSTRUCTIONS).toContain(COMPACTION_RULES);
    });

    it("keeps the ids, both tokens, running subagents and unwritten decisions verbatim", () => {
      expect(COMPACTION_RULES).toMatch(/word for word/i);
      expect(COMPACTION_RULES).toMatch(/card id and step id/i);
      expect(COMPACTION_RULES).toContain("ct_ claim token");
      expect(COMPACTION_RULES).toContain("wt_ work token");
      expect(COMPACTION_RULES).toMatch(/subagents still running/i);
      expect(COMPACTION_RULES).toMatch(/decisions made in chat that are not yet on the board/i);
    });

    it("re-checks the card straight after, and re-claims the same step only if the token is lost and no subagent is still working on it", () => {
      expect(COMPACTION_RULES).toMatch(/call get_task for the card before doing anything else/i);
      expect(COMPACTION_RULES).toMatch(/if the claim token was lost, call claim_next_step to re-claim the same step only when no subagent is still working on it: a re-claim issues new tokens and the running subagent's work token stops working/i);
    });

    it("stays within the budget: new text <= 900 chars, whole instructions <= 4,096", () => {
      expect(COMPACTION_RULES.length).toBeLessThanOrEqual(900);
      expect(SERVER_INSTRUCTIONS.length).toBeLessThanOrEqual(4096);
    });
  });

  describe("LIVE_DATA_SENTENCE", () => {
    it("carries the tool-always and never-re-parse clauses", () => {
      expect(LIVE_DATA_SENTENCE).toMatch(/call this tool again/i);
      expect(LIVE_DATA_SENTENCE).toMatch(/never re-read an earlier response/i);
      expect(LIVE_DATA_SENTENCE).toMatch(/script-parse/i);
    });
  });

  describe("RESPONSE_REMINDER", () => {
    it("stays within the 200-char envelope budget", () => {
      expect(RESPONSE_REMINDER.length).toBeLessThanOrEqual(200);
    });

    it("cross-references generated_at", () => {
      expect(RESPONSE_REMINDER).toContain("generated_at");
    });

    it("carries the tool-always and never-re-parse clauses", () => {
      expect(RESPONSE_REMINDER).toMatch(/call the tool again/i);
      expect(RESPONSE_REMINDER).toMatch(/never re-read/i);
      expect(RESPONSE_REMINDER).toMatch(/script-parse/i);
    });
  });
});
