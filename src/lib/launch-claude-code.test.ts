import { describe, it, expect, beforeEach } from "vitest";

// jsdom in this project doesn't expose window.localStorage by default — provide a mock.
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      store = {};
    },
  };
})();
Object.defineProperty(window, "localStorage", { value: localStorageMock, configurable: true });

import {
  type CompactBootstrapArgs,
  type CompactPromptEssentials,
  type BoundedDeepLinkResult,
  buildClaudeDeepLink,
  buildBoundedDeepLink,
  mcpEndpoint,
  enforcePromptLength,
  MAX_DEEP_LINK_PROMPT_LENGTH,
  MAX_DEEP_LINK_URL_LENGTH,
  buildCompactBootstrapPrompt,
  buildCompactBootstrapPromptParts,
  buildCompactPromptEssentials,
  fitCompactWorktreeProtocol,
  resolveDefaultLaunchState,
  resolveLaunchCwd,
  parseRepoFromGithubUrl,
  validateFolderName,
  looksAbsolutePath,
  isValidAbsolutePath,
  chooseLaunchCwd,
  resolveEffectiveLaunchTarget,
  composeNewProjectPath,
  buildBoardBootstrapPrompt,
  buildTaskBootstrapPrompt,
  buildLaunchCommand,
  readLaunchPath,
  writeLaunchPath,
  launchPathKey,
  slugifyIdeaTitle,
  DEFAULT_NEW_PROJECT_PARENT,
  buildWorktreeIsolationProtocol,
} from "./launch-claude-code";

const APP_URL = "https://staging.vibecodes.co.uk";

/**
 * Mirrors EXACTLY what the launch button / useLaunchClaudeCode now do to build
 * the claude-cli:// deep link. FIX A (5th rework cycle, QA BUG A) rewrite:
 * routed through buildBoundedDeepLink — the SAME shared helper
 * openInClaudeCode/fireLaunchDeepLink now call — instead of the OLD
 * hand-rolled "budget = cap - base.length; prompt =
 * fitCompactWorktreeProtocol(...)" sequence, which is exactly the code shape
 * QA's BUG A repro exploited (an unclamped `cwd` blowing the base link over
 * the cap even at an empty prompt). Throws if the (real, non-pathological)
 * fixture ever fails to produce a URL — every EXISTING caller of this helper
 * expects a fired link; BUG A's own pathological-length tests call
 * buildClampedDeepLinkResult directly instead, so they can inspect the
 * `ok: false` / droppedCwd outcomes without this helper masking them.
 */
function buildClampedDeepLink(
  args: CompactBootstrapArgs,
  extra?: { cwd?: string; repo?: string }
): string {
  const result = buildClampedDeepLinkResult(args, extra);
  if (!result.ok) {
    throw new Error("buildClampedDeepLink: buildBoundedDeepLink returned ok:false (unexpected for this fixture)");
  }
  return result.url;
}

/** Full-result variant of buildClampedDeepLink — for tests that need to
 * inspect `ok` / `droppedCwd`, not just assume a link was fired. */
function buildClampedDeepLinkResult(
  args: CompactBootstrapArgs,
  extra?: { cwd?: string; repo?: string }
): BoundedDeepLinkResult {
  const essentials = buildCompactPromptEssentials(args);
  const cwd = extra?.cwd;
  const repo = extra?.repo;
  return buildBoundedDeepLink({
    essentials,
    cwd,
    cap: MAX_DEEP_LINK_URL_LENGTH,
    buildLink: ({ prompt, cwd: linkCwd }) => buildClaudeDeepLink({ prompt, cwd: linkCwd, repo }),
  });
}

/** Decode ONLY the `q=` param's value — unlike the naive `link.split("q=")[1]`
 * some older tests use (which also swallows any trailing `&cwd=…`/`&repo=…`
 * since it never stops at the next `&`), this stops at the first
 * un-encoded `&` so step-integrity checks aren't contaminated by adjacent
 * URL params. */
function decodeQ(link: string): string {
  const match = link.match(/[?&]q=([^&]*)/);
  return match ? decodeURIComponent(match[1]) : "";
}

/**
 * FIX B (5th rework cycle, QA BUG B) helper — asserts an essential step is
 * EITHER present in its full, verbatim text, OR cleanly absent, and NEVER a
 * fragment (a case where the step's own opening text shows up but the step
 * doesn't appear in full — the exact shape of QA's repro, where the decoded
 * tail cut off mid-sentence inside the MCP-connect step). Returns whether the
 * step is (wholly) present, so callers can chain priority assertions.
 */
function assertStepWholeOrAbsent(decoded: string, step: string, label: string): boolean {
  const marker = step.slice(0, Math.min(24, step.length));
  const markerPresent = decoded.includes(marker);
  const wholePresent = decoded.includes(step);
  if (markerPresent && !wholePresent) {
    expect.fail(`${label}: step is a FRAGMENT — its opening text is present but the full step is not`);
  }
  return wholePresent;
}

describe("buildClaudeDeepLink", () => {
  it("encodes spaces as %20, never +", () => {
    const link = buildClaudeDeepLink({ prompt: "hello world foo" });
    expect(link).toContain("q=hello%20world%20foo");
    expect(link).not.toContain("+");
  });

  it("includes cwd and normalises a full github URL repo to an owner/name slug", () => {
    const link = buildClaudeDeepLink({
      prompt: "p",
      cwd: "/Users/me/my project",
      repo: "https://github.com/o/n",
    });
    expect(link).toContain("cwd=%2FUsers%2Fme%2Fmy%20project");
    // The handler wants the slug, NOT the full URL (this was the balla-bot bug).
    expect(link).toContain("repo=o%2Fn");
    expect(link).not.toContain("github.com");
  });

  it("leaves an owner/name slug repo as-is", () => {
    const link = buildClaudeDeepLink({ prompt: "p", repo: "nicholasmball/balla-bot" });
    expect(link).toContain("repo=nicholasmball%2Fballa-bot");
  });

  it("drops a repo value that can't be reduced to a slug (e.g. non-github URL)", () => {
    const link = buildClaudeDeepLink({ prompt: "p", repo: "https://gitlab.com/o/n/extra" });
    expect(link).not.toContain("repo=");
  });

  it("omits cwd and repo entirely when absent", () => {
    const link = buildClaudeDeepLink({ prompt: "p" });
    expect(link).toBe("claude-cli://open?q=p");
    expect(link).not.toContain("cwd=");
    expect(link).not.toContain("repo=");
  });
});

describe("mcpEndpoint", () => {
  it("appends /api/mcp", () => {
    expect(mcpEndpoint("https://vibecodes.co.uk")).toBe("https://vibecodes.co.uk/api/mcp");
  });

  it("is trailing-slash safe", () => {
    expect(mcpEndpoint("https://vibecodes.co.uk/")).toBe("https://vibecodes.co.uk/api/mcp");
    expect(mcpEndpoint("https://vibecodes.co.uk///")).toBe("https://vibecodes.co.uk/api/mcp");
  });
});

describe("enforcePromptLength", () => {
  it("returns head + tail unchanged when within the cap", () => {
    expect(enforcePromptLength("head ", "tail")).toBe("head tail");
  });

  it("truncates the tail and preserves the MCP-setup head", () => {
    const head = "MCP_SETUP_HEAD\n";
    const tail = "x".repeat(MAX_DEEP_LINK_PROMPT_LENGTH);
    const out = enforcePromptLength(head, tail);
    expect(encodeURIComponent(out).length).toBeLessThanOrEqual(MAX_DEEP_LINK_PROMPT_LENGTH);
    expect(out.startsWith(head)).toBe(true);
    expect(out).toContain("(truncated)");
  });

  // BUG 6 fix (4th rework cycle): this test previously asserted `out === head`
  // for a head 100 chars OVER the cap — i.e. it encoded the very bug being
  // fixed here as the expected behaviour (`out` was itself over-cap, since
  // 5100 > 5000). enforcePromptLength must guarantee encodedLength(out) <=
  // cap in ALL cases, so a head that alone exceeds the cap now gets trimmed
  // too (largest prefix + the …(truncated) marker that fits), same as the
  // tail would be.
  it("BUG 6 fix: trims the head too when the head alone exceeds the cap (no longer returns an over-cap string)", () => {
    const head = "h".repeat(MAX_DEEP_LINK_PROMPT_LENGTH + 100);
    const out = enforcePromptLength(head, "tail");
    expect(encodeURIComponent(out).length).toBeLessThanOrEqual(MAX_DEEP_LINK_PROMPT_LENGTH);
    expect(out).toContain("(truncated)");
    // The tail is dropped entirely (never touched) — only the head is trimmed.
    expect(out).not.toContain("tail");
    expect(out.startsWith("h".repeat(50))).toBe(true);
  });

  // Bug 1: the cap bounds the URL-ENCODED length (acceptance criterion #6).
  it("bounds the ENCODED length, not the raw length", () => {
    // ASCII letters encode 1:1, so a raw-length guard would also pass here —
    // the discriminating case is special chars below.
    const head = "HEAD ";
    const tail = "a".repeat(10_000);
    const out = enforcePromptLength(head, tail);
    expect(encodeURIComponent(out).length).toBeLessThanOrEqual(MAX_DEEP_LINK_PROMPT_LENGTH);
  });

  it("keeps encoded length <= cap with chars that expand 3x when encoded", () => {
    // `< > " & space` each encode to 3 chars (%3C %3E %22 %26 %20). A raw-length
    // guard would let the encoded `q` blow past 5000; the encoded guard must not.
    const head = "HEAD ";
    const tail = '< > " & '.repeat(2000); // ~16k raw, ~48k encoded before trimming
    const out = enforcePromptLength(head, tail);
    expect(encodeURIComponent(out).length).toBeLessThanOrEqual(MAX_DEEP_LINK_PROMPT_LENGTH);
    expect(out.startsWith(head)).toBe(true);
  });

  it("trims as close to the encoded cap as the ellipsis allows", () => {
    const head = "HEAD ";
    const tail = "&".repeat(10_000); // each `&` -> %26 (3 chars)
    const out = enforcePromptLength(head, tail);
    const encoded = encodeURIComponent(out).length;
    expect(encoded).toBeLessThanOrEqual(MAX_DEEP_LINK_PROMPT_LENGTH);
    // Should fill most of the budget — not trim back to nothing.
    expect(encoded).toBeGreaterThan(MAX_DEEP_LINK_PROMPT_LENGTH - 50);
  });
});

describe("parseRepoFromGithubUrl", () => {
  it("parses https URLs", () => {
    expect(parseRepoFromGithubUrl("https://github.com/acme/widget")).toBe("acme/widget");
  });

  it("parses https URLs with .git and trailing slash", () => {
    expect(parseRepoFromGithubUrl("https://github.com/acme/widget.git/")).toBe("acme/widget");
  });

  it("parses www and scp-style URLs", () => {
    expect(parseRepoFromGithubUrl("https://www.github.com/a/b")).toBe("a/b");
    expect(parseRepoFromGithubUrl("git@github.com:a/b.git")).toBe("a/b");
  });

  it("returns null for empty/invalid/non-github URLs", () => {
    expect(parseRepoFromGithubUrl(null)).toBeNull();
    expect(parseRepoFromGithubUrl("")).toBeNull();
    expect(parseRepoFromGithubUrl("   ")).toBeNull();
    expect(parseRepoFromGithubUrl("https://gitlab.com/a/b")).toBeNull();
    expect(parseRepoFromGithubUrl("https://github.com/onlyowner")).toBeNull();
    expect(parseRepoFromGithubUrl("not a url")).toBeNull();
  });
});

describe("validateFolderName", () => {
  it("accepts valid names", () => {
    expect(validateFolderName("my-idea_2.0").valid).toBe(true);
  });

  it("rejects empty names", () => {
    const r = validateFolderName("   ");
    expect(r.valid).toBe(false);
    expect(r.message).toMatch(/name/i);
  });

  it("rejects and names offending characters", () => {
    const r = validateFolderName("my idea/x");
    expect(r.valid).toBe(false);
    expect(r.invalidChars).toContain(" ");
    expect(r.invalidChars).toContain("/");
    expect(r.message).toContain("spaces");
    expect(r.message).toContain('"/"');
  });
});

describe("looksAbsolutePath", () => {
  it("accepts posix, home, and windows paths", () => {
    expect(looksAbsolutePath("/Users/me/x")).toBe(true);
    expect(looksAbsolutePath("~/projects")).toBe(true);
    expect(looksAbsolutePath("C:\\Users\\me")).toBe(true);
  });

  it("rejects relative paths", () => {
    expect(looksAbsolutePath("projects/x")).toBe(false);
    expect(looksAbsolutePath("./x")).toBe(false);
  });
});

describe("composeNewProjectPath", () => {
  it("joins parent and name with a single slash", () => {
    expect(composeNewProjectPath("/Users/me/projects", "my-idea")).toBe("/Users/me/projects/my-idea");
    expect(composeNewProjectPath("/Users/me/projects/", "my-idea")).toBe("/Users/me/projects/my-idea");
  });
});

