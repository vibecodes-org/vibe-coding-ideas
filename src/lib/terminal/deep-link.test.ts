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

describe("buildLaunchDeepLink with a helperToken (card cc74a067)", () => {
  it("includes helperToken, positioned before prompt, and round-trips", () => {
    const withHelper = { ...SAMPLE, helperToken: "eyJzdWIiOiJ1c2VyIn0.helperSig", prompt: "hello" };
    const url = buildLaunchDeepLink(withHelper);
    expect(url).toContain(`helperToken=${encodeURIComponent(withHelper.helperToken)}`);
    expect(url.indexOf("helperToken=")).toBeLessThan(url.indexOf("prompt="));
    expect(parseLaunchDeepLink(url)).toEqual(withHelper);
  });

  it("omits helperToken entirely when absent", () => {
    const url = buildLaunchDeepLink(SAMPLE);
    expect(url).not.toContain("helperToken=");
    expect(parseLaunchDeepLink(url)).toEqual(SAMPLE);
  });

  it("is redacted by redactDeepLinkToken like the bridge token", () => {
    const withHelper = { ...SAMPLE, helperToken: "super-secret-helper-token" };
    const redacted = redactDeepLinkToken(buildLaunchDeepLink(withHelper));
    expect(redacted).toContain("helperToken=***");
    expect(redacted).not.toContain("super-secret-helper-token");
  });
});

describe("buildLaunchDeepLink with resume (card cbe60db5)", () => {
  it("includes resume=1, positioned before prompt, and round-trips", () => {
    const withResume = { ...SAMPLE, resume: true };
    const url = buildLaunchDeepLink(withResume);
    expect(url).toContain("resume=1");
    expect(parseLaunchDeepLink(url)).toEqual(withResume);
  });

  it("omits resume entirely when false/absent — no version-skew risk for an old bridge", () => {
    const url = buildLaunchDeepLink(SAMPLE);
    expect(url).not.toContain("resume=");
    const falseUrl = buildLaunchDeepLink({ ...SAMPLE, resume: false });
    expect(falseUrl).not.toContain("resume=");
  });

  it("resume rides before prompt, mirroring helperToken's position", () => {
    const url = buildLaunchDeepLink({ ...SAMPLE, resume: true, prompt: "ignored on a real resume link" });
    expect(url.indexOf("resume=")).toBeLessThan(url.indexOf("prompt="));
  });
});

describe("buildLaunchDeepLink with resumeId (rework 5, exact-conversation resume)", () => {
  const RESUME_ID = "99999999-8888-7777-6666-555555555555";

  it("includes resume_id, positioned before prompt, and round-trips", () => {
    const withResumeId = { ...SAMPLE, resumeId: RESUME_ID };
    const url = buildLaunchDeepLink(withResumeId);
    expect(url).toContain(`resume_id=${RESUME_ID}`);
    expect(parseLaunchDeepLink(url)).toEqual(withResumeId);
  });

  it("omits resume_id entirely when absent — no version-skew risk for an old bridge", () => {
    const url = buildLaunchDeepLink(SAMPLE);
    expect(url).not.toContain("resume_id=");
  });

  it("resume_id rides before prompt, mirroring resume's position", () => {
    const url = buildLaunchDeepLink({ ...SAMPLE, resumeId: RESUME_ID, prompt: "ignored on a real resume link" });
    expect(url.indexOf("resume_id=")).toBeLessThan(url.indexOf("prompt="));
  });

  it("wins over the legacy resume flag when both are somehow set — only resume_id is fired", () => {
    const url = buildLaunchDeepLink({ ...SAMPLE, resume: true, resumeId: RESUME_ID });
    expect(url).toContain(`resume_id=${RESUME_ID}`);
    expect(url).not.toContain("resume=1");
    const parsed = parseLaunchDeepLink(url);
    expect(parsed?.resumeId).toBe(RESUME_ID);
    expect(parsed).not.toHaveProperty("resume");
  });

  it("a malformed resume_id on the wire is rejected by the shared parser, never forwarded", () => {
    const url = `${LAUNCH_SCHEME}://${LAUNCH_HOST}?relay=${encodeURIComponent(SAMPLE.relay)}&session=${SAMPLE.session}&token=${encodeURIComponent(SAMPLE.token)}&resume_id=not-a-uuid`;
    const parsed = parseLaunchDeepLink(url);
    expect(parsed).not.toBeNull();
    expect(parsed).not.toHaveProperty("resumeId");
  });
});

