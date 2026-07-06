// Locks the middleware matcher's exclusion list. The edge-middleware -> nodejs
// response bridge intermittently loses route responses after an instance
// recycles (card b6e5c728 — three production outages on /api/terminal/session:
// Jul 1, Jul 3, Jul 6 2026). Routes that do their own auth are excluded from
// the matcher entirely; this test makes sure nobody re-includes them, and that
// genuinely middleware-dependent routes stay matched.
import { describe, it, expect } from "vitest";
import { config } from "./middleware";

// Next.js compiles matcher strings with path-to-regexp. Our single matcher is
// `/` followed by one unnamed regex group (`/(...)`), which path-to-regexp
// compiles to an anchored regex around that group. Simplification vs Next's
// real compiler: we skip trailing-slash normalization and query/hash handling
// — irrelevant for the plain pathnames asserted below.
function compileMatcher(matcher: string): RegExp {
  return new RegExp(`^${matcher}$`);
}

const matcherRegex = compileMatcher(config.matcher[0]);
const matches = (pathname: string) => matcherRegex.test(pathname);

describe("middleware matcher", () => {
  it("has a single matcher entry", () => {
    expect(config.matcher).toHaveLength(1);
  });

  describe("excluded paths (middleware must NOT run)", () => {
    it("does not match /api/terminal/session (the b6e5c728 fix)", () => {
      expect(matches("/api/terminal/session")).toBe(false);
    });

    it("does not match api/mcp routes", () => {
      expect(matches("/api/mcp/anything")).toBe(false);
    });

    it("does not match api/oauth routes", () => {
      expect(matches("/api/oauth/token")).toBe(false);
    });

    it("does not match /callback", () => {
      expect(matches("/callback")).toBe(false);
    });

    it("does not match /monitoring", () => {
      expect(matches("/monitoring")).toBe(false);
    });

    it("does not match ingest (PostHog reverse proxy)", () => {
      expect(matches("/ingest/x")).toBe(false);
    });
  });

  describe("matched paths (middleware MUST run)", () => {
    it("matches /dashboard", () => {
      expect(matches("/dashboard")).toBe(true);
    });

    it("matches idea board pages", () => {
      expect(matches("/ideas/abc/board")).toBe(true);
    });

    it("matches /members", () => {
      expect(matches("/members")).toBe(true);
    });

    it("matches non-excluded API routes (deliberate: only self-authing APIs are excluded)", () => {
      expect(matches("/api/ai/generate")).toBe(true);
    });
  });
});
