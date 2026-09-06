import { describe, it, expect } from "vitest";
import { AGENT_LABEL, CODEX_SETTINGS_LINE, CODEX_SIGNIN_HINT, resumeConfirmLine, agentDedupeToast } from "./agent-copy";

describe("AGENT_LABEL", () => {
  it("names both agents exactly per the copy sheet (design §10)", () => {
    expect(AGENT_LABEL.claude).toBe("Claude Code");
    expect(AGENT_LABEL.codex).toBe("Codex");
  });
});

describe("CODEX_SETTINGS_LINE / CODEX_SIGNIN_HINT", () => {
  it("are non-empty, stable strings (byte-for-byte copy sheet values)", () => {
    expect(CODEX_SETTINGS_LINE).toBe("Codex uses its own model and permission settings.");
    expect(CODEX_SIGNIN_HINT).toMatch(/ChatGPT/);
  });
});

describe("resumeConfirmLine", () => {
  const folder = "/Users/nick/projects/widgets";

  it("names Codex explicitly for a codex row", () => {
    expect(resumeConfirmLine("codex", folder)).toContain("Codex conversation");
    expect(resumeConfirmLine("codex", folder)).toContain(folder);
  });

  it("keeps the legacy agent-less wording for claude (byte-identical to before Codex existed)", () => {
    const line = resumeConfirmLine("claude", folder);
    expect(line).toBe(`Starts a new terminal that picks up the most recent conversation in ${folder}.`);
    expect(line).not.toContain("Codex");
  });
});

describe("agentDedupeToast", () => {
  it("names whichever agent the EXISTING tab runs", () => {
    expect(agentDedupeToast("codex")).toBe("This task already has a Codex terminal — switched to it.");
    expect(agentDedupeToast("claude")).toBe("This task already has a Claude Code terminal — switched to it.");
  });
});
