import { describe, it, expect } from "vitest";
import { findBlankEnvVars, REQUIRED_ENV_VARS } from "./env-guard";

describe("findBlankEnvVars", () => {
  it("flags a var that is present but empty (the Vercel sensitive-var footgun)", () => {
    expect(findBlankEnvVars({ ANTHROPIC_MODEL: "" })).toEqual(["ANTHROPIC_MODEL"]);
  });

  it("flags a var that is whitespace-only", () => {
    expect(findBlankEnvVars({ ANTHROPIC_API_KEY: "   " })).toEqual([
      "ANTHROPIC_API_KEY",
    ]);
  });

  it("does NOT flag a var that is simply unset (absence can be intentional)", () => {
    expect(findBlankEnvVars({})).toEqual([]);
  });

  it("does NOT flag a var with a real value", () => {
    expect(findBlankEnvVars({ ANTHROPIC_MODEL: "claude-sonnet-5" })).toEqual([]);
  });

  it("reports every blank var, in declaration order", () => {
    const env = {
      ANTHROPIC_MODEL: "",
      API_KEY_ENCRYPTION_KEY: " ",
      SUPABASE_SERVICE_ROLE_KEY: "real-value",
    };
    expect(findBlankEnvVars(env)).toEqual([
      "API_KEY_ENCRYPTION_KEY",
      "ANTHROPIC_MODEL",
    ]);
  });

  it("accepts a custom name list", () => {
    expect(findBlankEnvVars({ CUSTOM: "" }, ["CUSTOM"])).toEqual(["CUSTOM"]);
  });

  it("covers the vars that actually matter", () => {
    expect(REQUIRED_ENV_VARS).toContain("ANTHROPIC_MODEL");
    expect(REQUIRED_ENV_VARS).toContain("API_KEY_ENCRYPTION_KEY");
    expect(REQUIRED_ENV_VARS).toContain("SUPABASE_SERVICE_ROLE_KEY");
  });
});