describe("buildLaunchDeepLink with cols/rows (Bug B, card cbe60db5 — real PTY spawn size)", () => {
  it("includes cols/rows, positioned before prompt, and round-trips", () => {
    const withDims = { ...SAMPLE, cols: 137, rows: 42, prompt: "hello" };
    const url = buildLaunchDeepLink(withDims);
    expect(url).toContain("cols=137");
    expect(url).toContain("rows=42");
    expect(url.indexOf("cols=")).toBeLessThan(url.indexOf("prompt="));
    expect(parseLaunchDeepLink(url)).toEqual(withDims);
  });

  it("omits cols/rows entirely when absent — no version-skew risk for an old bridge", () => {
    const url = buildLaunchDeepLink(SAMPLE);
    expect(url).not.toContain("cols=");
    expect(url).not.toContain("rows=");
    expect(parseLaunchDeepLink(url)).toEqual(SAMPLE);
  });

  it("drops a lone dimension rather than firing a half pair", () => {
    const url = buildLaunchDeepLink({ ...SAMPLE, cols: 120 }); // rows omitted
    expect(url).not.toContain("cols=");
    expect(url).not.toContain("rows=");
  });

  it("a non-sane dimension on the wire is rejected by the shared parser, never forwarded", () => {
    const url = `${LAUNCH_SCHEME}://${LAUNCH_HOST}?relay=${encodeURIComponent(SAMPLE.relay)}&session=${SAMPLE.session}&token=${encodeURIComponent(SAMPLE.token)}&cols=0&rows=24`;
    const parsed = parseLaunchDeepLink(url);
    expect(parsed).not.toBeNull();
    expect(parsed).not.toHaveProperty("cols");
    expect(parsed).not.toHaveProperty("rows");
  });
});

describe("buildLaunchDeepLink with model (task c4ca2d95, terminal starting model)", () => {
  it("includes model, positioned before prompt, and round-trips", () => {
    const withModel = { ...SAMPLE, model: "opus", prompt: "hello" };
    const url = buildLaunchDeepLink(withModel);
    expect(url).toContain("model=opus");
    expect(url.indexOf("model=")).toBeLessThan(url.indexOf("prompt="));
    expect(parseLaunchDeepLink(url)).toEqual(withModel);
  });

  it("omits model entirely when absent — no version-skew risk for an old bridge/helper (AC-13)", () => {
    const url = buildLaunchDeepLink(SAMPLE);
    expect(url).not.toContain("model=");
    expect(parseLaunchDeepLink(url)).toEqual(SAMPLE);
  });

  it("model rides before prompt, mirroring cols/resume's position", () => {
    const url = buildLaunchDeepLink({ ...SAMPLE, model: "sonnet", prompt: "ignored ordering check" });
    expect(url.indexOf("model=")).toBeLessThan(url.indexOf("prompt="));
  });

  it("carries a custom (non-alias) model id verbatim, URL-encoded", () => {
    const withModel = { ...SAMPLE, model: "claude-opus-5-20260101" };
    const url = buildLaunchDeepLink(withModel);
    expect(parseLaunchDeepLink(url)?.model).toBe("claude-opus-5-20260101");
  });

  it("a malformed model value on the wire (whitespace/shell metacharacters) is rejected by the shared parser, never forwarded", () => {
    const url = `${LAUNCH_SCHEME}://${LAUNCH_HOST}?relay=${encodeURIComponent(SAMPLE.relay)}&session=${SAMPLE.session}&token=${encodeURIComponent(SAMPLE.token)}&model=${encodeURIComponent("opus; rm -rf")}`;
    const parsed = parseLaunchDeepLink(url);
    expect(parsed).not.toBeNull();
    expect(parsed).not.toHaveProperty("model");
  });

  it("is left untouched by redactDeepLinkToken — not a secret or free-form user content (AC-10)", () => {
    const url = buildLaunchDeepLink({ ...SAMPLE, model: "opus" });
    const redacted = redactDeepLinkToken(url);
    expect(redacted).toContain("model=opus");
  });
});