describe("buildBoardBootstrapPrompt", () => {
  it("existing mode contains the env-derived MCP add and uses get_board (not get_my_tasks)", () => {
    const p = buildBoardBootstrapPrompt({
      appUrl: APP_URL,
      ideaId: "idea-1",
      ideaTitle: "My Idea",
      mode: "existing",
    });
    expect(p).toContain(`vibecodes ${APP_URL}/api/mcp`);
    // A freshly created board has nothing ASSIGNED, so get_my_tasks would
    // return empty — the prompt must drive get_board instead.
    expect(p).toContain("get_board");
    expect(p).toContain("Do NOT use get_my_tasks");
    expect(p).toContain("My Idea");
    expect(p).not.toContain("mkdir -p");
  });

  it("create-new mode injects mkdir and git clone when repo present", () => {
    const p = buildBoardBootstrapPrompt({
      appUrl: APP_URL,
      ideaId: "idea-1",
      ideaTitle: "My Idea",
      mode: "new",
      repoUrl: "https://github.com/acme/widget",
      newProject: { newProjectPath: "/Users/me/projects/my-idea" },
    });
    expect(p).toContain("mkdir -p /Users/me/projects/my-idea");
    expect(p).toContain("git clone https://github.com/acme/widget.git .");
    expect(p).not.toContain("git init");
  });

  it("create-new mode falls back to git init when no/invalid repo", () => {
    const p = buildBoardBootstrapPrompt({
      appUrl: APP_URL,
      ideaId: "idea-1",
      ideaTitle: "My Idea",
      mode: "new",
      repoUrl: "not-a-repo",
      newProject: { newProjectPath: "/Users/me/projects/my-idea" },
    });
    expect(p).toContain("git init");
    expect(p).not.toContain("git clone");
  });

  it("create-new mode is existence-aware: reuse the dir if it already exists, don't overwrite", () => {
    const p = buildBoardBootstrapPrompt({
      appUrl: APP_URL,
      ideaId: "idea-1",
      ideaTitle: "My Idea",
      mode: "new",
      repoUrl: "https://github.com/acme/widget",
      newProject: { newProjectPath: "/Users/me/projects/my-idea" },
    });
    // Tells the agent to check existence and reuse rather than blindly create.
    expect(p).toMatch(/already exists/i);
    expect(p).toMatch(/reuse it as-is|use them as-is|leave it/i);
    expect(p).toMatch(/do NOT (re-clone|overwrite|clone over)/i);
  });

  it("guards ENCODED length to <= 5000 keeping the MCP head", () => {
    const p = buildBoardBootstrapPrompt({
      appUrl: APP_URL,
      ideaId: "idea-1",
      ideaTitle: "T".repeat(8000),
      mode: "existing",
    });
    expect(encodeURIComponent(p).length).toBeLessThanOrEqual(MAX_DEEP_LINK_PROMPT_LENGTH);
    expect(p).toContain("claude mcp add");
  });

  // Bug 1: a long title that yields encoded `q` > 5000 must still be capped once
  // it lands in the deep link.
  it("keeps the deep-link encoded q <= 5000 for an over-long title", () => {
    const p = buildBoardBootstrapPrompt({
      appUrl: APP_URL,
      ideaId: "idea-1",
      ideaTitle: "T".repeat(8000),
      mode: "existing",
    });
    const link = buildClaudeDeepLink({ prompt: p });
    const q = link.slice(link.indexOf("q=") + 2).split("&")[0];
    expect(q.length).toBeLessThanOrEqual(MAX_DEEP_LINK_PROMPT_LENGTH);
  });

  // Bug 2: the MCP-setup head must survive even when the create-new path is huge.
  it("create-new mode keeps both the directory step and `claude mcp add`", () => {
    const p = buildBoardBootstrapPrompt({
      appUrl: APP_URL,
      ideaId: "idea-1",
      ideaTitle: "My Idea",
      mode: "new",
      newProject: { newProjectPath: "/Users/me/projects/my-idea" },
    });
    // Directory step (cd-first) comes before MCP setup; both survive.
    expect(p).toContain("mkdir -p /Users/me/projects/my-idea");
    expect(p).toContain("claude mcp add");
    expect(p.indexOf("mkdir -p")).toBeLessThan(p.indexOf("claude mcp add"));
    expect(encodeURIComponent(p).length).toBeLessThanOrEqual(MAX_DEEP_LINK_PROMPT_LENGTH);
  });
});

describe("buildTaskBootstrapPrompt", () => {
  it("targets the specific task and idea", () => {
    const p = buildTaskBootstrapPrompt({
      appUrl: APP_URL,
      ideaId: "idea-1",
      taskId: "task-9",
      taskTitle: "Add OAuth rotation",
      mode: "existing",
    });
    expect(p).toContain("task_id: task-9");
    expect(p).toContain("idea_id: idea-1");
    expect(p).toContain("Add OAuth rotation");
    expect(p).toContain("claude mcp add");
  });

  it("create-new branch adds bootstrap preamble", () => {
    const p = buildTaskBootstrapPrompt({
      appUrl: APP_URL,
      ideaId: "idea-1",
      taskId: "task-9",
      taskTitle: "Add OAuth rotation",
      mode: "new",
      newProject: { newProjectPath: "/Users/me/x" },
    });
    expect(p).toContain("mkdir -p /Users/me/x");
    expect(p).toContain("git init"); // no repo
  });

  // Bug 2: head survives a huge create-new path in the task builder too.
  it("create-new mode keeps both the directory step and `claude mcp add`", () => {
    const p = buildTaskBootstrapPrompt({
      appUrl: APP_URL,
      ideaId: "idea-1",
      taskId: "task-9",
      taskTitle: "Add OAuth rotation",
      mode: "new",
      newProject: { newProjectPath: "/Users/me/projects/my-idea" },
    });
    expect(p).toContain("mkdir -p /Users/me/projects/my-idea");
    expect(p).toContain("claude mcp add");
    expect(p.indexOf("mkdir -p")).toBeLessThan(p.indexOf("claude mcp add"));
    expect(encodeURIComponent(p).length).toBeLessThanOrEqual(MAX_DEEP_LINK_PROMPT_LENGTH);
  });
});

