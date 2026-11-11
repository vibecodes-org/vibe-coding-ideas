import { describe, expect, it } from "vitest";
import {
  AGENT_DISPLAY_NAMES,
  AGENT_INSTALL_COMMANDS,
  AGENT_INSTALL_GUIDE_URLS,
  setupSessionDisplayName,
} from "./agent-install";
// The bridge keeps its own copy of the table (a different build graph). Importing
// it here pins the two together: if either side changes alone, this fails.
import {
  AGENT_DISPLAY_NAMES as BRIDGE_NAMES,
  AGENT_INSTALL_COMMANDS as BRIDGE_COMMANDS,
  AGENT_INSTALL_GUIDE_URLS as BRIDGE_GUIDES,
} from "../../../terminal/bridge/src/agent-setup.js";
import { AGENT_INSTALL_GUIDE_URLS as BANNER_GUIDES } from "../../../terminal/bridge/src/agent-copy.js";

describe("agent install table", () => {
  it("matches the bridge's table exactly (drift test)", () => {
    expect(AGENT_INSTALL_COMMANDS).toEqual(BRIDGE_COMMANDS);
    expect(AGENT_INSTALL_GUIDE_URLS).toEqual(BRIDGE_GUIDES);
    expect(AGENT_DISPLAY_NAMES).toEqual(BRIDGE_NAMES);
    // the bridge's own "isn't installed" line reads the same addresses
    expect(BANNER_GUIDES).toEqual(AGENT_INSTALL_GUIDE_URLS);
  });

  it("names each maker's current install page, not an old redirecting address", () => {
    expect(AGENT_INSTALL_GUIDE_URLS.claude).toBe("https://code.claude.com/docs/en/setup");
    expect(AGENT_INSTALL_GUIDE_URLS.codex).toBe("https://learn.chatgpt.com/docs/codex/cli");
    for (const url of Object.values(AGENT_INSTALL_GUIDE_URLS)) {
      expect(url).not.toContain("docs.claude.com");
      expect(url).not.toContain("developers.openai.com");
    }
  });

  it("each install line is a one-line download piped into a shell", () => {
    expect(AGENT_INSTALL_COMMANDS.claude).toBe("curl -fsSL https://claude.ai/install.sh | bash");
    expect(AGENT_INSTALL_COMMANDS.codex).toBe("curl -fsSL https://chatgpt.com/codex/install.sh | sh");
  });

  it("names the setup session in plain words", () => {
    expect(setupSessionDisplayName("codex")).toBe("Set up Codex");
    expect(setupSessionDisplayName("claude")).toBe("Set up Claude Code");
  });
});
