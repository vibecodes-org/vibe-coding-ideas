// Unit tests for the "agent not installed" banner copy.
// Run: cd terminal/bridge && node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { agentNotInstalledBanner, AGENT_INSTALL_GUIDE_URLS } from "./agent-copy.js";

test("codex banner names Codex and includes its install guide URL", () => {
  const banner = agentNotInstalledBanner("codex");
  assert.match(banner, /Codex isn't installed on this Mac/);
  assert.ok(banner.includes(AGENT_INSTALL_GUIDE_URLS.codex));
  assert.ok(!banner.toLowerCase().includes("command not found"));
});

test("claude banner names Claude Code and includes its install guide URL", () => {
  const banner = agentNotInstalledBanner("claude");
  assert.match(banner, /Claude Code isn't installed on this Mac/);
  assert.ok(banner.includes(AGENT_INSTALL_GUIDE_URLS.claude));
});

test("banner ends with a CRLF pair (terminal-safe line ending) and resets colour", () => {
  const banner = agentNotInstalledBanner("codex");
  assert.ok(banner.endsWith("\r\n\r\n"));
  assert.ok(banner.includes("\x1b[0m"));
});

test("an unknown agent still produces a calm sentence, not a crash", () => {
  // @ts-expect-error - deliberately passing something outside the union
  const banner = agentNotInstalledBanner("something-else");
  assert.match(banner, /something-else isn't installed on this Mac/);
});
