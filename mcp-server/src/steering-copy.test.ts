import { describe, it, expect } from "vitest";
import { SERVER_INSTRUCTIONS, LIVE_DATA_SENTENCE, RESPONSE_REMINDER } from "./steering-copy";

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
