// Unit tests for the in-app setup module (card 63a60792).
// Run: cd terminal/bridge && node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  setupCommand,
  setupIntroLines,
  checkSignedIn,
  setupEndReason,
  AGENT_INSTALL_COMMANDS,
  AGENT_INSTALL_GUIDE_URLS,
  SETUP_ACTION_NAMES,
} from "./agent-setup.js";

test("install commands are the fixed strings, run through the shell the line pipes into", () => {
  assert.deepEqual(setupCommand("claude", "install"), {
    file: "/bin/bash",
    args: ["-c", "curl -fsSL https://claude.ai/install.sh | bash"],
  });
  assert.deepEqual(setupCommand("codex", "install"), {
    file: "/bin/sh",
    args: ["-c", "curl -fsSL https://chatgpt.com/codex/install.sh | sh"],
  });
  assert.equal(AGENT_INSTALL_COMMANDS.claude, "curl -fsSL https://claude.ai/install.sh | bash");
});

test("sign-in commands use the resolved binary and nothing else", () => {
  assert.deepEqual(setupCommand("claude", "signin", "/u/.local/bin/claude"), {
    file: "/u/.local/bin/claude",
    args: ["auth", "login"],
  });
  assert.deepEqual(setupCommand("codex", "signin", "/u/.local/bin/codex"), {
    file: "/u/.local/bin/codex",
    args: ["login"],
  });
  assert.deepEqual(setupCommand("codex", "signin-code", "/u/.local/bin/codex"), {
    file: "/u/.local/bin/codex",
    args: ["login", "--device-auth"],
  });
});

test("refuses everything outside the table", () => {
  assert.equal(setupCommand("claude", "signin-code", "/x/claude"), null);
  assert.equal(setupCommand("codex", "signin", null), null);
  assert.equal(setupCommand("codex", "signin", ""), null);
  assert.equal(setupCommand("bash", "install"), null);
  assert.equal(setupCommand("codex", "rm -rf ~"), null);
  assert.equal(setupCommand("codex", "uninstall", "/x/codex"), null);
});

test("the action names are exactly the three the link may carry", () => {
  assert.deepEqual([...SETUP_ACTION_NAMES], ["install", "signin", "signin-code"]);
});

test("install page addresses are the current ones", () => {
  assert.equal(AGENT_INSTALL_GUIDE_URLS.claude, "https://code.claude.com/docs/en/setup");
  assert.equal(AGENT_INSTALL_GUIDE_URLS.codex, "https://learn.chatgpt.com/docs/codex/cli");
});

test("intro lines are plain English and end with a blank line", () => {
  const install = setupIntroLines("codex", "install");
  assert.match(install, /Installing Codex with OpenAI's installer\./);
  assert.ok(install.includes(AGENT_INSTALL_COMMANDS.codex));
  assert.ok(install.endsWith("\r\n\r\n"));
  assert.match(setupIntroLines("claude", "install"), /Installing Claude Code with Anthropic's installer\./);
  assert.match(setupIntroLines("claude", "signin"), /Signing in to Claude Code\. Finish on the page that just opened in your browser\./);
  assert.match(setupIntroLines("codex", "signin-code"), /Signing in to Codex\./);
});

const run = (result) => () => result;

test("claude status: loggedIn true / false / unreadable", () => {
  const env = { PATH: "/bin" };
  const ok = (stdout) => checkSignedIn("claude", { binary: "/x/claude", env, run: run({ status: 0, stdout }) });
  assert.equal(ok('{"loggedIn": true, "authMethod": "claude.ai"}'), true);
  assert.equal(ok('{"loggedIn": false}'), false);
  assert.equal(ok("not json"), null);
  assert.equal(ok("{}"), null);
  assert.equal(ok('{"loggedIn": "yes"}'), null);
});

test("claude status asks with the fixed arguments", () => {
  let seen;
  checkSignedIn("claude", { binary: "/x/claude", run: (f, a, o) => { seen = [f, a, o.timeoutMs]; return { status: 0, stdout: "{}" }; } });
  assert.deepEqual(seen, ["/x/claude", ["auth", "status", "--json"], 10000]);
});

test("codex status: exit 0 signed in, exit 1 not, anything else unknown", () => {
  const st = (status, extra = {}) => checkSignedIn("codex", { binary: "/x/codex", run: run({ status, ...extra }) });
  assert.equal(st(0), true);
  assert.equal(st(1), false);
  assert.equal(st(2), null);
  assert.equal(st(null), null);
  assert.equal(st(0, { timedOut: true }), null);
  assert.equal(st(1, { error: new Error("spawn") }), null);
});

test("a throwing runner or a missing binary is unknown, never a crash", () => {
  assert.equal(checkSignedIn("codex", { binary: "/x/codex", run: () => { throw new Error("boom"); } }), null);
  assert.equal(checkSignedIn("codex", { binary: "", run: run({ status: 0 }) }), null);
});

test("end reasons for install", () => {
  assert.equal(setupEndReason({ action: "install", found: false, signedIn: null, exitCode: 6 }), "setup-install-failed:6");
  assert.equal(setupEndReason({ action: "install", found: true, signedIn: false, exitCode: 0 }), "setup-installed");
  assert.equal(setupEndReason({ action: "install", found: true, signedIn: null, exitCode: 0 }), "setup-installed");
  assert.equal(setupEndReason({ action: "install", found: true, signedIn: true, exitCode: 0 }), "setup-signed-in");
});

test("end reasons for sign-in: unknown moves on, a clear 'no' fails", () => {
  assert.equal(setupEndReason({ action: "signin", found: true, signedIn: true, exitCode: 0 }), "setup-signed-in");
  assert.equal(setupEndReason({ action: "signin", found: true, signedIn: null, exitCode: 0 }), "setup-signed-in");
  assert.equal(setupEndReason({ action: "signin-code", found: true, signedIn: false, exitCode: 1 }), "setup-signin-failed:1");
});

test("end reasons always fit the relay's reason pattern, even with a bad exit code", () => {
  const re = /^[A-Za-z0-9:._-]{1,120}$/;
  for (const code of [undefined, null, -1, 999, 1.5, NaN]) {
    assert.match(setupEndReason({ action: "install", found: false, signedIn: null, exitCode: code }), re);
    assert.match(setupEndReason({ action: "signin", found: true, signedIn: false, exitCode: code }), re);
  }
});

test("outro lines only on success", async () => {
  const { setupOutroLines } = await import("./agent-setup.js");
  assert.match(setupOutroLines("codex", "setup-installed"), /Codex is installed\./);
  assert.match(setupOutroLines("claude", "setup-signed-in"), /Signed in to Claude Code\./);
  assert.equal(setupOutroLines("codex", "setup-install-failed:6"), "");
  assert.equal(setupOutroLines("codex", "setup-signin-failed:1"), "");
});
