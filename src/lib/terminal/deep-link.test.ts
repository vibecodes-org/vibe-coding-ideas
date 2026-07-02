import { describe, it, expect } from "vitest";
import {
  buildLaunchDeepLink,
  redactDeepLinkToken,
  LAUNCH_SCHEME,
  LAUNCH_HOST,
  MAX_LAUNCH_URL_LENGTH,
} from "./deep-link";
// The bridge/helper PARSES with the shared .mjs. Importing it here pins the two
// implementations together: a link this (TS) module builds MUST parse back to the
// same fields with the shared parser, or this test fails — catching any drift.
import { parseLaunchDeepLink } from "../../../terminal/shared/deep-link.mjs";
import {
  buildCompactBootstrapPromptParts,
  enforcePromptLength,
} from "../launch-claude-code";

const SAMPLE = {
  relay: "ws://127.0.0.1:8787",
  session: "11111111-2222-3333-4444-555555555555",
  // A realistic two-part HMAC token with reserved-ish chars to prove encoding.
  token: "eyJzdWIiOiJ1c2VyIn0.aBcD-_eFgH+/=signaturebytes",
  cwd: "/Users/nick/projects/my idea",
};

describe("buildLaunchDeepLink", () => {
  it("builds a vibecodes://launch URL with encoded params", () => {
    const url = buildLaunchDeepLink(SAMPLE);
    expect(url.startsWith(`${LAUNCH_SCHEME}://${LAUNCH_HOST}?`)).toBe(true);
    // Reserved characters in relay/token/cwd are percent-encoded, never raw.
    expect(url).toContain(`relay=${encodeURIComponent(SAMPLE.relay)}`);
    expect(url).toContain(`token=${encodeURIComponent(SAMPLE.token)}`);
    expect(url).toContain(`cwd=${encodeURIComponent(SAMPLE.cwd)}`);
    expect(url).not.toContain(" "); // the space in cwd must be encoded
  });

  it("omits cwd entirely when absent", () => {
    const url = buildLaunchDeepLink({ relay: SAMPLE.relay, session: SAMPLE.session, token: SAMPLE.token });
    expect(url).not.toContain("cwd=");
  });

  it("throws when a required field is missing", () => {
    expect(() => buildLaunchDeepLink({ relay: "", session: "s", token: "t" })).toThrow();
    expect(() => buildLaunchDeepLink({ relay: "r", session: "", token: "t" })).toThrow();
    expect(() => buildLaunchDeepLink({ relay: "r", session: "s", token: "" })).toThrow();
  });

  it("round-trips through the shared parser the helper uses (build ⇄ parse)", () => {
    const url = buildLaunchDeepLink(SAMPLE);
    const parsed = parseLaunchDeepLink(url);
    expect(parsed).toEqual(SAMPLE);
  });

  it("round-trips without cwd", () => {
    const noCwd = { relay: SAMPLE.relay, session: SAMPLE.session, token: SAMPLE.token };
    const parsed = parseLaunchDeepLink(buildLaunchDeepLink(noCwd));
    expect(parsed).toEqual(noCwd);
  });
});

describe("redactDeepLinkToken", () => {
  it("replaces the token value with *** and never leaks the secret", () => {
    const url = buildLaunchDeepLink(SAMPLE);
    const redacted = redactDeepLinkToken(url);
    expect(redacted).toContain("token=***");
    // The raw token (and its url-encoded form) must NOT appear anywhere in the log line.
    expect(redacted).not.toContain(SAMPLE.token);
    expect(redacted).not.toContain(encodeURIComponent(SAMPLE.token));
    // Non-secret params survive for debugging.
    expect(redacted).toContain(`session=${SAMPLE.session}`);
  });
});

// ── bootstrap-prompt transport (docs/terminal-bootstrap-prompt-ux.html) ────────

// A hostile prompt: shell metacharacters, quotes, expansion, newlines. It must
// ride the URL as INERT data and round-trip verbatim (argv safety is proven on
// the bridge side; this pins the transport layer).
const HOSTILE_PROMPT =
  "Set up $(rm -rf ~) `hostname` \"double\" 'single' ; & | > < \\ %20 + \n second line $HOME";