describe("buildLaunchCommand", () => {
  it("existing mode builds cd && claude with a single-quoted prompt", () => {
    const cmd = buildLaunchCommand({ prompt: 'do "stuff"', cwd: "/Users/me/x", mode: "existing" });
    // Double quotes are inert inside single quotes — no escaping needed.
    expect(cmd).toBe("cd /Users/me/x && claude 'do \"stuff\"'");
  });

  it("omits cd when no cwd", () => {
    const cmd = buildLaunchCommand({ prompt: "go", mode: "existing" });
    expect(cmd).toBe("claude 'go'");
  });

  it("create-new mode prefixes mkdir + clone||init", () => {
    const cmd = buildLaunchCommand({
      prompt: "go",
      mode: "new",
      newProject: { newProjectPath: "/Users/me/x" },
      repoUrl: "https://github.com/acme/widget",
    });
    expect(cmd).toContain("mkdir -p /Users/me/x");
    expect(cmd).toContain("git clone https://github.com/acme/widget.git . || git init");
  });

  it("create-new mode without repo uses git init", () => {
    const cmd = buildLaunchCommand({
      prompt: "go",
      mode: "new",
      newProject: { newProjectPath: "/Users/me/x" },
    });
    expect(cmd).toContain("(git init)");
    expect(cmd).not.toContain("git clone");
  });

  // Bug 3: dangerous shell metacharacters in a task/idea title must be inert —
  // wrapped in a single-quoted span, never interpreted by the shell.
  it("neutralises command substitution, expansion, and quotes via single-quoting", () => {
    const prompt = "build `whoami` $(rm -rf /) $HOME and 'quote'";
    const cmd = buildLaunchCommand({ prompt, mode: "existing" });

    // The whole prompt sits inside one single-quoted span; the only place a `'`
    // is allowed is the `'\''` escape sequence.
    expect(cmd.startsWith("claude '")).toBe(true);

    // Reconstruct what the shell would parse: strip the leading `claude ` and
    // decode the single-quote escaping. Anything inside is a literal.
    const arg = cmd.slice("claude ".length);
    // `'\''` is the close/escape/reopen idiom; collapsing it back yields the
    // original literal, proving the prompt round-trips with no expansion.
    const decoded = arg
      .replace(/^'/, "")
      .replace(/'$/, "")
      .replace(/'\\''/g, "'");
    expect(decoded).toBe(prompt);

    // The backtick / $(...) / $VAR substrings appear ONLY inside the quoted span,
    // never as bare shell-active tokens.
    expect(cmd).toContain("`whoami`");
    expect(cmd).toContain("$(rm -rf /)");
    expect(cmd).toContain("$HOME");
    // No unescaped backslash-based double-quote escaping leaked in.
    expect(cmd).not.toContain('\\"');
  });
});

describe("localStorage persistence", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("round-trips a launch state", () => {
    writeLaunchPath("idea-1", { mode: "new", path: "/Users/me/x", parent: "/Users/me", name: "x" });
    expect(readLaunchPath("idea-1")).toEqual({
      mode: "new",
      path: "/Users/me/x",
      parent: "/Users/me",
      name: "x",
    });
  });

  it("returns null when nothing is stored", () => {
    expect(readLaunchPath("missing")).toBeNull();
  });

  it("returns null for corrupt JSON", () => {
    window.localStorage.setItem(launchPathKey("idea-1"), "{not json");
    expect(readLaunchPath("idea-1")).toBeNull();
  });

  it("normalises a missing mode to existing", () => {
    window.localStorage.setItem(launchPathKey("idea-1"), JSON.stringify({ path: "/x" }));
    expect(readLaunchPath("idea-1")?.mode).toBe("existing");
  });
});

describe("slugifyIdeaTitle", () => {
  it("lowercases and dashes a title into a safe folder name", () => {
    expect(slugifyIdeaTitle("My Great Idea!")).toBe("my-great-idea");
  });

  it("collapses runs and trims leading/trailing separators", () => {
    expect(slugifyIdeaTitle("  Foo --- Bar  ")).toBe("foo-bar");
  });

  it("falls back to 'project' when nothing usable remains", () => {
    expect(slugifyIdeaTitle("!!!")).toBe("project");
    expect(slugifyIdeaTitle("")).toBe("project");
  });
});

describe("existing-mode directory guidance (repo-first)", () => {
  it("tells the agent to open/clone the repo when a github_url is present (no mkdir)", () => {
    const p = buildBoardBootstrapPrompt({
      appUrl: APP_URL,
      ideaId: "idea-1",
      ideaTitle: "My Idea",
      mode: "existing",
      repoUrl: "https://github.com/acme/widget",
    });
    expect(p).toContain("git clone https://github.com/acme/widget.git");
    expect(p).toContain(`${DEFAULT_NEW_PROJECT_PARENT}/widget`);
    expect(p).not.toContain("mkdir -p"); // existing mode never mkdirs a named project
    // Directory step comes FIRST (so the session lands in the right folder), then MCP.
    expect(p.indexOf("git clone")).toBeLessThan(p.indexOf("claude mcp add"));
    expect(p).toContain("claude mcp add");
  });

  it("adds no directory block in existing mode when there is no repo", () => {
    const p = buildTaskBootstrapPrompt({
      appUrl: APP_URL,
      ideaId: "idea-1",
      taskId: "task-9",
      taskTitle: "Do the thing",
      mode: "existing",
      repoUrl: null,
    });
    expect(p).not.toContain("git clone");
    expect(p).not.toContain("mkdir -p");
    expect(p).toContain("task_id: task-9");
  });
});

describe("isValidAbsolutePath", () => {
  it("accepts a POSIX absolute path (expanded pwd)", () => {
    expect(isValidAbsolutePath("/Users/nick/projects/vibecodes")).toBe(true);
    expect(isValidAbsolutePath("/")).toBe(true);
  });

  it("accepts Windows drive and UNC paths", () => {
    expect(isValidAbsolutePath("C:\\Users\\nick\\x")).toBe(true);
    expect(isValidAbsolutePath("C:/Users/nick/x")).toBe(true);
    expect(isValidAbsolutePath("\\\\server\\share\\proj")).toBe(true);
  });

  it("trims surrounding whitespace before validating", () => {
    expect(isValidAbsolutePath("  /Users/nick/x  ")).toBe(true);
  });

  it("rejects empty / whitespace-only", () => {
    expect(isValidAbsolutePath("")).toBe(false);
    expect(isValidAbsolutePath("   ")).toBe(false);
  });

  it("rejects relative paths", () => {
    expect(isValidAbsolutePath("projects/vibecodes")).toBe(false);
    expect(isValidAbsolutePath("./x")).toBe(false);
    expect(isValidAbsolutePath("../x")).toBe(false);
  });

  it("rejects tilde-home (must be the expanded pwd, never `~`)", () => {
    expect(isValidAbsolutePath("~")).toBe(false);
    expect(isValidAbsolutePath("~/projects/vibecodes")).toBe(false);
  });

  it("rejects unexpanded shell variables", () => {
    expect(isValidAbsolutePath("$HOME/projects/x")).toBe(false);
    expect(isValidAbsolutePath("/Users/$USER/x")).toBe(false);
  });

  // Guards the contract with record_project_path's own non-string defenses.
  it("rejects non-string input", () => {
    // @ts-expect-error testing runtime guard for non-string callers
    expect(isValidAbsolutePath(null)).toBe(false);
    // @ts-expect-error testing runtime guard for non-string callers
    expect(isValidAbsolutePath(undefined)).toBe(false);
  });
});

describe("chooseLaunchCwd (hostname rule — Design Review option (a))", () => {
  it("returns undefined for 0 records (first-launch / home flow)", () => {
    expect(chooseLaunchCwd([])).toBeUndefined();
    expect(chooseLaunchCwd(null)).toBeUndefined();
    expect(chooseLaunchCwd(undefined)).toBeUndefined();
  });

  it("returns the single record's absolute_path for exactly 1 record", () => {
    expect(
      chooseLaunchCwd([
        { absolute_path: "/Users/nick/projects/vibecodes", hostname: "Nicks-MacBook" },
      ])
    ).toBe("/Users/nick/projects/vibecodes");
  });

  it("trims the single record's path", () => {
    expect(
      chooseLaunchCwd([{ absolute_path: "  /Users/nick/x  ", hostname: "host" }])
    ).toBe("/Users/nick/x");
  });

  it("returns undefined for >1 records (ambiguous across machines — safe fallback)", () => {
    expect(
      chooseLaunchCwd([
        { absolute_path: "/Users/nick/projects/x", hostname: "mac" },
        { absolute_path: "/home/nick/projects/x", hostname: "linux" },
      ])
    ).toBeUndefined();
  });

  it("ignores invalid rows; a single VALID row still resolves", () => {
    expect(
      chooseLaunchCwd([
        { absolute_path: "~/projects/x", hostname: "bad" },
        { absolute_path: "/Users/nick/projects/x", hostname: "good" },
      ])
    ).toBe("/Users/nick/projects/x");
  });

  it("returns undefined when the only row is invalid", () => {
    expect(
      chooseLaunchCwd([{ absolute_path: "relative/path", hostname: "bad" }])
    ).toBeUndefined();
  });
});

describe("resolveEffectiveLaunchTarget (single source for DISPLAY + LAUNCH)", () => {
  const recorded = [
    { absolute_path: "/Users/nick/projects/from-db", hostname: "Nicks-MacBook" },
  ];

  // ── Happy path: saved existing-mode path wins (THE BUG) ───────────────────
  it("prefers a saved existing-mode absolute path over the DB recorded path", () => {
    const t = resolveEffectiveLaunchTarget({
      hasRepo: false,
      saved: { mode: "existing", path: "/Users/nick/projects/from-dialog" },
      recordedPaths: recorded,
    });
    // Same value drives BOTH the cwd (launch) and displayPath (dropdown) — so a
    // path saved in the dialog is what the dropdown shows AND what launch uses.
    expect(t.cwd).toBe("/Users/nick/projects/from-dialog");
    expect(t.displayPath).toBe("/Users/nick/projects/from-dialog");
    expect(t.source).toBe("saved");
    expect(t.displayLabel).toBe("This machine — set manually");
    expect(t.host).toBeNull();
  });

  it("regression: cwd and displayPath are ALWAYS the same value", () => {
    for (const saved of [
      null,
      { mode: "existing" as const, path: "/Users/nick/x" },
      { mode: "new" as const, path: "~/projects/x", parent: "~/projects", name: "x" },
    ]) {
      const t = resolveEffectiveLaunchTarget({ hasRepo: false, saved, recordedPaths: recorded });
      expect(t.displayPath).toBe(t.cwd);
    }
  });

  it("trims the saved path before using it", () => {
    const t = resolveEffectiveLaunchTarget({
      hasRepo: false,
      saved: { mode: "existing", path: "  /Users/nick/x  " },
      recordedPaths: null,
    });
    expect(t.cwd).toBe("/Users/nick/x");
  });

  // ── Falls back to the DB recorded path ────────────────────────────────────
  it("falls back to the DB recorded path when no saved path exists", () => {
    const t = resolveEffectiveLaunchTarget({
      hasRepo: false,
      saved: null,
      recordedPaths: recorded,
    });
    expect(t.cwd).toBe("/Users/nick/projects/from-db");
    expect(t.source).toBe("recorded");
    expect(t.displayLabel).toBe("This machine — Nicks-MacBook");
    expect(t.host).toBe("Nicks-MacBook");
  });

  it("honours chooseLaunchCwd's >1 → undefined contract (ambiguous machines)", () => {
    const t = resolveEffectiveLaunchTarget({
      hasRepo: false,
      saved: null,
      recordedPaths: [
        { absolute_path: "/Users/nick/x", hostname: "mac" },
        { absolute_path: "/home/nick/x", hostname: "linux" },
      ],
    });
    expect(t.cwd).toBeUndefined();
    expect(t.source).toBe("none");
  });

  // ── Negative paths: bad/irrelevant saved state must NOT surface ────────────
  it("ignores new-mode saved state (composed ~/projects path is not a valid cwd)", () => {
    const t = resolveEffectiveLaunchTarget({
      hasRepo: false,
      saved: { mode: "new", path: "~/projects/my-idea", parent: "~/projects", name: "my-idea" },
      recordedPaths: recorded,
    });
    // New-mode path is ignored → falls through to the DB recorded path.
    expect(t.cwd).toBe("/Users/nick/projects/from-db");
    expect(t.source).toBe("recorded");
  });

  it("ignores a saved existing-mode path that fails strict validation (~ / relative)", () => {
    const t = resolveEffectiveLaunchTarget({
      hasRepo: false,
      saved: { mode: "existing", path: "~/projects/x" },
      recordedPaths: recorded,
    });
    expect(t.cwd).toBe("/Users/nick/projects/from-db"); // falls back, not the ~ path
    expect(t.source).toBe("recorded");
  });

  it("repo-backed ideas never inject a cwd or show a path line, even with a saved path", () => {
    const t = resolveEffectiveLaunchTarget({
      hasRepo: true,
      saved: { mode: "existing", path: "/Users/nick/projects/from-dialog" },
      recordedPaths: recorded,
    });
    expect(t.cwd).toBeUndefined();
    expect(t.displayPath).toBeUndefined();
    expect(t.source).toBe("none");
  });

  it("returns source 'none' when nothing is usable (first-launch flow)", () => {
    const t = resolveEffectiveLaunchTarget({ hasRepo: false, saved: null, recordedPaths: [] });
    expect(t.cwd).toBeUndefined();
    expect(t.displayPath).toBeUndefined();
    expect(t.displayLabel).toBeUndefined();
    expect(t.source).toBe("none");
  });
});

describe("no-repo bootstrap prompt — pwd + record_project_path + cd guard", () => {
  const base = {
    appUrl: APP_URL,
    ideaId: "idea-abc",
    ideaTitle: "My Idea",
    mode: "new" as const,
    newProject: { newProjectPath: "/Users/me/projects/my-idea" },
  };

  it("instructs pwd, record_project_path with the idea_id, hostname, and self-heal", () => {
    const p = buildBoardBootstrapPrompt(base);
    expect(p).toContain("pwd");
    expect(p).toContain("record_project_path");
    expect(p).toContain('idea_id "idea-abc"');
    expect(p).toMatch(/hostname/i);
    expect(p).toMatch(/every launch/i); // self-heal: re-record each launch
  });

  it("records only AFTER the vibecodes connector is available (Change #2)", () => {
    const p = buildBoardBootstrapPrompt(base);
    // The record instruction is gated on the board tools being available.
    expect(p).toMatch(/as soon as the vibecodes board tools are available/i);
  });

  it("includes the defensive cd guard (Change #3): STOP if pwd is still home", () => {
    const p = buildBoardBootstrapPrompt(base);
    expect(p).toMatch(
      /if `?pwd`? still shows your home directory, STOP/i
    );
    // The write-files guard still defends CLAUDE.md against landing in home.
    expect(p).toMatch(/Only AFTER you are confirmed inside the project folder/i);
  });

  it("hardens the cd gate against planning/board-only rationalisation (football-predictor bug)", () => {
    const p = buildBoardBootstrapPrompt(base);
    // The agent must not stay in home reasoning "no files needed yet".
    expect(p).toMatch(/even if the first task is planning|board-only/i);
    expect(p).toMatch(/no files are needed yet|repo will be created later/i);
  });

  it("orders the sequence cd → pwd → record → write files", () => {
    const p = buildBoardBootstrapPrompt(base);
    const cd = p.indexOf("mkdir -p");
    const pwd = p.indexOf("Run `pwd`");
    const record = p.indexOf("record_project_path");
    const writeGuard = p.indexOf("Only AFTER you are confirmed inside the project folder");
    expect(cd).toBeGreaterThanOrEqual(0);
    expect(pwd).toBeGreaterThan(cd);
    expect(record).toBeGreaterThan(pwd);
    expect(writeGuard).toBeGreaterThan(record);
  });

  it("keeps the record/pwd contract in the truncation-protected head for a huge title", () => {
    const p = buildBoardBootstrapPrompt({ ...base, ideaTitle: "T".repeat(8000) });
    expect(encodeURIComponent(p).length).toBeLessThanOrEqual(MAX_DEEP_LINK_PROMPT_LENGTH);
    expect(p).toContain("record_project_path");
    expect(p).toContain("claude mcp add");
  });

  it("task builder also emits the pwd + record contract for no-repo", () => {
    const p = buildTaskBootstrapPrompt({
      appUrl: APP_URL,
      ideaId: "idea-abc",
      taskId: "task-1",
      taskTitle: "Do thing",
      mode: "new",
      newProject: { newProjectPath: "/Users/me/projects/my-idea" },
    });
    expect(p).toContain("record_project_path");
    expect(p).toContain('idea_id "idea-abc"');
  });

  it("repo-backed (existing) launch does NOT mention record_project_path or pwd contract", () => {
    const p = buildBoardBootstrapPrompt({
      appUrl: APP_URL,
      ideaId: "idea-abc",
      ideaTitle: "My Idea",
      mode: "existing",
      repoUrl: "https://github.com/acme/widget",
    });
    expect(p).not.toContain("record_project_path");
  });
});

describe("buildCompactBootstrapPrompt (deep-link prompt)", () => {
  const APP_URL = "https://vibecodes.co.uk";

  // THE regression guard: a no-repo, no-recorded-path board launches in mode
  // "new" with the directory step. The verbose builder produced a ~5000-char
  // claude-cli:// URL that Chromium SILENTLY refused to launch. The compact
  // deep-link prompt must keep the URL under the OS ceiling.
  it("new no-repo board deep link stays under MAX_DEEP_LINK_URL_LENGTH", () => {
    const prompt = buildCompactBootstrapPrompt({
      appUrl: APP_URL,
      ideaId: "1beea99a-0377-421b-9a8b-a9956ae34b5d",
      ideaTitle: "horse racing predictor",
      mode: "new",
      repoUrl: null,
      newProject: { newProjectPath: "~/projects/horse-racing-predictor" },
    });
    const link = buildClaudeDeepLink({ prompt });
    expect(link.length).toBeLessThanOrEqual(MAX_DEEP_LINK_URL_LENGTH);
  });

  it("keeps the URL under the cap even for a pathological title + long slug", () => {
    const prompt = buildCompactBootstrapPrompt({
      appUrl: APP_URL,
      ideaId: "1beea99a-0377-421b-9a8b-a9956ae34b5d",
      ideaTitle: "Q".repeat(5000),
      mode: "new",
      repoUrl: null,
      newProject: { newProjectPath: "~/projects/" + "x".repeat(40) },
    });
    expect(buildClaudeDeepLink({ prompt }).length).toBeLessThanOrEqual(MAX_DEEP_LINK_URL_LENGTH);
  });

  it("repo and existing-with-cwd deep links also stay under the cap", () => {
    const repo = buildCompactBootstrapPrompt({
      appUrl: APP_URL,
      ideaId: "idea-1",
      ideaTitle: "horse racing predictor",
      mode: "existing",
      repoUrl: "https://github.com/acme/horse-racing-predictor",
    });
    expect(buildClaudeDeepLink({ prompt: repo, repo: "acme/horse-racing-predictor" }).length)
      .toBeLessThanOrEqual(MAX_DEEP_LINK_URL_LENGTH);

    const existing = buildCompactBootstrapPrompt({
      appUrl: APP_URL,
      ideaId: "idea-1",
      ideaTitle: "horse racing predictor",
      mode: "existing",
      repoUrl: null,
    });
    expect(buildClaudeDeepLink({ prompt: existing, cwd: "/Users/nickball/projects/horse-racing-predictor" }).length)
      .toBeLessThanOrEqual(MAX_DEEP_LINK_URL_LENGTH);
  });

  it("keeps every essential step: dir-first, MCP add, record_project_path, get_board (not get_my_tasks)", () => {
    const p = buildCompactBootstrapPrompt({
      appUrl: APP_URL,
      ideaId: "idea-1",
      ideaTitle: "My Idea",
      mode: "new",
      repoUrl: null,
      newProject: { newProjectPath: "~/projects/my-idea" },
    });
    expect(p).toContain("mkdir -p ~/projects/my-idea");
    expect(p).toContain(`claude mcp add -s local --transport http vibecodes ${APP_URL}/api/mcp`);
    expect(p).toContain("/mcp");
    expect(p).toContain("record_project_path");
    expect(p).toContain("get_board");
    expect(p).toContain("NOT get_my_tasks");
    expect(p).toContain("In Progress");
    // dir step comes before the MCP step
    expect(p.indexOf("mkdir -p")).toBeLessThan(p.indexOf("claude mcp add"));
  });

  it("existing-no-repo skips the directory step (the deep link cwd handles it)", () => {
    const p = buildCompactBootstrapPrompt({
      appUrl: APP_URL,
      ideaId: "idea-1",
      ideaTitle: "My Idea",
      mode: "existing",
      repoUrl: null,
    });
    expect(p).not.toContain("mkdir -p");
    expect(p).toContain("get_board");
  });

  it("task variant targets the task_id and its work step does not fetch the board", () => {
    const { tail } = buildCompactBootstrapPromptParts({
      appUrl: APP_URL,
      ideaId: "idea-1",
      ideaTitle: "My Idea",
      mode: "new",
      repoUrl: null,
      newProject: { newProjectPath: "~/projects/my-idea" },
      taskId: "task-9",
    });
    // The trimmable WORK step is what must target the task, not the board — the
    // MCP-connect step (in the head) may name get_board in its skip clause, which
    // is fine; the assertion below is scoped to the work tail on purpose.
    expect(tail).toContain("task_id task-9");
    expect(tail).toContain("get_task");
    expect(tail).not.toContain("get_board");
  });
});

// ── In-browser terminal — bootstrap prompt parity (docs/terminal-bootstrap-prompt-ux.html) ──

describe("buildCompactBootstrapPromptParts (in-browser terminal parity)", () => {
  const APP_URL = "https://vibecodes.co.uk";
  const IDEA_ID = "1beea99a-0377-421b-9a8b-a9956ae34b5d";
  const TASK_ID = "7c1c1c1c-2222-3333-4444-555555555555";

  // The four launch shapes the acceptance criteria name (AC1–AC3).
  const FIXTURES: Record<string, CompactBootstrapArgs> = {
    "task-selected": {
      appUrl: APP_URL,
      ideaId: IDEA_ID,
      ideaTitle: "My First App",
      mode: "new",
      repoUrl: null,
      newProject: { newProjectPath: "~/projects/my-first-app" },
      taskId: TASK_ID,
    },
    "board-level": {
      appUrl: APP_URL,
      ideaId: IDEA_ID,
      ideaTitle: "My First App",
      mode: "existing",
      repoUrl: null,
    },
    "repo-backed": {
      appUrl: APP_URL,
      ideaId: IDEA_ID,
      ideaTitle: "Horse Racing Predictor",
      mode: "existing",
      repoUrl: "https://github.com/acme/horse-racing-predictor",
    },
    "new-project": {
      appUrl: APP_URL,
      ideaId: IDEA_ID,
      ideaTitle: "Horse Racing Predictor",
      mode: "new",
      repoUrl: null,
      newProject: { newProjectPath: "~/projects/horse-racing-predictor" },
    },
  };

  it("head + tail is byte-identical to buildCompactBootstrapPrompt for every fixture (AC1 — one prompt source)", () => {
    for (const [name, args] of Object.entries(FIXTURES)) {
      const { head, tail } = buildCompactBootstrapPromptParts(args);
      expect(head + tail, `fixture ${name}`).toBe(buildCompactBootstrapPrompt(args));
    }
  });

  it("the load-bearing steps live in the head; only the work step is the trimmable tail", () => {
    for (const [name, args] of Object.entries(FIXTURES)) {
      const { head, tail } = buildCompactBootstrapPromptParts(args);
      expect(head, `fixture ${name} head has MCP connect`).toContain("claude mcp add");
      expect(head, `fixture ${name} head has record_project_path`).toContain("record_project_path");
      expect(tail, `fixture ${name} tail never carries MCP setup`).not.toContain("claude mcp add");
    }
  });

  it("task launch carries task_id + idea_id + MCP connect (AC2)", () => {
    const { head, tail } = buildCompactBootstrapPromptParts(FIXTURES["task-selected"]);
    expect(head).toContain(`claude mcp add -s local --transport http vibecodes ${APP_URL}/api/mcp`);
    expect(tail).toContain(`task_id ${TASK_ID}`);
    expect(tail).toContain(`idea_id ${IDEA_ID}`);
    expect(tail).toContain("get_task");
  });

  it("board launch is the board-level compact prompt (AC3)", () => {
    const { tail } = buildCompactBootstrapPromptParts(FIXTURES["board-level"]);
    expect(tail).toContain("get_board");
    expect(tail).toContain("NOT get_my_tasks");
    expect(tail).not.toContain("task_id");
  });

  it("a roomy budget leaves the parts untouched — parity holds end to end (AC1)", () => {
    for (const [name, args] of Object.entries(FIXTURES)) {
      const { head, tail } = buildCompactBootstrapPromptParts(args);
      expect(
        enforcePromptLength(head, tail, MAX_DEEP_LINK_PROMPT_LENGTH),
        `fixture ${name}`
      ).toBe(buildCompactBootstrapPrompt(args));
    }
  });

  it("a tight budget keeps the whole MCP head and marks the trimmed tail (AC6 overflow)", () => {
    const { head, tail } = buildCompactBootstrapPromptParts(FIXTURES["task-selected"]);
    const budget = encodeURIComponent(head).length + 50; // room for head + a sliver of tail
    const fitted = enforcePromptLength(head, tail, budget);
    expect(fitted.startsWith(head)).toBe(true);
    expect(fitted).toContain("claude mcp add");
    expect(fitted).toContain("…(truncated)");
    expect(encodeURIComponent(fitted).length).toBeLessThanOrEqual(budget);
  });
});

describe("enforcePromptLength with a custom cap (in-browser URL budget)", () => {
  it("still defaults to MAX_DEEP_LINK_PROMPT_LENGTH", () => {
    const head = "H".repeat(10);
    const tail = "T".repeat(MAX_DEEP_LINK_PROMPT_LENGTH);
    const p = enforcePromptLength(head, tail);
    expect(encodeURIComponent(p).length).toBeLessThanOrEqual(MAX_DEEP_LINK_PROMPT_LENGTH);
  });

  it("caps the ENCODED length to the supplied budget and preserves the head", () => {
    const head = "HEAD\n";
    const tail = "x".repeat(500);
    const p = enforcePromptLength(head, tail, 100);
    expect(p.startsWith(head)).toBe(true);
    expect(p).toContain("…(truncated)");
    expect(encodeURIComponent(p).length).toBeLessThanOrEqual(100);
  });

  // BUG 6 fix (4th rework cycle): previously asserted `p === head` for a
  // 200-char head against a 100-char budget — `p` itself was over-budget
  // (200 > 100), i.e. this test encoded the bug as expected behaviour. Fixed
  // to assert the actual guarantee: enforcePromptLength trims the head too
  // when it alone exceeds the budget.
  it("BUG 6 fix: trims the head too when the head alone exceeds the budget (no longer returns an over-budget string)", () => {
    const head = "H".repeat(200);
    const p = enforcePromptLength(head, "tail", 100);
    expect(encodeURIComponent(p).length).toBeLessThanOrEqual(100);
    expect(p).toContain("…(truncated)");
    expect(p).not.toContain("tail");
  });
});

describe("resolveDefaultLaunchState (shared by launch button + terminal dock)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("prefers the user's saved localStorage config", () => {
    writeLaunchPath("idea-1", { mode: "existing", path: "/Users/me/projects/x" });
    expect(resolveDefaultLaunchState("idea-1", "My Idea", null)).toEqual({
      mode: "existing",
      path: "/Users/me/projects/x",
      parent: undefined,
      name: undefined,
    });
  });

  it("repo-backed idea → existing mode with an empty path (repo slug resolves the folder)", () => {
    expect(
      resolveDefaultLaunchState("idea-1", "My Idea", "https://github.com/acme/widget")
    ).toEqual({ mode: "existing", path: "" });
  });

  it("no repo → a new project under ~/projects/<slug>", () => {
    expect(resolveDefaultLaunchState("idea-1", "My First App", null)).toEqual({
      mode: "new",
      path: `${DEFAULT_NEW_PROJECT_PARENT}/my-first-app`,
      parent: DEFAULT_NEW_PROJECT_PARENT,
      name: "my-first-app",
    });
  });
});

