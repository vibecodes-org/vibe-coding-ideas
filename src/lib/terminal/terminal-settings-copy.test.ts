import { describe, it, expect } from "vitest";
import {
  claudeModelHelp,
  codexModelHelp,
  codexEffortHelp,
  codexEffortDefaultSubLabel,
  siteModelOptionLabel,
  codexPrefillEffort,
} from "./terminal-settings-copy";

const T = "Change it any time by typing /model in the terminal.";

describe("claudeModelHelp", () => {
  it("your choice", () => {
    expect(claudeModelHelp({ userValue: "sonnet", platformValue: "opus" })).toBe(
      `New Claude Code sessions start on Sonnet (your setting). Resumed sessions keep their model. ${T}`
    );
  });
  it("default with a site model", () => {
    expect(claudeModelHelp({ userValue: null, platformValue: "opus" })).toBe(
      `Uses the site default: new Claude Code sessions start on Opus. Resumed sessions keep their model. ${T}`
    );
  });
  it("default with no site model, and My machine's default", () => {
    const want = `Your machine decides which model new Claude Code sessions start on. Resumed sessions keep their model. ${T}`;
    expect(claudeModelHelp({ userValue: null, platformValue: null })).toBe(want);
    expect(claudeModelHelp({ userValue: "__machine_default__", platformValue: "opus" })).toBe(want);
  });
});

describe("codex help lines", () => {
  const pair = { model: "gpt-5.6-terra", effort: "medium" };
  it("model: user / platform / fallback / machine / loading / none", () => {
    expect(codexModelHelp({ pair, source: "user" })).toBe(
      `New Codex sessions start on gpt-5.6-terra (your setting). Resumed sessions keep their model. ${T}`
    );
    expect(codexModelHelp({ pair, source: "platform" })).toBe(
      `Uses the site default: new Codex sessions start on gpt-5.6-terra. Resumed sessions keep their model. ${T}`
    );
    expect(codexModelHelp({ pair, source: "fallback" })).toBe(
      "Uses the Standard tier: new Codex sessions start on gpt-5.6-terra. Resumed sessions keep their model."
    );
    expect(codexModelHelp({ pair: undefined, source: "machine" })).toBe(
      "Your machine decides the Codex model and effort. Resumed sessions keep their model."
    );
    expect(codexModelHelp(null)).toBe("Checking the Codex terminal default…");
    expect(codexModelHelp({ pair: undefined, source: "fallback" })).toBe("No valid Codex terminal default is available.");
  });
  it("effort: user / platform / fallback / machine", () => {
    expect(codexEffortHelp({ pair, source: "user" })).toBe(
      "New Codex sessions start at Medium (your setting). Resumed sessions keep theirs. Codex saves the model and effort together."
    );
    expect(codexEffortHelp({ pair, source: "platform" })).toBe(
      "Uses the site default: new Codex sessions start at Medium, with the site's model. Pick a model above to choose your own effort."
    );
    expect(codexEffortHelp({ pair, source: "fallback" })).toBe(
      "Uses the Standard tier: new Codex sessions start at Medium, with the Standard tier's model. Pick a model above to choose your own effort."
    );
    expect(codexEffortHelp({ pair: undefined, source: "machine" })).toBe("Your machine decides the Codex model and effort.");
  });
});

describe("labels", () => {
  it("codex effort Default sub-label", () => {
    expect(codexEffortDefaultSubLabel(undefined)).toBeNull();
    expect(codexEffortDefaultSubLabel({ model: "m", effort: "xhigh" })).toBe("site: X-High");
    expect(codexEffortDefaultSubLabel(null)).toBe("Standard tier");
    expect(codexEffortDefaultSubLabel({ model: "m", effort: "low" }, true)).toBe("your machine");
  });
  it("site model option label", () => {
    expect(siteModelOptionLabel("Opus", "your machine decides")).toBe("Default (site: Opus)");
    expect(siteModelOptionLabel(null, "your machine decides")).toBe("Default (your machine decides)");
  });
});

describe("codexPrefillEffort", () => {
  const ok = (e: string) => ["low", "medium", "high"].includes(e);
  it("uses the site pair, else the Standard tier's, else medium", () => {
    expect(codexPrefillEffort({ model: "a", effort: "high" }, { model: "b", effort: "low" }, ok)).toBe("high");
    expect(codexPrefillEffort(null, { model: "b", effort: "low" }, ok)).toBe("low");
    expect(codexPrefillEffort({ model: "a", effort: "bogus" }, { model: "b", effort: "bogus" }, ok)).toBe("medium");
    expect(codexPrefillEffort(undefined, undefined, ok)).toBe("medium");
  });
});