describe("buildLaunchDeepLink with a prompt", () => {
  it("appends prompt as the LAST param, url-encoded", () => {
    const url = buildLaunchDeepLink({ ...SAMPLE, prompt: "hello world" });
    expect(url.endsWith(`prompt=${encodeURIComponent("hello world")}`)).toBe(true);
    expect(url).not.toContain("hello world"); // the space must be encoded
  });

  it("omits prompt entirely when absent — promptless links keep today's exact shape (AC8)", () => {
    const url = buildLaunchDeepLink(SAMPLE);
    expect(url).not.toContain("prompt=");
    expect(parseLaunchDeepLink(url)).toEqual(SAMPLE);
  });

  it("round-trips the prompt through the shared parser the helper/bridge use (AC7 drift guard)", () => {
    const withPrompt = { ...SAMPLE, prompt: "Set up VibeCodes and work a board task." };
    expect(parseLaunchDeepLink(buildLaunchDeepLink(withPrompt))).toEqual(withPrompt);
  });

  it("round-trips a hostile-characters prompt verbatim (AC5 transport leg)", () => {
    const withPrompt = { ...SAMPLE, prompt: HOSTILE_PROMPT };
    const parsed = parseLaunchDeepLink(buildLaunchDeepLink(withPrompt));
    expect(parsed?.prompt).toBe(HOSTILE_PROMPT);
  });

  it("redacts the prompt (user content) as well as the token (AC9)", () => {
    const url = buildLaunchDeepLink({ ...SAMPLE, prompt: HOSTILE_PROMPT });
    const redacted = redactDeepLinkToken(url);
    expect(redacted).toContain("token=***");
    expect(redacted).toContain("prompt=***");
    expect(redacted).not.toContain(SAMPLE.token);
    expect(redacted).not.toContain(encodeURIComponent(SAMPLE.token));
    expect(redacted).not.toContain(encodeURIComponent(HOSTILE_PROMPT));
    expect(redacted).toContain(`session=${SAMPLE.session}`);
  });
});