describe("buildLaunchDeepLink with permissionMode (task d3de150c, terminal auto-accept mode)", () => {
  it("includes permissionMode, positioned before prompt, and round-trips", () => {
    const withMode = { ...SAMPLE, permissionMode: "auto", prompt: "hello" };
    const url = buildLaunchDeepLink(withMode);
    expect(url).toContain("permissionMode=auto");
    expect(url.indexOf("permissionMode=")).toBeLessThan(url.indexOf("prompt="));
    expect(parseLaunchDeepLink(url)).toEqual(withMode);
  });

  it("omits permissionMode entirely when absent — no version-skew risk for an old bridge/helper", () => {
    const url = buildLaunchDeepLink(SAMPLE);
    expect(url).not.toContain("permissionMode=");
    expect(parseLaunchDeepLink(url)).toEqual(SAMPLE);
  });

  it("never fires any value other than the literal 'auto' — hard whitelist, builder side", () => {
    const url = buildLaunchDeepLink({ ...SAMPLE, permissionMode: "bypassPermissions" });
    expect(url).not.toContain("permissionMode=");
  });

  it("a forbidden value on the wire (e.g. bypassPermissions) is rejected by the shared parser, never forwarded", () => {
    const url = `${LAUNCH_SCHEME}://${LAUNCH_HOST}?relay=${encodeURIComponent(SAMPLE.relay)}&session=${SAMPLE.session}&token=${encodeURIComponent(SAMPLE.token)}&permissionMode=bypassPermissions`;
    const parsed = parseLaunchDeepLink(url);
    expect(parsed).not.toBeNull();
    expect(parsed).not.toHaveProperty("permissionMode");
  });

  it("is left untouched by redactDeepLinkToken — not a secret or free-form user content", () => {
    const url = buildLaunchDeepLink({ ...SAMPLE, permissionMode: "auto" });
    const redacted = redactDeepLinkToken(url);
    expect(redacted).toContain("permissionMode=auto");
  });
});

describe("buildLaunchDeepLink with worktree (concurrent-terminal isolation, native --worktree flag)", () => {
  it("includes worktree=1, positioned before prompt, and round-trips", () => {
    const withWorktree = { ...SAMPLE, worktree: true, prompt: "hello" };
    const url = buildLaunchDeepLink(withWorktree);
    expect(url).toContain("worktree=1");
    expect(url.indexOf("worktree=")).toBeLessThan(url.indexOf("prompt="));
    expect(parseLaunchDeepLink(url)).toEqual(withWorktree);
  });

  it("omits worktree entirely when absent/false — no version-skew risk for an old bridge/helper", () => {
    const url = buildLaunchDeepLink(SAMPLE);
    expect(url).not.toContain("worktree=");
    expect(parseLaunchDeepLink(url)).toEqual(SAMPLE);
    const falseUrl = buildLaunchDeepLink({ ...SAMPLE, worktree: false });
    expect(falseUrl).not.toContain("worktree=");
  });

  it("a bogus value on the wire is rejected by the shared parser, never forwarded", () => {
    const url = `${LAUNCH_SCHEME}://${LAUNCH_HOST}?relay=${encodeURIComponent(SAMPLE.relay)}&session=${SAMPLE.session}&token=${encodeURIComponent(SAMPLE.token)}&worktree=true`;
    const parsed = parseLaunchDeepLink(url);
    expect(parsed).not.toBeNull();
    expect(parsed).not.toHaveProperty("worktree");
  });

  it("is left untouched by redactDeepLinkToken — not a secret or free-form user content", () => {
    const url = buildLaunchDeepLink({ ...SAMPLE, worktree: true });
    const redacted = redactDeepLinkToken(url);
    expect(redacted).toContain("worktree=1");
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
