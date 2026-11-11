import { describe, expect, it } from "vitest";
import { collectSetupCopy, FORBIDDEN_SETUP_COPY, setupLiveStrip, setupScreenCopy, setupTabLabel } from "./setup-copy";

// Card 63a60792: the setup screens' wording is pinned to the approved mock
// (docs/terminal-agent-setup-mock.html, sections 1 to 8).

const CODEX_CMD = "curl -fsSL https://chatgpt.com/codex/install.sh | sh";
const CLAUDE_CMD = "curl -fsSL https://claude.ai/install.sh | bash";
const TERMINAL_LEAD =
  "Open Terminal on your Mac (Applications, then Utilities, then Terminal), paste this and press Enter:";

describe("setup copy: mock 1 (Codex) and 8 (Claude Code)", () => {
  it("the start screen", () => {
    const c = setupScreenCopy("start", "codex");
    expect(c.title).toBe("Set up Codex on this Mac");
    expect(c.body).toBe(
      "Codex isn't on this Mac yet. VibeCodes can set it up for you here, in three steps. Nothing runs until you click.",
    );
    expect(c.steps).toEqual([
      {
        n: 1,
        state: "now",
        title: "Install Codex",
        detail: "Runs OpenAI's own installer. You'll see it working in this tab. It takes about a minute.",
        action: { id: "install", label: "Install Codex" },
        command: CODEX_CMD,
      },
      { n: 2, state: "later", title: "Sign in", detail: "With your ChatGPT account." },
      { n: 3, state: "later", title: "Start Codex", detail: "It connects to this board the first time." },
    ]);
    expect(c.links.map((l) => l.label)).toEqual([
      "Rather do it yourself? Copy the command",
      "How to install Codex",
      "View my other sessions",
    ]);
    const claude = setupScreenCopy("start", "claude");
    expect(claude.title).toBe("Set up Claude Code on this Mac");
    expect(claude.steps[0].detail).toBe(
      "Runs Anthropic's own installer. You'll see it working in this tab. It takes about a minute.",
    );
    expect(claude.steps[0].command).toBe(CLAUDE_CMD);
    expect(claude.steps[1].detail).toBe("With your Claude account.");
  });

  it("mock 3: installed, sign in next (Claude shows no 'use a code' link)", () => {
    const codex = setupScreenCopy("signin", "codex");
    expect(codex.title).toBe("Codex is installed");
    expect(codex.body).toBe("One more step before it can start: sign in.");
    expect(codex.steps[0]).toMatchObject({ state: "done", title: "Install Codex", detail: "Done." });
    expect(codex.steps[1]).toMatchObject({
      state: "now",
      title: "Sign in to Codex",
      detail: "Opens OpenAI's sign-in page in your browser. Sign in with your ChatGPT account, then come back here.",
      action: { id: "signin", label: "Sign in to Codex" },
    });
    expect(codex.links.map((l) => l.label)).toEqual([
      "Using VibeCodes on a different computer? Sign in with a code instead",
      "View my other sessions",
    ]);
    const claude = setupScreenCopy("signin", "claude");
    expect(claude.steps[1].detail).toBe(
      "Opens Claude's sign-in page in your browser. If it shows you a code, paste it into this tab.",
    );
    expect(claude.links.map((l) => l.id)).toEqual(["sessions"]);
  });

  it("mock 5: ready", () => {
    const c = setupScreenCopy("ready", "codex");
    expect(c.title).toBe("Codex is ready");
    expect(c.body).toBe("Codex is installed and signed in on this Mac.");
    expect(c.steps.map((s) => s.state)).toEqual(["done", "done", "now"]);
    expect(c.steps[2]).toMatchObject({
      detail: "Starts Codex in this board's project folder. The first time, it connects to your board and asks you to approve once.",
      action: { id: "start", label: "Start Codex" },
    });
  });

  it("mock 6a: the installer didn't finish", () => {
    const c = setupScreenCopy("install-failed", "codex");
    expect(c.title).toBe("Codex didn't install");
    expect(c.body).toBe(
      "OpenAI's installer stopped before it finished, so Codex still isn't on this Mac. Check your internet connection and try again, or run the command yourself.",
    );
    expect(c.buttons).toEqual([
      { id: "install", label: "Try again", tone: "primary" },
      { id: "copy-command", label: "Copy the command", tone: "outline" },
    ]);
    expect(c.links.map((l) => l.label)).toEqual(["Show what happened", "How to install Codex", "View my other sessions"]);
  });

  it("mock 6b: the sign-in didn't finish", () => {
    const c = setupScreenCopy("signin-failed", "codex");
    expect(c.title).toBe("You're not signed in to Codex yet");
    expect(c.body).toBe("The sign-in closed before it finished. Try again: it only takes a minute.");
    expect(c.buttons).toEqual([{ id: "signin", label: "Sign in to Codex", tone: "primary" }]);
    expect(c.links.map((l) => l.label)).toEqual(["Sign in with a code instead", "Show what happened", "View my other sessions"]);
    expect(setupScreenCopy("signin-failed", "claude").links.map((l) => l.id)).toEqual(["show", "sessions"]);
  });

  it("mock 7a: do it yourself", () => {
    const c = setupScreenCopy("diy", "codex");
    expect(c.title).toBe("Install Codex yourself");
    expect(c.copyBox).toEqual({
      lead: TERMINAL_LEAD,
      command: CODEX_CMD,
      after: "When it finishes, come back here and click Start again. Codex asks you to sign in the first time it starts.",
    });
    expect(c.buttons.map((b) => b.label)).toEqual(["Start again", "Back"]);
  });

  it("mock 7b: the helper is too old (Update now first, then Start again)", () => {
    const c = setupScreenCopy("old-helper", "claude");
    expect(c.title).toBe("Set up Claude Code on this Mac");
    expect(c.body).toBe(
      "Claude Code isn't on this Mac yet. To install it from here, update the VibeCodes helper first. Or install it yourself:",
    );
    expect(c.copyBox?.command).toBe(CLAUDE_CMD);
    expect(c.buttons).toEqual([
      { id: "update", label: "Update now", tone: "update" },
      { id: "start-again", label: "Start again", tone: "outline" },
    ]);
  });

  it("the live strips and the tab label", () => {
    expect(setupLiveStrip("codex", "install")).toBe("Installing Codex on this Mac…");
    expect(setupLiveStrip("claude", "install")).toBe("Installing Claude Code on this Mac…");
    expect(setupLiveStrip("codex", "signin")).toBe("Waiting for you to finish signing in…");
    expect(setupLiveStrip("codex", "signin-code")).toBe("Waiting for you to finish signing in…");
    expect(setupTabLabel("codex")).toBe("Set up Codex");
  });

  it("no error-speak or jargon anywhere on these screens", () => {
    const all = collectSetupCopy();
    expect(all.length).toBeGreaterThan(40);
    for (const s of all) {
      for (const bad of FORBIDDEN_SETUP_COPY) {
        expect(s.toLowerCase(), `"${s}" contains "${bad}"`).not.toContain(bad.toLowerCase());
      }
    }
  });
});