describe("vibecodes:// URL budget (AC6)", () => {
  // Realistic overhead: a production relay host, a UUID session, and a token the
  // size the app actually mints (b64url payload {sub,sid,idea,role,iat,exp} ≈ 240
  // chars + "." + 43-char HMAC signature).
  const RELAY = "wss://terminal-relay.vibecodes.workers.dev";
  const SESSION = "11111111-2222-3333-4444-555555555555";
  const TOKEN = "p".repeat(240) + "." + "s".repeat(43);
  const APP_URL = "https://vibecodes.co.uk";
  const IDEA_ID = "1beea99a-0377-421b-9a8b-a9956ae34b5d";

  /** The dock's exact budgeting recipe (terminal-dock.tsx → fireLaunchDeepLink). */
  function buildBudgetedLink(head: string, tail: string): { url: string; prompt: string } {
    const base = buildLaunchDeepLink({ relay: RELAY, session: SESSION, token: TOKEN });
    const budget = MAX_LAUNCH_URL_LENGTH - base.length - "&prompt=".length;
    const prompt = enforcePromptLength(head, tail, budget);
    return { url: buildLaunchDeepLink({ relay: RELAY, session: SESSION, token: TOKEN, prompt }), prompt };
  }

  it("realistic fixtures fit untruncated — full parity — and the URL stays ≤ 2048", () => {
    const fixtures = [
      { name: "board-level", args: { appUrl: APP_URL, ideaId: IDEA_ID, ideaTitle: "My First App", mode: "existing" as const, repoUrl: null } },
      { name: "task-selected", args: { appUrl: APP_URL, ideaId: IDEA_ID, ideaTitle: "My First App", mode: "new" as const, repoUrl: null, newProject: { newProjectPath: "~/projects/my-first-app" }, taskId: "7c1c1c1c-2222-3333-4444-555555555555" } },
      { name: "repo-backed", args: { appUrl: APP_URL, ideaId: IDEA_ID, ideaTitle: "Horse Racing Predictor", mode: "existing" as const, repoUrl: "https://github.com/acme/horse-racing-predictor" } },
      { name: "new-project", args: { appUrl: APP_URL, ideaId: IDEA_ID, ideaTitle: "Horse Racing Predictor", mode: "new" as const, repoUrl: null, newProject: { newProjectPath: "~/projects/horse-racing-predictor" } } },
    ];
    for (const { name, args } of fixtures) {
      const { head, tail } = buildCompactBootstrapPromptParts(args);
      const { url, prompt } = buildBudgetedLink(head, tail);
      expect(url.length, `fixture ${name}`).toBeLessThanOrEqual(MAX_LAUNCH_URL_LENGTH);
      expect(prompt, `fixture ${name} must not truncate`).toBe(head + tail);
      expect(parseLaunchDeepLink(url)?.prompt, `fixture ${name} parses back`).toBe(head + tail);
    }
  });

  it("overflow truncates deterministically: MCP head survives, marker appended, URL ≤ 2048", () => {
    const { head, tail } = buildCompactBootstrapPromptParts({
      appUrl: APP_URL,
      ideaId: IDEA_ID,
      // An absurd title inflates only the header line inside the head; pad the
      // TAIL via the task work step by an absurd task id to force overflow.
      ideaTitle: "An extremely long idea title that goes on and on and eventually forces the URL over its ceiling",
      mode: "new",
      repoUrl: null,
      newProject: { newProjectPath: "~/projects/a-very-long-project-folder-name-here" },
      taskId: "t".repeat(1200),
    });
    const { url, prompt } = buildBudgetedLink(head, tail);
    expect(url.length).toBeLessThanOrEqual(MAX_LAUNCH_URL_LENGTH);
    expect(prompt.startsWith(head)).toBe(true); // dir + MCP + record steps intact
    expect(prompt).toContain("claude mcp add");
    expect(prompt).toContain("…(truncated)");
  });

  it("a launch with a pinned cwd carries it, budgets around it, and it parses back (folder parity)", () => {
    // A pinned existing-mode folder (the user-felt case: the button resolves it
    // via resolveLaunchCwd and rides it on the bus payload → the dock puts it on
    // the link). Existing-no-repo compact prompts omit the directory step on the
    // assumption the cwd param carries — so the cwd MUST survive to the bridge.
    const cwd = "/Users/nickball/projects/horse racing predictor";
    const { head, tail } = buildCompactBootstrapPromptParts({
      appUrl: APP_URL,
      ideaId: IDEA_ID,
      ideaTitle: "Horse Racing Predictor",
      mode: "existing",
      repoUrl: null,
    });
    // The dock's exact recipe, cwd included in the BASE so the budget accounts for it.
    const base = buildLaunchDeepLink({ relay: RELAY, session: SESSION, token: TOKEN, cwd });
    const budget = MAX_LAUNCH_URL_LENGTH - base.length - "&prompt=".length;
    const prompt = enforcePromptLength(head, tail, budget);
    const url = buildLaunchDeepLink({ relay: RELAY, session: SESSION, token: TOKEN, cwd, prompt });

    expect(url.length).toBeLessThanOrEqual(MAX_LAUNCH_URL_LENGTH);
    const parsed = parseLaunchDeepLink(url);
    expect(parsed?.cwd).toBe(cwd);
    expect(parsed?.prompt).toBe(head + tail); // realistic fixture: untruncated

    // Log hygiene (the dock's log recipe): token+prompt elided by the shared
    // redactor, the cwd (a local filesystem path) stripped on top.
    const logged = redactDeepLinkToken(url).replace(/([?&]cwd=)[^&]*/g, "$1***");
    expect(logged).toContain("cwd=***");
    expect(logged).not.toContain(encodeURIComponent(cwd));
    expect(logged).toContain(`session=${SESSION}`);
  });
});