// ── Recorded-path idea: prompt mode must MATCH the resolved cwd (the bug) ──────
// A no-repo idea whose folder is already recorded via record_project_path opens
// (via the deep link's cwd) in the right folder, but the bootstrap prompt still
// told the agent to mkdir/git-init from scratch. resolveDefaultLaunchState must
// now promote such an idea to existing mode so the compact prompt skips the
// create-folder block and instead confirms the already-open folder.
describe("recorded-path idea promotes to existing mode (prompt/cwd parity)", () => {
  const APP_URL = "https://vibecodes.co.uk";
  const IDEA_ID = "idea-recorded";
  const RECORDED = "/Users/nick/projects/my-idea";

  beforeEach(() => {
    window.localStorage.clear();
  });

  // Mirror exactly what the launch button does to build the compact deep-link
  // prompt for a no-repo idea: resolve the effective target from recorded paths,
  // resolve the default launch state (now target-aware), then build the parts.
  function compactPromptFor(
    recordedPaths: { absolute_path: string; hostname: string }[]
  ): string {
    const effectiveTarget = resolveEffectiveLaunchTarget({
      hasRepo: false,
      saved: null,
      recordedPaths,
    });
    const state = resolveDefaultLaunchState(IDEA_ID, "My Idea", null, effectiveTarget);
    const existingPath =
      state.mode === "existing" && state.path.trim() ? state.path.trim() : undefined;
    const newProject =
      state.mode === "new" ? { newProjectPath: state.path } : undefined;
    return buildCompactBootstrapPrompt({
      appUrl: APP_URL,
      ideaId: IDEA_ID,
      ideaTitle: "My Idea",
      mode: state.mode,
      repoUrl: null,
      newProject,
      existingPath,
    });
  }

  it("resolveDefaultLaunchState promotes a recorded no-repo idea to existing mode at that path", () => {
    const effectiveTarget = resolveEffectiveLaunchTarget({
      hasRepo: false,
      saved: null,
      recordedPaths: [{ absolute_path: RECORDED, hostname: "Nicks-MacBook" }],
    });
    expect(resolveDefaultLaunchState(IDEA_ID, "My Idea", null, effectiveTarget)).toEqual({
      mode: "existing",
      path: RECORDED,
    });
  });

  it("no-repo idea + exactly one recorded path → EXISTING-mode prompt: verify-folder, NO mkdir/git init", () => {
    const p = compactPromptFor([{ absolute_path: RECORDED, hostname: "Nicks-MacBook" }]);
    // Verify-folder language (already here, just confirm — don't re-init/clone).
    expect(p).toContain(`already be in ${RECORDED}`);
    expect(p).toMatch(/recorded from a previous session/i);
    expect(p).toMatch(/don't re-init or re-clone/i);
    // The whole point: no first-run create-folder block.
    expect(p).not.toContain("mkdir -p");
    expect(p).not.toContain("git init");
    expect(p).not.toContain("git clone");
    // Still drives the board.
    expect(p).toContain("get_board");
  });

  it("first-ever launch (no recorded path, no repo, no localStorage) → UNCHANGED first-run script (mkdir)", () => {
    const p = compactPromptFor([]);
    expect(p).toContain("mkdir -p");
    expect(p).toContain("git init");
    expect(p).not.toContain("already be in");
  });

  it("ambiguous >1 recorded paths → falls back to the first-run script (no promotion)", () => {
    const p = compactPromptFor([
      { absolute_path: "/Users/nick/x", hostname: "mac" },
      { absolute_path: "/home/nick/x", hostname: "linux" },
    ]);
    expect(p).toContain("mkdir -p");
    expect(p).not.toContain("already be in");
  });

  it("recorded-path deep link stays under MAX_DEEP_LINK_URL_LENGTH (with the cwd param)", () => {
    // Runs through the SAME runtime clamp the launch button applies (BUG1 fix)
    // — the raw, unclamped prompt for this fixture actually overflows once the
    // worktree-isolation protocol rides the head, so building the link without
    // the clamp (as this test used to) is no longer representative.
    const effectiveTarget = resolveEffectiveLaunchTarget({
      hasRepo: false,
      saved: null,
      recordedPaths: [{ absolute_path: RECORDED, hostname: "Nicks-MacBook" }],
    });
    const state = resolveDefaultLaunchState(IDEA_ID, "My Idea", null, effectiveTarget);
    const existingPath =
      state.mode === "existing" && state.path.trim() ? state.path.trim() : undefined;
    const link = buildClampedDeepLink(
      {
        appUrl: APP_URL,
        ideaId: IDEA_ID,
        ideaTitle: "My Idea",
        mode: state.mode,
        repoUrl: null,
        existingPath,
      },
      { cwd: RECORDED }
    );
    expect(link.length).toBeLessThanOrEqual(MAX_DEEP_LINK_URL_LENGTH);
  });

  it("a saved localStorage path (no repo) is NOT clobbered by an absent recorded path", () => {
    writeLaunchPath(IDEA_ID, { mode: "existing", path: "/Users/nick/pinned" });
    const effectiveTarget = resolveEffectiveLaunchTarget({
      hasRepo: false,
      saved: readLaunchPath(IDEA_ID),
      recordedPaths: [],
    });
    // Saved localStorage wins in resolveDefaultLaunchState (step 1), unchanged.
    expect(resolveDefaultLaunchState(IDEA_ID, "My Idea", null, effectiveTarget)).toEqual({
      mode: "existing",
      path: "/Users/nick/pinned",
      parent: undefined,
      name: undefined,
    });
  });
});

// ── Fix 2: the compact MCP-connect step must carry the skip clause in EVERY mode ─
describe("compact MCP-connect skip clause + record self-heal framing (Fix 2)", () => {
  const APP_URL = "https://vibecodes.co.uk";
  const MODES: Record<string, CompactBootstrapArgs> = {
    "new-no-repo": {
      appUrl: APP_URL,
      ideaId: "idea-1",
      ideaTitle: "My Idea",
      mode: "new",
      repoUrl: null,
      newProject: { newProjectPath: "~/projects/my-idea" },
    },
    "repo-backed": {
      appUrl: APP_URL,
      ideaId: "idea-1",
      ideaTitle: "My Idea",
      mode: "existing",
      repoUrl: "https://github.com/acme/widget",
    },
    "existing-recorded": {
      appUrl: APP_URL,
      ideaId: "idea-1",
      ideaTitle: "My Idea",
      mode: "existing",
      repoUrl: null,
      existingPath: "/Users/nick/projects/my-idea",
    },
    "existing-first-run": {
      appUrl: APP_URL,
      ideaId: "idea-1",
      ideaTitle: "My Idea",
      mode: "existing",
      repoUrl: null,
    },
  };

  it("the MCP-connect step carries the skip clause in every mode", () => {
    for (const [name, args] of Object.entries(MODES)) {
      const p = buildCompactBootstrapPrompt(args);
      expect(p, `mode ${name}`).toContain("already available, skip this step");
      expect(p, `mode ${name}`).toContain("claude mcp add");
    }
  });

  it("record_project_path is framed as re-confirm/self-heal, safe to repeat", () => {
    const p = buildCompactBootstrapPrompt(MODES["new-no-repo"]);
    expect(p).toContain("record_project_path");
    expect(p).toMatch(/re-confirm/i);
    expect(p).toMatch(/every launch/i);
  });

  // Uses a REALISTIC-length idea_id (36-char UUID) + title/path, not the tiny
  // "idea-1" placeholders above: the skip clause pushed the compact head up, and
  // a short-id fixture won't reveal a realistic overflow (the sibling
  // deep-link.test.ts vibecodes:// budget test caught exactly that regression).
  it("added skip clause keeps a realistic new-no-repo deep link under the URL cap", () => {
    const p = buildCompactBootstrapPrompt({
      appUrl: APP_URL,
      ideaId: "1beea99a-0377-421b-9a8b-a9956ae34b5d",
      ideaTitle: "Horse Racing Predictor",
      mode: "new",
      repoUrl: null,
      newProject: { newProjectPath: "~/projects/horse-racing-predictor" },
    });
    expect(buildClaudeDeepLink({ prompt: p }).length).toBeLessThanOrEqual(
      MAX_DEEP_LINK_URL_LENGTH
    );
  });
});

describe("resolveLaunchCwd (shared cwd rule: claude-cli:// + vibecodes:// launches)", () => {
  it("existing mode with a pinned path → that path, trimmed", () => {
    expect(
      resolveLaunchCwd({ mode: "existing", path: "  /Users/me/projects/x  " }, undefined)
    ).toBe("/Users/me/projects/x");
    // A pinned path wins even when an effective cwd is supplied.
    expect(
      resolveLaunchCwd({ mode: "existing", path: "/Users/me/projects/x" }, "/elsewhere")
    ).toBe("/Users/me/projects/x");
  });

  it("new mode → the caller's effective cwd (saved/recorded path), or none", () => {
    const state = { mode: "new" as const, path: "~/projects/my-idea" };
    expect(resolveLaunchCwd(state, "/Users/me/projects/my-idea")).toBe(
      "/Users/me/projects/my-idea"
    );
    // No effective cwd (e.g. the dock's payload-less fallback, which has no
    // recorded paths) → none; the prompt's directory step creates the folder.
    expect(resolveLaunchCwd(state, undefined)).toBeUndefined();
  });

  it("repo-backed (existing mode, empty path) → no cwd", () => {
    expect(resolveLaunchCwd({ mode: "existing", path: "" }, undefined)).toBeUndefined();
    expect(resolveLaunchCwd({ mode: "existing", path: "   " }, "/ignored")).toBeUndefined();
  });
});

// ── Concurrent-terminal auto-worktree isolation (docs/concurrent-terminal-worktrees-design.html) ──
//
// Builds on: Requirements (ProdOwner, Scope C: auto-isolate each ADDITIONAL
// concurrent session; first session unchanged FR-1; dirty/unpushed worktrees
// never deleted FR-6; degrade-don't-block FR-8) + UX Design (Compass, exact
// banner copy/glyphs §3) + Design Review (Nick, BINDING: mechanism (A)
// agent-side; sibling `<repo>.vibe/wt-N` on branch `vibe/wt-N`; PID-liveness
// lock via `kill -0`, not a heartbeat; lock OUTSIDE the repo at
// `~/.vibecodes/locks/<hash>`; reconcile/auto-prune clean leftovers on the
// next primary-claiming launch, dirty/unpushed always kept; never push/merge
// the primary branch from a worktree session).
describe("buildWorktreeIsolationProtocol", () => {
  describe("full variant (verbose/copy-command prompt — no URL ceiling)", () => {
    const p = buildWorktreeIsolationProtocol("full");

    it("computes the lock OUTSIDE the repo, under ~/.vibecodes/locks", () => {
      expect(p).toContain("~/.vibecodes/locks");
    });

    it("uses PID-liveness (kill -0), not a heartbeat TTL", () => {
      expect(p).toContain("kill -0");
    });

    it("names the sibling worktree home and branch scheme", () => {
      expect(p).toContain(".vibe/wt-N");
      expect(p).toContain("-b vibe/wt-N");
    });

    it("directs a worktree session to never push/merge the primary branch", () => {
      expect(p).toMatch(/never/i);
      expect(p).toMatch(/primary branch/i);
      expect(p).toContain("vibe/wt-N");
    });

    it("reconciles leftover worktrees: auto-prunes clean ones, always keeps dirty/unpushed", () => {
      expect(p).toMatch(/prune/i);
      expect(p).toMatch(/keep dirty\/unpushed/i);
      expect(p).toMatch(/never delete/i);
    });

    it("degrades (warns) rather than blocking when isolation is unavailable", () => {
      expect(p).toMatch(/not a git repo/i);
      expect(p).toContain("⚠ Shared folder");
      expect(p).toMatch(/Continuing anyway/i);
    });

    it("carries all four UX-design banner markers (glyph + word, never colour alone)", () => {
      expect(p).toContain("● Primary checkout");
      expect(p).toContain("⧉ Isolated worktree");
      expect(p).toContain("⚠ Shared folder");
      expect(p).toContain("✓ Worktree removed");
    });

    it("gives a recovery card for a kept worktree (resume/publish/discard)", () => {
      expect(p).toMatch(/resume/i);
      expect(p).toMatch(/publish/i);
      expect(p).toMatch(/discard/i);
      expect(p).toContain("git push -u origin vibe/wt-N");
      expect(p).toContain("git worktree remove <path> --force");
    });

    it("runs before any board work — placed as an imperative preamble", () => {
      expect(p.toLowerCase().indexOf("worktree isolation")).toBe(0);
    });
  });

  describe("compact variant (URL-capped deep-link / in-browser-terminal prompt)", () => {
    const p = buildWorktreeIsolationProtocol("compact");

    it("keeps every safety-critical invariant despite the terse rewrite", () => {
      expect(p).toContain("~/.vibecodes/locks");
      expect(p).toContain("kill -0");
      expect(p).toContain(".vibe/wt-N");
      expect(p).toContain("-b vibe/wt-N");
      expect(p).toMatch(/never/i);
      expect(p).toMatch(/primary/i);
      expect(p).toMatch(/prune/i);
      expect(p).toMatch(/keep dirty\/unpushed/i);
    });

    it("is materially shorter than the full variant (it must fit an OS URL ceiling)", () => {
      const full = buildWorktreeIsolationProtocol("full");
      expect(encodeURIComponent(p).length).toBeLessThan(encodeURIComponent(full).length / 4);
    });
  });

  it("defaults to the full variant when no argument is given", () => {
    expect(buildWorktreeIsolationProtocol()).toBe(buildWorktreeIsolationProtocol("full"));
  });
});

describe("worktree isolation protocol — wired into existing-mode/no-repo launches only", () => {
  const APP_URL = "https://vibecodes.co.uk";
  const MARKER = "WORKTREE ISOLATION";
  const COMPACT_MARKER = "LOCK=~/.vibecodes/locks";

  it("appears in the verbose board prompt for existing-mode/no-repo (the deep link's cwd, if any)", () => {
    const p = buildBoardBootstrapPrompt({
      appUrl: APP_URL,
      ideaId: "idea-1",
      ideaTitle: "My Idea",
      mode: "existing",
      repoUrl: null,
    });
    expect(p).toContain(MARKER);
    // Still preserves the rest of the existing-mode contract.
    expect(p).toContain("get_board");
  });

  it("appears in the verbose task prompt for existing-mode/no-repo", () => {
    const p = buildTaskBootstrapPrompt({
      appUrl: APP_URL,
      ideaId: "idea-1",
      taskId: "task-9",
      taskTitle: "Do the thing",
      mode: "existing",
      repoUrl: null,
    });
    expect(p).toContain(MARKER);
    expect(p).toContain("task_id: task-9");
  });

  it("is ABSENT from a repo-backed prompt (the repo slug resolves the folder — out of scope)", () => {
    const board = buildBoardBootstrapPrompt({
      appUrl: APP_URL,
      ideaId: "idea-1",
      ideaTitle: "My Idea",
      mode: "existing",
      repoUrl: "https://github.com/acme/widget",
    });
    expect(board).not.toContain(MARKER);

    const task = buildTaskBootstrapPrompt({
      appUrl: APP_URL,
      ideaId: "idea-1",
      taskId: "task-9",
      taskTitle: "Do the thing",
      mode: "existing",
      repoUrl: "https://github.com/acme/widget",
    });
    expect(task).not.toContain(MARKER);
  });

  it("is ABSENT from a create-new (mode: new) prompt — a fresh folder has no concurrent-session ambiguity yet", () => {
    const p = buildBoardBootstrapPrompt({
      appUrl: APP_URL,
      ideaId: "idea-1",
      ideaTitle: "My Idea",
      mode: "new",
      repoUrl: null,
      newProject: { newProjectPath: "/Users/me/projects/my-idea" },
    });
    expect(p).not.toContain(MARKER);
  });

  // Regression guard: useLaunchClaudeCode (mcp-connection-banner, setup-checklist,
  // onboarding-dialog) calls buildBoardBootstrapPrompt with mode "new" for a
  // repo-less idea but NEVER passes `newProject` — a caller shape distinct from
  // the launch button's. directoryBlock must not mistake that for the
  // existing-mode/no-repo case just because neither the newProject nor repo
  // branch matched.
  it("is ABSENT when mode is \"new\" but newProject is omitted (a distinct no-op caller shape, not existing-mode)", () => {
    const p = buildBoardBootstrapPrompt({
      appUrl: APP_URL,
      ideaId: "idea-1",
      ideaTitle: "My Idea",
      mode: "new",
      repoUrl: null,
    });
    expect(p).not.toContain(MARKER);
  });

  it("sits in the truncation-protected HEAD — survives even an absurdly long title", () => {
    const p = buildBoardBootstrapPrompt({
      appUrl: APP_URL,
      ideaId: "idea-1",
      ideaTitle: "T".repeat(8000),
      mode: "existing",
      repoUrl: null,
    });
    expect(p).toContain(MARKER);
    expect(p).toContain("claude mcp add"); // the other always-preserved head content
    expect(encodeURIComponent(p).length).toBeLessThanOrEqual(MAX_DEEP_LINK_PROMPT_LENGTH);
  });

  it("appears (compact form) in the compact/deep-link prompt when a cwd is known (existingPath set)", () => {
    const p = buildCompactBootstrapPrompt({
      appUrl: APP_URL,
      ideaId: "idea-1",
      ideaTitle: "My Idea",
      mode: "existing",
      repoUrl: null,
      existingPath: "/Users/nick/projects/my-idea",
    });
    expect(p).toContain(COMPACT_MARKER);
  });

  it("is ABSENT from the compact/deep-link prompt for a repo-backed idea", () => {
    const p = buildCompactBootstrapPrompt({
      appUrl: APP_URL,
      ideaId: "idea-1",
      ideaTitle: "My Idea",
      mode: "existing",
      repoUrl: "https://github.com/acme/widget",
    });
    expect(p).not.toContain(COMPACT_MARKER);
  });

  it("is ABSENT from the compact/deep-link prompt for create-new (mode: new)", () => {
    const p = buildCompactBootstrapPrompt({
      appUrl: APP_URL,
      ideaId: "idea-1",
      ideaTitle: "My Idea",
      mode: "new",
      repoUrl: null,
      newProject: { newProjectPath: "~/projects/my-idea" },
    });
    expect(p).not.toContain(COMPACT_MARKER);
  });

  // Regression guard: a realistic idea (a real UUID id, a real title, a real
  // recorded machine path — none of the tiny placeholder fixtures elsewhere in
  // this file) must still fit under the OS deep-link ceiling once the isolation
  // directive rides the head. This is the scenario that first blew the budget
  // during development (short-id fixtures alone didn't catch it).
  it("a realistic existing-mode/no-repo deep link (real UUID + title + path) stays under MAX_DEEP_LINK_URL_LENGTH", () => {
    // Runs through the SAME runtime clamp the launch button applies (BUG1 fix).
    // The raw, unclamped prompt for this fixture DOES overflow once the
    // worktree-isolation protocol rides the head — that's exactly what QA
    // caught. The clamp is what keeps the final URL in bounds.
    const cwd = "/Users/nickball/projects/horse-racing-predictor";
    const link = buildClampedDeepLink(
      {
        appUrl: APP_URL,
        ideaId: "1beea99a-0377-421b-9a8b-a9956ae34b5d",
        ideaTitle: "Horse Racing Predictor",
        mode: "existing",
        repoUrl: null,
        existingPath: cwd,
      },
      { cwd }
    );
    expect(link.length).toBeLessThanOrEqual(MAX_DEEP_LINK_URL_LENGTH);
  });

  // BUG1 (release blocker) regression: the WORST-REALISTIC case QA repro'd —
  // an 80-char idea title, a ~85-char real absolute path (cloud-synced Mac
  // style), and a real UUID idea_id. Before the fix, openInClaudeCode/launch()
  // built the deep link from the UNCLAMPED head+tail string, so this exact
  // shape overflowed MAX_DEEP_LINK_URL_LENGTH (1991-2063 observed) and Chromium
  // silently refused to launch. The REWORK fix keeps the essentials (MCP
  // connect + record_project_path) path-length-independent and folds the
  // worktree protocol in only when it fits (fitCompactWorktreeProtocol).
  it("BUG1: worst-realistic case (80-char title + ~85-char real path + real UUID) fits under the cap, with the essentials/protocol surviving the clamp intact", () => {
    const cwd = "/Users/nicholasmarcusball/Library/CloudStorage/Dropbox/projects/horse-race-predictor";
    expect(cwd.length).toBeGreaterThanOrEqual(80);
    expect(cwd.length).toBeLessThanOrEqual(90);
    const title = "A".repeat(80);
    const ideaId = "1beea99a-0377-421b-9a8b-a9956ae34b5d";

    const args: CompactBootstrapArgs = {
      appUrl: APP_URL,
      ideaId,
      ideaTitle: title,
      mode: "existing",
      repoUrl: null,
      existingPath: cwd,
    };

    // Precondition of the REWORK fix design: the essentials-only HEAD (title
    // header + MCP-connect + record_project_path — truncation-protected, and
    // crucially NOT the raw-cwd echo or the protocol) must fit the URL budget
    // on its own regardless of cwd length, otherwise enforcePromptLength's
    // "never sacrifice the head" fallback would overflow the cap regardless
    // of clamping.
    const essentials = buildCompactPromptEssentials(args);
    const base = buildClaudeDeepLink({ prompt: "", cwd });
    const budget = MAX_DEEP_LINK_URL_LENGTH - base.length;
    expect(encodeURIComponent(essentials.head).length).toBeLessThanOrEqual(budget);

    const link = buildClampedDeepLink(args, { cwd });
    expect(link.length).toBeLessThanOrEqual(MAX_DEEP_LINK_URL_LENGTH);

    // At this (realistic) length the protocol comfortably fits alongside the
    // essentials, so every load-bearing token — the worktree-isolation
    // protocol (BUG2's restored clauses included) AND the MCP-connect step —
    // must survive verbatim inside the final URL.
    const decoded = decodeURIComponent(link.split("q=")[1]);
    for (const token of [
      "kill -0", // PID liveness (not a heartbeat)
      ".vibe/wt-N", // sibling worktree home
      "-b vibe/wt-N", // branch naming
      "never push primary", // never-push-primary directive
      "Not a git repo", // BUG2(a): not-a-git-repo degrade branch
      "path==$PWD", // BUG2(b): lock path-match tiebreak
      "lowest free N", // BUG2(c): lowest-free-N collision avoidance
      "git log @{u}", // BUG3: unpushed-detection command
      "git status --porcelain", // BUG5: explicit dirty gate
      "claude mcp add", // MCP-connect step (also head, also load-bearing)
    ]) {
      expect(decoded, `token "${token}" must survive the clamp`).toContain(token);
    }
  });

  // BUG1 REWORK — path-length SWEEP (replaces the single ~85-char boundary
  // case above, which is exactly what QA's re-fail showed was insufficient:
  // it passed at 1899/1900 but a ~169-char path overflowed). Sweeps cwd
  // lengths 50/100/150/200/250 x a normal (22-char) AND a long (80-char)
  // title — the full matrix the rework spec calls for — and asserts the
  // invariant that actually matters: the final claude-cli:// URL can NEVER
  // exceed MAX_DEEP_LINK_URL_LENGTH, and the essentials (MCP-connect +
  // record_project_path) are ALWAYS present, at every single length.
  describe("BUG1 REWORK: path-length sweep — URL never overflows, essentials always survive", () => {
    const ideaId = "1beea99a-0377-421b-9a8b-a9956ae34b5d";
    const CWD_LENGTHS = [50, 100, 150, 200, 250];
    const TITLE_LENGTHS = [22, 80];
    // The protocol's load-bearing tokens — checked as an all-or-nothing set so
    // a "present" verdict below means the WHOLE protocol survived, never a
    // fragment split by the tail's truncation ellipsis.
    const PROTOCOL_TOKENS = ["kill -0", ".vibe/wt-N", "-b vibe/wt-N", "never push primary"];

    // A realistic nested absolute path padded/truncated to an exact length —
    // mirrors the corporate cloud-sync paths (OneDrive/Dropbox-style, deeply
    // nested) QA's repro used, not a flat run of one character.
    function realisticCwd(length: number): string {
      const base = "/Users/nicholasmarcusball/Library/CloudStorage/OneDrive-Corp/projects/";
      if (base.length >= length) return base.slice(0, length);
      return base + "x".repeat(length - base.length);
    }

    for (const cwdLen of CWD_LENGTHS) {
      for (const titleLen of TITLE_LENGTHS) {
        it(`cwd=${cwdLen} chars, title=${titleLen} chars: URL <= cap, essentials present, protocol all-or-nothing`, () => {
          const cwd = realisticCwd(cwdLen);
          const title = "T".repeat(titleLen);
          const args: CompactBootstrapArgs = {
            appUrl: APP_URL,
            ideaId,
            ideaTitle: title,
            mode: "existing",
            repoUrl: null,
            existingPath: cwd,
          };

          const link = buildClampedDeepLink(args, { cwd });
          // (a) NEVER overflow — the core BUG1 REWORK invariant.
          expect(link.length, `cwd=${cwdLen} title=${titleLen}`).toBeLessThanOrEqual(
            MAX_DEEP_LINK_URL_LENGTH
          );

          const decoded = decodeURIComponent(link.split("q=")[1]);
          // (b) essentials ALWAYS present, regardless of length.
          expect(decoded, `cwd=${cwdLen} title=${titleLen}`).toContain("claude mcp add");
          expect(decoded, `cwd=${cwdLen} title=${titleLen}`).toContain("record_project_path");

          // (c) the protocol is ALL-OR-NOTHING: either every load-bearing
          // token from it is present, or NONE of them are (a clean omission,
          // never a fragment split mid-protocol by the tail's truncation
          // ellipsis — the ellipsis MAY legitimately appear elsewhere, e.g.
          // trimming the confirm-echo/work tail, which is fine).
          const presentCount = PROTOCOL_TOKENS.filter((t) => decoded.includes(t)).length;
          expect(
            [0, PROTOCOL_TOKENS.length],
            `cwd=${cwdLen} title=${titleLen}: protocol must be all-or-nothing, found ${presentCount}/${PROTOCOL_TOKENS.length} tokens`
          ).toContain(presentCount);
        });
      }
    }

    // Self-contained (doesn't depend on the parameterized its above having
    // run first / shared mutable state) — recomputes the same matrix and
    // prints it as the path-length -> URL-length -> protocol-present table
    // for the write-up, doubling as a belt-and-braces summary assertion.
    it("table: every sweep length keeps the URL under the cap with the protocol present (path-length-independent essentials never NEED to degrade in this realistic range)", () => {
      const rows = CWD_LENGTHS.flatMap((cwdLen) =>
        TITLE_LENGTHS.map((titleLen) => {
          const cwd = realisticCwd(cwdLen);
          const args: CompactBootstrapArgs = {
            appUrl: APP_URL,
            ideaId,
            ideaTitle: "T".repeat(titleLen),
            mode: "existing",
            repoUrl: null,
            existingPath: cwd,
          };
          const link = buildClampedDeepLink(args, { cwd });
          const decoded = decodeURIComponent(link.split("q=")[1]);
          const protocolPresent = PROTOCOL_TOKENS.every((t) => decoded.includes(t));
          return { cwdLen, titleLen, urlLen: link.length, protocolPresent };
        })
      );
      // Intentional: surfaces the sweep table in test output for the write-up.
      console.table(rows);
      expect(rows).toHaveLength(CWD_LENGTHS.length * TITLE_LENGTHS.length);
      for (const r of rows) {
        expect(r.urlLen, JSON.stringify(r)).toBeLessThanOrEqual(MAX_DEEP_LINK_URL_LENGTH);
        expect(r.protocolPresent, JSON.stringify(r)).toBe(true);
      }
    });
  });

  // BUG 6 (4th rework cycle) — dense-path sweep: QA found the sweep above
  // (realisticCwd, 50-250 chars) never actually exercises the shape that
  // overflowed in production. realisticCwd pads with a flat run of "x" at
  // the tail, so the path's slash COUNT stays fixed (~7, from the base
  // prefix) regardless of the final length — %2F's 3x URL-encoding expansion
  // (1 raw char -> 3 encoded) therefore contributes a roughly CONSTANT
  // overhead, collapsing as a proportion of the total at longer lengths. A
  // real deeply-nested path (corporate OneDrive/Dropbox syncs, monorepo
  // checkouts — many SHORT directory segments) has a slash COUNT that grows
  // PROPORTIONALLY with length, so its %2F overhead grows too. Confirmed via
  // manual probe against the pre-fix code: a 900- or 1200-char DENSE cwd
  // (this generator) blew the link out to 1899-2657 chars — i.e. this is the
  // actual pre-fix repro the flat-padding fixture missed; a flat cwd of the
  // same raw length never triggered the bug because its budget headroom
  // stayed comfortably positive.
  function denselyNestedCwd(length: number): string {
    const segment = "/nested-folder-name"; // one slash per 19 chars — a
    // realistic corporate-style segment length, but repeated so the slash
    // count (and therefore the %2F encoding overhead) grows WITH length,
    // unlike realisticCwd's fixed-slash-count flat padding above.
    let path = "";
    while (path.length < length) path += segment;
    return path.slice(0, length);
  }

  describe("BUG 6: dense-path sweep (repairs the flat-padding fixture's blind spot)", () => {
    const ideaId = "1beea99a-0377-421b-9a8b-a9956ae34b5d";
    const DENSE_CWD_LENGTHS = [900, 1200];
    const TITLE_LENGTHS = [22, 80];
    const PROTOCOL_TOKENS = ["kill -0", ".vibe/wt-N", "-b vibe/wt-N", "never push primary"];

    it("sanity: denselyNestedCwd's slash count grows WITH length (unlike realisticCwd's fixed-count flat padding)", () => {
      const at900 = denselyNestedCwd(900);
      const at1200 = denselyNestedCwd(1200);
      const slashes = (s: string) => (s.match(/\//g) ?? []).length;
      expect(slashes(at1200)).toBeGreaterThan(slashes(at900));
      // realisticCwd's slash count is ~7 REGARDLESS of length (see its own
      // fixed-prefix + flat-"x"-tail definition above) — this generator's
      // count is an order of magnitude higher and keeps growing.
      expect(slashes(at900)).toBeGreaterThan(40);
      expect(slashes(at1200)).toBeGreaterThan(55);
    });

    for (const cwdLen of DENSE_CWD_LENGTHS) {
      for (const titleLen of TITLE_LENGTHS) {
        it(`dense cwd=${cwdLen} chars, title=${titleLen} chars: URL never exceeds the cap, protocol all-or-nothing`, () => {
          const cwd = denselyNestedCwd(cwdLen);
          const title = "T".repeat(titleLen);
          const args: CompactBootstrapArgs = {
            appUrl: APP_URL,
            ideaId,
            ideaTitle: title,
            mode: "existing",
            repoUrl: null,
            existingPath: cwd,
          };

          const link = buildClampedDeepLink(args, { cwd });
          // (a) NEVER overflow — the core BUG 6 invariant, at the exact
          // lengths that overflowed (up to 2657 chars observed) before this
          // fix, per the manual probe referenced above.
          expect(link.length, `cwd=${cwdLen} title=${titleLen}`).toBeLessThanOrEqual(
            MAX_DEEP_LINK_URL_LENGTH
          );
          expect(link.startsWith("claude-cli://open?q=")).toBe(true);

          const decoded = decodeURIComponent(link.split("q=")[1] ?? "");
          // (b) the protocol is ALL-OR-NOTHING at every length: either every
          // load-bearing token from it is present, or none are — never a
          // fragment split mid-protocol by a truncation ellipsis.
          const presentCount = PROTOCOL_TOKENS.filter((t) => decoded.includes(t)).length;
          expect(
            [0, PROTOCOL_TOKENS.length],
            `cwd=${cwdLen} title=${titleLen}: protocol must be all-or-nothing, found ${presentCount}/${PROTOCOL_TOKENS.length}`
          ).toContain(presentCount);
        });
      }
    }

    // At 900 chars the essentials-only budget still comfortably exceeds the
    // essentials head's own size (879 vs 774-832 observed via probe), so both
    // record_project_path AND the MCP-connect step survive whole — only the
    // (best-effort) worktree protocol degrades. This is the "normal"
    // dense-path outcome: proportional slash growth changes the numbers, but
    // essentials priority still holds.
    it("at 900 dense chars, MCP-connect AND record_project_path essentials fully survive (protocol is what degrades first)", () => {
      for (const titleLen of TITLE_LENGTHS) {
        const cwd = denselyNestedCwd(900);
        const args: CompactBootstrapArgs = {
          appUrl: APP_URL,
          ideaId,
          ideaTitle: "T".repeat(titleLen),
          mode: "existing",
          repoUrl: null,
          existingPath: cwd,
        };
        const link = buildClampedDeepLink(args, { cwd });
        const decoded = decodeURIComponent(link.split("q=")[1] ?? "");
        expect(decoded, `title=${titleLen}`).toContain("claude mcp add");
        expect(decoded, `title=${titleLen}`).toContain("record_project_path");
      }
    });

    // At 1200 dense chars the cwd param ALONE (its own raw length, injected
    // verbatim into the URL's `cwd=` param outside the trimmable prompt)
    // consumes so much of the 1900-char ceiling that even the essentials-only
    // head (774-832 encoded chars) no longer fits the remaining budget
    // (~547-561 observed via probe) — a hard arithmetic wall no prompt-side
    // fix can rescue, since the cwd param itself is never trimmed. This is
    // FR-8's ultimate backstop: the URL still never overflows (asserted
    // above), and the HIGHEST-priority essential step (MCP-connect, numbered
    // first) is what survives the head-trim over the lower-priority
    // record_project_path step that follows it — never a protocol fragment,
    // never an over-cap link, even at this genuinely extreme length.
    //
    // FIX B (5th rework cycle, QA BUG B) rewrite: this test previously
    // asserted only the weak substring `toContain("claude mcp add")` — which
    // ALSO matches a FRAGMENT of the MCP-connect step (the pre-fix bug: the
    // decoded tail QA found ended mid-sentence, "...Authenticate in the
    // brow\n…(truncated)", yet still contained "claude mcp add" earlier in
    // the same cut-off step). Replaced with FULL-STEP-INTEGRITY checks via
    // assertStepWholeOrAbsent: every essential step in
    // essentials.headSteps is asserted to be present in its ENTIRE text, or
    // cleanly absent — never a fragment — at each pathological length.
    for (const cwdLen of [900, 1200, 1300, 1500]) {
      it(`at ${cwdLen} dense chars, essential steps degrade ATOMICALLY (whole step or clean absence, never a fragment) — MCP-connect is the last to drop`, () => {
        for (const titleLen of TITLE_LENGTHS) {
          const cwd = denselyNestedCwd(cwdLen);
          const args: CompactBootstrapArgs = {
            appUrl: APP_URL,
            ideaId,
            ideaTitle: "T".repeat(titleLen),
            mode: "existing",
            repoUrl: null,
            existingPath: cwd,
          };
          const essentials = buildCompactPromptEssentials(args);
          // headSteps[0] = MCP-connect (highest priority), headSteps[1] =
          // record_project_path — see buildCompactPromptEssentials.
          expect(essentials.headSteps, `cwd=${cwdLen} title=${titleLen}`).toHaveLength(2);
          const [mcpConnectStep, recordPathStep] = essentials.headSteps!;

          const link = buildClampedDeepLink(args, { cwd });
          expect(link.length, `cwd=${cwdLen} title=${titleLen}`).toBeLessThanOrEqual(
            MAX_DEEP_LINK_URL_LENGTH
          );

          const decoded = decodeQ(link);
          const mcpWhole = assertStepWholeOrAbsent(decoded, mcpConnectStep, `cwd=${cwdLen} title=${titleLen} MCP-connect`);
          const recordWhole = assertStepWholeOrAbsent(decoded, recordPathStep, `cwd=${cwdLen} title=${titleLen} record_project_path`);

          // Priority: record_project_path can only survive whole when
          // MCP-connect ALSO survived whole (MCP-connect is never sacrificed
          // to keep the lower-priority step).
          if (recordWhole) {
            expect(mcpWhole, `cwd=${cwdLen} title=${titleLen}: record_project_path survived without MCP-connect — priority inverted`).toBe(true);
          }

          // The protocol never rides at these lengths either — all-or-nothing still holds.
          for (const token of PROTOCOL_TOKENS) {
            expect(decoded, `token "${token}" must not be a stray fragment`).not.toContain(token);
          }
        }
      });
    }

    // At 900 dense chars specifically (the original cycle-4 fixture length,
    // title=80 — the tightest budget in the sweep), confirm the concrete
    // degrade shape referenced in the design notes above: BOTH essential
    // steps survive whole (only the best-effort protocol degrades at this
    // length) — the "normal" dense-path outcome.
    it("900 dense chars (title=80, the tightest realistic case) keeps both essential steps whole — only the protocol degrades", () => {
      const args: CompactBootstrapArgs = {
        appUrl: APP_URL,
        ideaId,
        ideaTitle: "T".repeat(80),
        mode: "existing",
        repoUrl: null,
        existingPath: denselyNestedCwd(900),
      };
      const essentials = buildCompactPromptEssentials(args);
      const decoded = decodeQ(buildClampedDeepLink(args, { cwd: denselyNestedCwd(900) }));
      expect(decoded).toContain(essentials.headSteps![0]);
      expect(decoded).toContain(essentials.headSteps![1]);
    });
  });

  // BUG1 REWORK — proves the omission branch of fitCompactWorktreeProtocol
  // actually engages (rather than being untested dead code) once the cwd is
  // long enough that protocol+essentials no longer fit the remaining URL
  // budget. This is deliberately OUTSIDE the 50-250 "realistic" sweep above —
  // that sweep shows the fix keeps the protocol comfortably included for
  // every length QA's corporate-cloud-sync repro named; this test shows the
  // FR-8 safety net still holds for a length where it genuinely can't fit.
  it("BUG1 REWORK: an extreme cwd that can't fit the protocol degrades cleanly — essentials survive, protocol omitted whole, URL never overflows", () => {
    const cwd = "/Users/nicholasmarcusball/Library/CloudStorage/" + "x".repeat(760);
    const args: CompactBootstrapArgs = {
      appUrl: APP_URL,
      ideaId: "1beea99a-0377-421b-9a8b-a9956ae34b5d",
      ideaTitle: "T".repeat(22),
      mode: "existing",
      repoUrl: null,
      existingPath: cwd,
    };

    const essentials = buildCompactPromptEssentials(args);
    expect(essentials.protocol).toBeTruthy();

    const link = buildClampedDeepLink(args, { cwd });
    expect(link.length).toBeLessThanOrEqual(MAX_DEEP_LINK_URL_LENGTH);

    const decoded = decodeURIComponent(link.split("q=")[1]);
    expect(decoded).toContain("claude mcp add");
    expect(decoded).toContain("record_project_path");
    // The protocol was requested but must be CLEANLY absent — not a fragment.
    // (A trailing "…(truncated)" marker MAY legitimately appear if the tail —
    // the confirm-echo/work step — also had to shrink; that's unrelated to
    // protocol integrity, which is what this test is about.)
    for (const token of ["kill -0", ".vibe/wt-N", "-b vibe/wt-N", "never push primary"]) {
      expect(decoded, `token "${token}" must NOT be a stray fragment`).not.toContain(token);
    }
  });

  // BUG1 REWORK — direct unit test of the shared pure helper itself (not
  // routed through a whole deep link), proving the three decision branches in
  // isolation: protocol fits whole -> included; doesn't fit -> cleanly
  // omitted (never a half-truncated fragment); no protocol candidate at all
  // -> plain essentials clamp. Exercises openInClaudeCode's and launch()'s
  // SHARED logic directly.
  describe("fitCompactWorktreeProtocol (shared pure helper)", () => {
    // Synthetic (not real-content) essentials so budgets can be reasoned about
    // exactly, independent of the actual prose length of any given prompt.
    const essentials: CompactPromptEssentials = {
      head: "HEAD\n",
      tail: "TAIL",
      protocol: "PROTOCOL_BLOCK",
    };

    it("includes the protocol whole when it fits the budget", () => {
      const out = fitCompactWorktreeProtocol(essentials, 1000);
      expect(out).toContain("PROTOCOL_BLOCK");
      expect(out).toContain("HEAD");
      expect(out).toContain("TAIL");
    });

    it("omits the protocol entirely (not a fragment) when the budget can't fit it", () => {
      // "HEAD\nTAIL" alone is 9 chars; "PROTOCOL_BLOCK\n\nHEAD\n" alone is 21 —
      // a budget of 12 fits the essentials but not essentials+protocol.
      const out = fitCompactWorktreeProtocol(essentials, 12);
      expect(out).not.toContain("PROTOCOL_BLOCK");
      expect(out).not.toContain("PROTOCOL"); // no fragment either
      expect(out).toContain("HEAD");
      expect(encodeURIComponent(out).length).toBeLessThanOrEqual(12);
    });

    // BUG 6 fix (4th rework cycle): this test's comment previously claimed a
    // vanishingly small budget "still returns the essentials head rather than
    // truncating it" — that described the OLD bug (enforcePromptLength's
    // "never sacrifice the head" branch returning "HEAD\n" verbatim, 7 encoded
    // chars, over the 2-char budget here). Now that enforcePromptLength
    // guarantees encodedLength <= cap in ALL cases, a budget too small even
    // for the essentials head trims THAT too — down to nothing usable at
    // budget=2 (smaller than even the truncation marker), so this returns "".
    // The invariant that actually matters, and is now assertable, is the cap
    // itself: the protocol must never appear, AND the result must never
    // exceed the budget.
    it("never lets the protocol-inclusive candidate through, and never exceeds the budget itself, even for a pathologically tiny budget", () => {
      const out = fitCompactWorktreeProtocol(essentials, 2);
      expect(out).not.toContain("PROTOCOL_BLOCK");
      expect(out).not.toContain("PROTOCOL");
      expect(encodeURIComponent(out).length).toBeLessThanOrEqual(2);
    });

    it("passes straight through to enforcePromptLength when there's no protocol candidate", () => {
      const noProtocol: CompactPromptEssentials = { head: "HEAD\n", tail: "TAIL" };
      const out = fitCompactWorktreeProtocol(noProtocol, MAX_DEEP_LINK_PROMPT_LENGTH);
      expect(out).toBe(
        enforcePromptLength(noProtocol.head, noProtocol.tail, MAX_DEEP_LINK_PROMPT_LENGTH)
      );
    });

    it("real-content sanity check: a roomy budget includes the real compact protocol", () => {
      const real = buildCompactPromptEssentials({
        appUrl: APP_URL,
        ideaId: "idea-1",
        ideaTitle: "My Idea",
        mode: "existing",
        repoUrl: null,
        existingPath: "/Users/nick/projects/my-idea",
      });
      expect(real.protocol).toBeTruthy();
      const out = fitCompactWorktreeProtocol(real, MAX_DEEP_LINK_PROMPT_LENGTH);
      expect(out).toContain("kill -0");
      expect(out).toContain(real.protocol!);
    });
  });

  // BUG1 REWORK — the essentials head must never echo the raw cwd (the
  // duplication mechanism behind the overflow): CompactPromptEssentials.head
  // is the SAME length regardless of how long existingPath is, unlike
  // CompactPromptParts.head (buildCompactBootstrapPromptParts), which grows
  // with the path.
  it("BUG1 REWORK: essentials head is path-length-independent (no raw-cwd echo)", () => {
    const shortPath = "/short-marker-xyz";
    const longPath =
      "/Users/nicholasmarcusball/Library/CloudStorage/OneDrive-Corp-marker-xyz/very/deeply/nested/projects/dir";
    const short = buildCompactPromptEssentials({
      appUrl: APP_URL,
      ideaId: "idea-1",
      ideaTitle: "My Idea",
      mode: "existing",
      repoUrl: null,
      existingPath: shortPath,
    });
    const long = buildCompactPromptEssentials({
      appUrl: APP_URL,
      ideaId: "idea-1",
      ideaTitle: "My Idea",
      mode: "existing",
      repoUrl: null,
      existingPath: longPath,
    });
    expect(long.head).toBe(short.head);
    expect(short.head).not.toContain("marker-xyz");
    expect(long.head).not.toContain("marker-xyz");
    // The old (unconditional) builder, by contrast, DOES grow with the path —
    // proving this is a genuinely new, narrower contract, not a no-op refactor.
    const shortParts = buildCompactBootstrapPromptParts({
      appUrl: APP_URL,
      ideaId: "idea-1",
      ideaTitle: "My Idea",
      mode: "existing",
      repoUrl: null,
      existingPath: shortPath,
    });
    const longParts = buildCompactBootstrapPromptParts({
      appUrl: APP_URL,
      ideaId: "idea-1",
      ideaTitle: "My Idea",
      mode: "existing",
      repoUrl: null,
      existingPath: longPath,
    });
    expect(longParts.head.length).toBeGreaterThan(shortParts.head.length);
  });
});

// ── FIX A (5th rework cycle, QA BUG A): cwd is unclamped — buildBoundedDeepLink ──
describe("FIX A: buildBoundedDeepLink (cwd param unclamped, QA BUG A)", () => {
  // Reuses the SAME dense-nested-path generator as the BUG 6 sweep above (a
  // realistic corporate OneDrive/Dropbox-style deeply-nested path, NOT flat
  // padding) — this is the exact shape QA's repro used, just swept further
  // (up to 2500 raw chars) than BUG 6's 900/1200 ceiling, because BUG A's own
  // repro needed ~1650+ chars to actually blow the `cwd=` param past the cap
  // even at an EMPTY prompt (budget going NEGATIVE, not just tight).
  function denselyNestedCwd(length: number): string {
    const segment = "/nested-folder-name";
    let path = "";
    while (path.length < length) path += segment;
    return path.slice(0, length);
  }

  const ideaId = "1beea99a-0377-421b-9a8b-a9956ae34b5d";
  const DENSE_CWD_LENGTHS = [1300, 1500, 1650, 1700, 2000, 2500];
  const TITLE_LENGTHS = [22, 80];

  describe("openInClaudeCode's logic (claude-cli:// scheme, via buildClampedDeepLinkResult)", () => {
    for (const cwdLen of DENSE_CWD_LENGTHS) {
      for (const titleLen of TITLE_LENGTHS) {
        for (const repoMode of ["existing", "no-repo"] as const) {
          it(`cwd=${cwdLen} dense chars, title=${titleLen}, ${repoMode}: fired URL (if any) never exceeds the cap`, () => {
            const cwd = denselyNestedCwd(cwdLen);
            const args: CompactBootstrapArgs = {
              appUrl: APP_URL,
              ideaId,
              ideaTitle: "T".repeat(titleLen),
              mode: "existing",
              repoUrl: null,
              existingPath: cwd,
            };
            const extra = repoMode === "existing" ? { cwd } : { cwd, repo: undefined };
            const result = buildClampedDeepLinkResult(args, extra);

            if (!result.ok) {
              // Tier 4 (toast) — the caller must NOT fire an over-cap URL.
              // There's nothing further to assert about a URL that was never
              // built; this branch existing at all (rather than always
              // firing something, possibly over-cap) IS the invariant.
              return;
            }

            // The REQUIRED invariant, at ANY cwd length: the fired URL never
            // exceeds the cap.
            expect(result.url.length, `cwd=${cwdLen} title=${titleLen}`).toBeLessThanOrEqual(
              MAX_DEEP_LINK_URL_LENGTH
            );

            if (result.droppedCwd) {
              // cwd was dropped from the `cwd=` param. Either the FULL raw
              // cwd string survived verbatim inside the prompt as a `cd`
              // line (never a fragment — no partial-path substring), or the
              // `cd` line was omitted entirely (the folder-less minimal
              // launch — a legitimate, unremarkable outcome, identical in
              // shape to today's ordinary first-launch/no-cwd flow).
              //
              // Fragment detection is scoped to the `cd '<opening>` MARKER
              // specifically, NOT a bare cwd-prefix substring — the
              // (deliberately trimmable, per the KEEP list) directory-echo
              // TAIL step ("You should already be in <path>...") also
              // legitimately echoes the raw cwd and CAN be truncated by
              // enforcePromptLength's ordinary tail-trim; that is expected,
              // unrelated behaviour, not a cd-line fragment.
              expect(result.url).not.toContain("cwd=");
              const decoded = decodeQ(result.url);
              const cdOpeningMarker = `cd '${cwd.slice(0, 20)}`;
              if (decoded.includes(cdOpeningMarker)) {
                expect(decoded, "a partially-present cd-line marker must mean the FULL path survived (cd line never fragments)").toContain(`cd '${cwd}'`);
              }
            }
          });
        }
      }
    }
  });

  // fireLaunchDeepLink's logic (vibecodes:// scheme) differs only in its
  // fixed per-link overhead (relay/session/token) and the `promptKeyOverhead`
  // for the optional `&prompt=` key — exercise the SAME sweep through that
  // shape directly via buildBoundedDeepLink, mirroring terminal-dock.tsx's
  // fireLaunchDeepLink exactly (down to the promptKeyOverhead).
  describe("fireLaunchDeepLink's logic (vibecodes:// scheme, via buildBoundedDeepLink directly)", () => {
    const relay = "wss://relay.vibecodes.co.uk";
    const session = "0123456789abcdef0123456789abcdef";
    const token = "a".repeat(120); // HMAC-signed bridge token — realistically long

    function buildVibecodesLink(parts: { prompt: string; cwd?: string }): string {
      const p = [
        `relay=${encodeURIComponent(relay)}`,
        `session=${encodeURIComponent(session)}`,
        `token=${encodeURIComponent(token)}`,
      ];
      if (parts.cwd) p.push(`cwd=${encodeURIComponent(parts.cwd)}`);
      if (parts.prompt) p.push(`prompt=${encodeURIComponent(parts.prompt)}`);
      return `vibecodes://launch?${p.join("&")}`;
    }

    const MAX_LAUNCH_URL_LENGTH = 2048;

    for (const cwdLen of DENSE_CWD_LENGTHS) {
      for (const titleLen of TITLE_LENGTHS) {
        it(`cwd=${cwdLen} dense chars, title=${titleLen}: fired URL (if any) never exceeds the vibecodes:// cap`, () => {
          const cwd = denselyNestedCwd(cwdLen);
          const args: CompactBootstrapArgs = {
            appUrl: APP_URL,
            ideaId,
            ideaTitle: "T".repeat(titleLen),
            mode: "existing",
            repoUrl: null,
            existingPath: cwd,
          };
          const essentials = buildCompactPromptEssentials(args);
          const result = buildBoundedDeepLink({
            essentials,
            cwd,
            cap: MAX_LAUNCH_URL_LENGTH,
            promptKeyOverhead: "&prompt=".length,
            buildLink: buildVibecodesLink,
          });

          if (!result.ok) return; // toast path — no URL to check.

          expect(result.url.length, `cwd=${cwdLen} title=${titleLen}`).toBeLessThanOrEqual(
            MAX_LAUNCH_URL_LENGTH
          );
          if (result.droppedCwd) {
            expect(result.url).not.toContain("&cwd=");
          }
        });
      }
    }
  });

  // Direct unit tests of the shared helper with SYNTHETIC essentials —
  // exercises all four degrade tiers deterministically (not dependent on the
  // real prose length of any given prompt), mirroring how
  // fitCompactWorktreeProtocol's own synthetic-essentials tests work above.
  describe("buildBoundedDeepLink (synthetic essentials — deterministic tier boundaries)", () => {
    const essentials: CompactPromptEssentials = {
      header: "HEADER",
      headSteps: ["STEP_ONE_MCP_CONNECT", "STEP_TWO_RECORD_PATH"],
      head: "HEADER\n\n1. STEP_ONE_MCP_CONNECT\n2. STEP_TWO_RECORD_PATH\n",
      tail: "3. WORK",
    };

    function buildLink(parts: { prompt: string; cwd?: string }): string {
      const p = [`q=${encodeURIComponent(parts.prompt)}`];
      if (parts.cwd) p.push(`cwd=${encodeURIComponent(parts.cwd)}`);
      return `scheme://open?${p.join("&")}`;
    }

    it("tier 1: cwd rides its own param when it comfortably fits", () => {
      const result = buildBoundedDeepLink({ essentials, cwd: "/short/path", cap: 500, buildLink });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.droppedCwd).toBe(false);
        expect(result.url).toContain("cwd=%2Fshort%2Fpath");
        expect(result.url.length).toBeLessThanOrEqual(500);
      }
    });

    it("tier 2: cwd param alone exceeds the cap -> dropped, cd line folded in whole", () => {
      const cwd = "/" + "x".repeat(300);
      const result = buildBoundedDeepLink({ essentials, cwd, cap: 400, buildLink });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.url.length).toBeLessThanOrEqual(400);
        expect(result.url).not.toContain("cwd=");
        if (result.droppedCwd) {
          const decoded = decodeURIComponent(result.url.split("q=")[1] ?? "");
          // Never a fragment: the full cwd string appears, or the cd line
          // doesn't ride at all (tier 3) — but at cap=400 with a 301-char
          // cwd there's ample room for header+steps+cd, so it should ride.
          if (decoded.includes("cd '")) {
            expect(decoded).toContain(`cd '${cwd}'`);
          }
        }
      }
    });

    it("tier 3: cd line itself can't fit alongside essentials -> folder-less minimal launch fires anyway", () => {
      const cwd = "/" + "x".repeat(2000);
      const result = buildBoundedDeepLink({ essentials, cwd, cap: 300, buildLink });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.url.length).toBeLessThanOrEqual(300);
        expect(result.droppedCwd).toBe(true);
        expect(result.url).not.toContain("cwd=");
        expect(result.url).not.toContain("x".repeat(50)); // no fragment of the huge path
      }
    });

    it("tier 4 (toast): even a folder-less minimal launch can't fit -> ok:false, no URL", () => {
      // A cap smaller than the buildLink's own fixed literal overhead
      // ("scheme://open?q=") can never be satisfied, with or without a cwd.
      const result = buildBoundedDeepLink({ essentials, cwd: "/whatever", cap: 5, buildLink });
      expect(result.ok).toBe(false);
    });

    it("never returns ok:true with a url over cap, across a budget sweep", () => {
      const cwd = "/" + "nested-segment/".repeat(150); // ~2400 raw chars
      for (const cap of [20, 50, 100, 200, 400, 800, 1900, 2048]) {
        const result = buildBoundedDeepLink({ essentials, cwd, cap, buildLink });
        if (result.ok) {
          expect(result.url.length, `cap=${cap}`).toBeLessThanOrEqual(cap);
        }
      }
    });

    it("without a cwd at all, behaves exactly like fitCompactWorktreeProtocol (tier 1 with cwd undefined)", () => {
      const result = buildBoundedDeepLink({ essentials, cwd: undefined, cap: 500, buildLink });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.droppedCwd).toBe(false);
        expect(result.url).not.toContain("cwd=");
      }
    });
  });
});

// ── BUG5 (FR-6 hardening): explicit dirty gate + never --force during auto-prune ──
describe("BUG5: explicit dirty gate + never `--force` during auto-prune (FR-6 hardening)", () => {
  it("full variant adds an explicit `git status --porcelain` dirty check as a KEEP condition", () => {
    const p = buildWorktreeIsolationProtocol("full");
    expect(p).toContain("git status --porcelain");
    // Plainly states: never auto-prune-force, dirty/unpushed always means KEEP.
    expect(p).toMatch(/never run `git worktree remove --force` during auto-prune/i);
    expect(p).toMatch(/git status --porcelain.*means KEEP|means KEEP/i);
  });

  it("full variant's auto-prune --force ban is distinct from the human recovery card's --force (which still legitimately offers it)", () => {
    const p = buildWorktreeIsolationProtocol("full");
    // The recovery card still tells a HUMAN how to discard a kept worktree.
    expect(p).toContain("git worktree remove <path> --force");
    // The auto-prune ban is a separate, explicit sentence.
    expect(p).toContain("git worktree remove --force` during auto-prune");
  });

  it("compact variant carries the same dirty gate + never-force-during-auto-prune directive", () => {
    const p = buildWorktreeIsolationProtocol("compact");
    expect(p).toContain("git status --porcelain");
    expect(p).toMatch(/never git worktree remove --force during auto-prune/i);
  });

  it("compact variant remains materially shorter than the full variant despite the BUG5 addition", () => {
    const full = buildWorktreeIsolationProtocol("full");
    const compact = buildWorktreeIsolationProtocol("compact");
    expect(encodeURIComponent(compact).length).toBeLessThan(encodeURIComponent(full).length / 4);
  });
});
