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
  fitCompactEssentials,
  resolveDefaultLaunchState,
  resolveLaunchCwd,
  parseRepoFromGithubUrl,
  validateFolderName,
  looksAbsolutePath,
  isValidAbsolutePath,
  isPlausibleProjectPath,
  chooseLaunchCwd,
  resolveEffectiveLaunchTarget,
  composeNewProjectPath,
  buildBoardBootstrapPrompt,
  buildTaskBootstrapPrompt,
  buildLaunchCommand,
  readLaunchPath,
  writeLaunchPath,
  clearLaunchPathPin,
  launchPathKey,
  slugifyIdeaTitle,
  DEFAULT_NEW_PROJECT_PARENT,
  mergeRecordedPath,
  decidePinMigration,
  MANUAL_PIN_HOSTNAME,
} from "./launch-claude-code";

const APP_URL = "https://staging.vibecodes.co.uk";

/**
 * Mirrors EXACTLY what the launch button / useLaunchClaudeCode now do to build
 * the claude-cli:// deep link. FIX A (5th rework cycle, QA BUG A) rewrite:
 * routed through buildBoundedDeepLink — the SAME shared helper
 * openInClaudeCode/fireLaunchDeepLink now call — instead of the OLD
 * hand-rolled "budget = cap - base.length; prompt =
 * fitCompactEssentials(...)" sequence, which is exactly the code shape
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

  // Card 4cdcb33a: a fresh session's "find work" instruction must never pick up
  // a task another live session is already driving. To Do/Backlog were only a
  // *preference* before this fix — never an explicit exclusion — so a session
  // could "helpfully" grab an In Progress/Blocked/Verify task that looked
  // interrupted. Assert the actual exclusion wording, not just "To Do"/"Backlog"
  // presence (those pass before AND after the fix and prove nothing).
  it("explicitly excludes In Progress/Blocked/Verify tasks from the find-work step", () => {
    // mode "existing" + repoUrl (repo-backed dir block) rather than the
    // no-repo "existing" fixture used above — that one triggers the full
    // worktree-isolation protocol text, which alone can consume the whole
    // 5000-char budget and truncate the trimmable work tail before this
    // sentence, unrelated to this fix (pre-existing budget behavior, not
    // something this test is about).
    const p = buildBoardBootstrapPrompt({
      appUrl: APP_URL,
      ideaId: "idea-1",
      ideaTitle: "My Idea",
      mode: "existing",
      repoUrl: "https://github.com/acme/widget",
    });
    expect(p).toContain("Only ever pick a task from To Do or Backlog");
    expect(p).toMatch(/NEVER touch a task already in In Progress, Blocked, or Verify/);
    expect(p).toMatch(/Another live session may be actively working it right now/);
  });

  // Card bd018a86: the verbose (copy-command) board prompt gets the same
  // ask-first gate as the compact deep-link one — a fresh session must offer
  // the next task and wait, not assign and start it unprompted.
  it("board prompt asks before starting, and blocks any board write until answered", () => {
    const p = buildBoardBootstrapPrompt({
      appUrl: APP_URL,
      ideaId: "idea-1",
      ideaTitle: "My Idea",
      mode: "existing",
      repoUrl: "https://github.com/acme/widget",
    });
    expect(p).toMatch(/ASK me first, don't just start/);
    expect(p).toMatch(/STOP and ask me/);
    expect(p).toMatch(/Wait for my reply/);
    expect(p).toMatch(/Do NOT call get_task, assign, move or start anything before I answer/);
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

  // clearLaunchPathPin: what useLaunchPathPinMigration calls after a successful
  // migration so the pin stops being read (and re-migrated) on the next load.
  it("clearLaunchPathPin removes the stored entry", () => {
    writeLaunchPath("idea-1", { mode: "existing", path: "/Users/me/x" });
    expect(readLaunchPath("idea-1")).not.toBeNull();
    clearLaunchPathPin("idea-1");
    expect(readLaunchPath("idea-1")).toBeNull();
  });

  it("clearLaunchPathPin is a safe no-op when nothing is stored", () => {
    expect(() => clearLaunchPathPin("idea-with-nothing-stored")).not.toThrow();
    expect(readLaunchPath("idea-with-nothing-stored")).toBeNull();
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

describe("isPlausibleProjectPath", () => {
  it("rejects the filesystem root and top-level folders", () => {
    expect(isPlausibleProjectPath("/")).toBe(false);
    expect(isPlausibleProjectPath("//")).toBe(false);
    expect(isPlausibleProjectPath("/ ")).toBe(false);
    expect(isPlausibleProjectPath("/tmp")).toBe(false);
    expect(isPlausibleProjectPath("/Users")).toBe(false);
    expect(isPlausibleProjectPath("/opt")).toBe(false);
  });

  it("rejects home directories", () => {
    expect(isPlausibleProjectPath("/Users/nick")).toBe(false);
    expect(isPlausibleProjectPath("/Users/nick/")).toBe(false);
    expect(isPlausibleProjectPath("/home/nick")).toBe(false);
    expect(isPlausibleProjectPath("/root")).toBe(false);
  });

  it("rejects Windows drive roots and Windows home directories", () => {
    expect(isPlausibleProjectPath("C:\\")).toBe(false);
    expect(isPlausibleProjectPath("C:/")).toBe(false);
    expect(isPlausibleProjectPath("C:\\Users\\nick")).toBe(false);
  });

  it("rejects a UNC share with nothing after it", () => {
    expect(isPlausibleProjectPath("\\\\server\\share")).toBe(false);
  });

  it("rejects everything isValidAbsolutePath rejects", () => {
    expect(isPlausibleProjectPath("~")).toBe(false);
    expect(isPlausibleProjectPath("~/x")).toBe(false);
    expect(isPlausibleProjectPath("$HOME/x")).toBe(false);
    expect(isPlausibleProjectPath("relative/x")).toBe(false);
    expect(isPlausibleProjectPath("")).toBe(false);
    expect(isPlausibleProjectPath("   ")).toBe(false);
  });

  it("accepts real project folders", () => {
    expect(isPlausibleProjectPath("/Users/nick/projects/x")).toBe(true);
    expect(isPlausibleProjectPath("/home/nick/code/x")).toBe(true);
    expect(isPlausibleProjectPath("/opt/app")).toBe(true);
  });

  it("accepts with a trailing slash and surrounding whitespace", () => {
    expect(isPlausibleProjectPath("/Users/nick/projects/x/")).toBe(true);
    expect(isPlausibleProjectPath("  /Users/nick/x  ")).toBe(true);
  });

  it("accepts Windows and UNC project paths", () => {
    expect(isPlausibleProjectPath("C:\\Users\\nick\\x")).toBe(true);
    expect(isPlausibleProjectPath("D:/code")).toBe(true);
    expect(isPlausibleProjectPath("\\\\server\\share\\proj")).toBe(true);
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

  // Regression: production data shows a user launching the same idea from two
  // machines whose project folder happens to live at the identical absolute
  // path (e.g. two Macs both under /Users/nick/projects/<slug>) — that's 2
  // records but 0 ambiguity, since either machine opens the same place.
  it("2 records, same absolute path, different hostnames → dedupes to that one path", () => {
    expect(
      chooseLaunchCwd([
        { absolute_path: "/Users/nickball/projects/balla-bot", hostname: "Nicks-MacBook-Pro.local" },
        { absolute_path: "/Users/nickball/projects/balla-bot", hostname: "Nicks-MBP.home.local" },
      ])
    ).toBe("/Users/nickball/projects/balla-bot");
  });

  it("2 records, same path after trimming whitespace → still dedupes", () => {
    expect(
      chooseLaunchCwd([
        { absolute_path: "/Users/nick/x", hostname: "mac-a" },
        { absolute_path: "  /Users/nick/x  ", hostname: "mac-b" },
      ])
    ).toBe("/Users/nick/x");
  });

  it("3 records, 2 sharing a path + 1 different → still >1 DISTINCT paths, undefined", () => {
    expect(
      chooseLaunchCwd([
        { absolute_path: "/Users/nick/x", hostname: "mac-a" },
        { absolute_path: "/Users/nick/x", hostname: "mac-b" },
        { absolute_path: "/home/nick/x", hostname: "linux" },
      ])
    ).toBeUndefined();
  });

  // ── rule 1: this machine's own row wins ───────────────────────────────────
  // idea_project_paths is keyed (idea_id, owner_user_id, hostname). A row under
  // THIS browser's real hostname is this machine's folder by that key, so the
  // read now uses the same three-part key the write does instead of only
  // resolving when every machine happens to agree on one path.
  describe("machine-aware read (realHostname)", () => {
    const twoMachines = [
      { absolute_path: "/Users/nick/projects/x", hostname: "Nicks-MacBook-Pro.local" },
      { absolute_path: "/home/nick/code/x", hostname: "linux-box" },
    ];

    it("THE fix: >1 distinct paths but one row is ours → resolves to OUR path", () => {
      expect(chooseLaunchCwd(twoMachines, "Nicks-MacBook-Pro.local")).toBe("/Users/nick/projects/x");
      expect(chooseLaunchCwd(twoMachines, "linux-box")).toBe("/home/nick/code/x");
    });

    it("unchanged when the hostname is unknown — same rows still ambiguous", () => {
      expect(chooseLaunchCwd(twoMachines, null)).toBeUndefined();
      expect(chooseLaunchCwd(twoMachines)).toBeUndefined();
    });

    it("a hostname matching NO row falls through to the dedupe rule, never guesses", () => {
      expect(chooseLaunchCwd(twoMachines, "some-third-machine")).toBeUndefined();
      expect(
        chooseLaunchCwd(
          [
            { absolute_path: "/Users/nick/x", hostname: "mac-a" },
            { absolute_path: "/Users/nick/x", hostname: "mac-b" },
          ],
          "some-third-machine"
        )
      ).toBe("/Users/nick/x");
    });

    it("our row beats a manual-pin row recorded before the machine was known", () => {
      expect(
        chooseLaunchCwd(
          [
            { absolute_path: "/Users/nick/guessed", hostname: MANUAL_PIN_HOSTNAME },
            { absolute_path: "/Users/nick/actual", hostname: "Nicks-MacBook-Pro.local" },
          ],
          "Nicks-MacBook-Pro.local"
        )
      ).toBe("/Users/nick/actual");
    });

    it("trims our row's path, like every other branch", () => {
      expect(
        chooseLaunchCwd([{ absolute_path: "  /Users/nick/x  ", hostname: "mine" }], "mine")
      ).toBe("/Users/nick/x");
    });

    it("an INVALID path on our own row doesn't win, and doesn't block a good row", () => {
      expect(
        chooseLaunchCwd(
          [
            { absolute_path: "~/relative", hostname: "mine" },
            { absolute_path: "/Users/nick/good", hostname: "other" },
          ],
          "mine"
        )
      ).toBe("/Users/nick/good");
    });

    it("hostname match is exact — a near-miss spelling is not our row", () => {
      expect(chooseLaunchCwd(twoMachines, "Nicks-MacBook-Pro")).toBeUndefined();
      expect(chooseLaunchCwd(twoMachines, "nicks-macbook-pro.local")).toBeUndefined();
    });

    it("no rows at all → undefined even with a known hostname", () => {
      expect(chooseLaunchCwd([], "Nicks-MacBook-Pro.local")).toBeUndefined();
      expect(chooseLaunchCwd(null, "Nicks-MacBook-Pro.local")).toBeUndefined();
    });

    // Regression: a poisoned `/` row keyed to the real hostname used to win
    // outright under rule 1 — every future launch on that machine then opened
    // at `/`. isPlausibleProjectPath filters it out before rule 1 ever runs.
    it("a poisoned `/` row for our own hostname is ignored, not returned", () => {
      expect(
        chooseLaunchCwd([{ absolute_path: "/", hostname: "Nicks-MacBook-Pro.local" }], "Nicks-MacBook-Pro.local")
      ).toBeUndefined();
    });

    it("a poisoned `/` row for our hostname + a good row elsewhere → the good row wins", () => {
      expect(
        chooseLaunchCwd(
          [
            { absolute_path: "/", hostname: "Nicks-MacBook-Pro.local" },
            { absolute_path: "/Users/nick/good", hostname: "other-host" },
          ],
          "Nicks-MacBook-Pro.local"
        )
      ).toBe("/Users/nick/good");
    });

    it("a home-directory row for our hostname is ignored", () => {
      expect(
        chooseLaunchCwd([{ absolute_path: "/Users/nick", hostname: "mine" }], "mine")
      ).toBeUndefined();
    });
  });
});

describe("resolveEffectiveLaunchTarget (single source for DISPLAY + LAUNCH — server record only)", () => {
  const recorded = [
    { absolute_path: "/Users/nick/projects/from-db", hostname: "Nicks-MacBook" },
  ];

  // The card this rewrites for: resolveEffectiveLaunchTarget used to accept a
  // `saved` (localStorage pin) arg and let it win over the DB record — two
  // independent, never-compared stores for the same fact. The pin is now
  // retired as a read source here entirely: `idea_project_paths` (surfaced as
  // `recordedPaths` — this includes rows the "Set exact folder" dialog and the
  // pin migration write, under MANUAL_PIN_HOSTNAME) is the only input.
  it("resolves from the DB recorded path (no `saved` argument exists anymore)", () => {
    const t = resolveEffectiveLaunchTarget({ hasRepo: false, recordedPaths: recorded });
    expect(t.cwd).toBe("/Users/nick/projects/from-db");
    expect(t.source).toBe("recorded");
    expect(t.displayLabel).toBe("This machine — Nicks-MacBook");
    expect(t.host).toBe("Nicks-MacBook");
  });

  it("regression: cwd and displayPath are ALWAYS the same value", () => {
    for (const paths of [null, [], recorded]) {
      const t = resolveEffectiveLaunchTarget({ hasRepo: false, recordedPaths: paths });
      expect(t.displayPath).toBe(t.cwd);
    }
  });

  it("a manually-pinned row (MANUAL_PIN_HOSTNAME) resolves exactly like any other recorded hostname", () => {
    const t = resolveEffectiveLaunchTarget({
      hasRepo: false,
      recordedPaths: [{ absolute_path: "/Users/nick/projects/pinned", hostname: MANUAL_PIN_HOSTNAME }],
    });
    expect(t.cwd).toBe("/Users/nick/projects/pinned");
    expect(t.source).toBe("recorded");
    expect(t.displayLabel).toBe(`This machine — ${MANUAL_PIN_HOSTNAME}`);
  });

  it("honours chooseLaunchCwd's >1 → undefined contract (ambiguous machines)", () => {
    const t = resolveEffectiveLaunchTarget({
      hasRepo: false,
      recordedPaths: [
        { absolute_path: "/Users/nick/x", hostname: "mac" },
        { absolute_path: "/home/nick/x", hostname: "linux" },
      ],
    });
    expect(t.cwd).toBeUndefined();
    expect(t.source).toBe("none");
  });

  it("…but resolves that same ambiguous set once realHostname names one of the rows", () => {
    const ambiguous = [
      { absolute_path: "/Users/nick/x", hostname: "mac" },
      { absolute_path: "/home/nick/x", hostname: "linux" },
    ];
    const t = resolveEffectiveLaunchTarget({
      hasRepo: false,
      recordedPaths: ambiguous,
      realHostname: "linux",
    });
    expect(t.cwd).toBe("/home/nick/x");
    expect(t.source).toBe("recorded");
    expect(t.host).toBe("linux");
    expect(t.displayLabel).toBe("This machine — linux");
  });

  // The label must name the row we actually resolved FROM. With several rows
  // sharing the resolved path, that's ours when we know which one is ours —
  // showing another machine's hostname under "This machine" would be a lie.
  it("labels with THIS machine's hostname when several rows share the resolved path", () => {
    const sharedPath = [
      { absolute_path: "/Users/nick/same", hostname: "old-laptop" },
      { absolute_path: "/Users/nick/same", hostname: "Nicks-MacBook-Pro.local" },
    ];
    expect(
      resolveEffectiveLaunchTarget({
        hasRepo: false,
        recordedPaths: sharedPath,
        realHostname: "Nicks-MacBook-Pro.local",
      }).displayLabel
    ).toBe("This machine — Nicks-MacBook-Pro.local");
    // Unknown identity keeps the old first-match label rather than degrading.
    expect(
      resolveEffectiveLaunchTarget({ hasRepo: false, recordedPaths: sharedPath }).displayLabel
    ).toBe("This machine — old-laptop");
  });

  it("omitting realHostname is exactly the old behaviour (default off)", () => {
    const rows = [
      { absolute_path: "/Users/nick/x", hostname: "mac" },
      { absolute_path: "/home/nick/x", hostname: "linux" },
    ];
    expect(resolveEffectiveLaunchTarget({ hasRepo: false, recordedPaths: rows })).toEqual(
      resolveEffectiveLaunchTarget({ hasRepo: false, recordedPaths: rows, realHostname: null })
    );
  });

  // ── Repo-backed ideas: a known folder wins here too (regression, unchanged) ─
  // A repo-backed idea with a known folder (recorded or manually pinned)
  // resolves that folder exactly like a no-repo idea does — `hasRepo` doesn't
  // gate this function.
  it("repo-backed idea: a recorded path still resolves, same as no-repo", () => {
    const t = resolveEffectiveLaunchTarget({ hasRepo: true, recordedPaths: recorded });
    expect(t.cwd).toBe("/Users/nick/projects/from-db");
    expect(t.source).toBe("recorded");
    expect(t.displayLabel).toBe("This machine — Nicks-MacBook");
  });

  // Unchanged: repo-backed with nothing known at all → "none", so
  // resolveDefaultLaunchState still falls through to the empty-path
  // fresh-machine flow (repo slug / clone resolves the folder).
  it("repo-backed idea: no recorded path → 'none' (fresh-machine flow, unchanged)", () => {
    const t = resolveEffectiveLaunchTarget({ hasRepo: true, recordedPaths: [] });
    expect(t.cwd).toBeUndefined();
    expect(t.displayPath).toBeUndefined();
    expect(t.source).toBe("none");
  });

  it("returns source 'none' when nothing is usable (first-launch flow)", () => {
    const t = resolveEffectiveLaunchTarget({ hasRepo: false, recordedPaths: [] });
    expect(t.cwd).toBeUndefined();
    expect(t.displayPath).toBeUndefined();
    expect(t.displayLabel).toBeUndefined();
    expect(t.source).toBe("none");
  });
});

describe("mergeRecordedPath (optimistic merge of a just-saved manual pin)", () => {
  const base = [{ absolute_path: "/Users/nick/projects/from-db", hostname: "Nicks-MacBook" }];

  it("appends a new hostname", () => {
    const merged = mergeRecordedPath(base, {
      absolute_path: "/Users/nick/projects/manual",
      hostname: MANUAL_PIN_HOSTNAME,
    });
    expect(merged).toHaveLength(2);
    expect(merged).toContainEqual({ absolute_path: "/Users/nick/projects/manual", hostname: MANUAL_PIN_HOSTNAME });
    expect(merged).toContainEqual(base[0]);
  });

  it("replaces an existing row with the same hostname rather than duplicating", () => {
    const merged = mergeRecordedPath(base, {
      absolute_path: "/Users/nick/projects/moved",
      hostname: "Nicks-MacBook",
    });
    expect(merged).toEqual([{ absolute_path: "/Users/nick/projects/moved", hostname: "Nicks-MacBook" }]);
  });

  it("returns the base list unchanged (a copy) when there's no update", () => {
    expect(mergeRecordedPath(base, null)).toEqual(base);
    expect(mergeRecordedPath(base, undefined)).toEqual(base);
    expect(mergeRecordedPath(null, null)).toEqual([]);
  });
});

// ── decidePinMigration — the re-derived precedence table (this rework) ──
// The investigation step this card was built from concluded "the browser
// cannot know its hostname" — that's false (getMachineIdentity(), see
// MANUAL_PIN_HOSTNAME's doc) — so decidePinMigration now takes the browser's
// REAL hostname as a second argument, and a row for that exact hostname wins
// outright regardless of row count. When it's null (never known), or doesn't
// match any row, this falls through to the original 0/1/>1 row-count logic,
// now inserting under the real hostname (when known) instead of the fake
// MANUAL_PIN_HOSTNAME sentinel.
describe("decidePinMigration (browser-pin → idea_project_paths migration decision)", () => {
  describe("hostname unknown (realHostname omitted/null) — original row-count logic", () => {
    it("0 rows → insert under MANUAL_PIN_HOSTNAME (preserve the only signal on file)", () => {
      expect(decidePinMigration([])).toEqual({ action: "insert", hostname: MANUAL_PIN_HOSTNAME });
      expect(decidePinMigration([], null)).toEqual({ action: "insert", hostname: MANUAL_PIN_HOSTNAME });
    });

    it("exactly 1 row → update THAT row's hostname in place (never a second row)", () => {
      expect(decidePinMigration([{ hostname: "Nicks-MacBook-Pro.local" }])).toEqual({
        action: "update",
        hostname: "Nicks-MacBook-Pro.local",
      });
    });

    // Still a skip with no real hostname — unlike rule 4 above, there is no
    // hostname to insert under that would mean anything to a later read.
    it("more than 1 row → skip (already ambiguous; not reconciled here)", () => {
      expect(decidePinMigration([{ hostname: "mac" }, { hostname: "linux" }])).toEqual({ action: "skip" });
      expect(
        decidePinMigration([{ hostname: "mac" }, { hostname: "linux" }, { hostname: "win" }])
      ).toEqual({ action: "skip" });
    });
  });

  describe("real hostname known — rule 1: a row for it wins outright", () => {
    it("a row for the real hostname exists, alone → update it", () => {
      expect(decidePinMigration([{ hostname: "Nicks-MacBook-Pro.local" }], "Nicks-MacBook-Pro.local")).toEqual({
        action: "update",
        hostname: "Nicks-MacBook-Pro.local",
      });
    });

    // The explicit case the card calls out: a row for the real hostname wins
    // regardless of how many OTHER rows exist — the >1-row "skip" rule only
    // ever existed because the code couldn't tell which row was ours; now it
    // can, so it no longer needs to defer.
    it("a row for the real hostname exists ALONGSIDE other rows → still updates only that one", () => {
      expect(
        decidePinMigration(
          [{ hostname: "other-machine" }, { hostname: "Nicks-MacBook-Pro.local" }, { hostname: "third" }],
          "Nicks-MacBook-Pro.local"
        )
      ).toEqual({ action: "update", hostname: "Nicks-MacBook-Pro.local" });
    });
  });

  describe("real hostname known but no row matches it — falls through to row-count rules", () => {
    it("0 rows → insert under the REAL hostname, not the sentinel", () => {
      expect(decidePinMigration([], "Nicks-MacBook-Pro.local")).toEqual({
        action: "insert",
        hostname: "Nicks-MacBook-Pro.local",
      });
    });

    it("exactly 1 row (a different hostname) → still updates that lone row in place", () => {
      // Unchanged from the hostname-unknown case: the pin already wins over a
      // lone recorded row (the card's standing "pin wins" decision), and
      // updating in place is what keeps chooseLaunchCwd resolving to exactly
      // one distinct path — narrowing this by hostname would only reintroduce
      // the ambiguity the original 1-row rule was written to avoid.
      expect(decidePinMigration([{ hostname: "Old-Machine.local" }], "Nicks-MacBook-Pro.local")).toEqual({
        action: "update",
        hostname: "Old-Machine.local",
      });
    });

    // Rule 4, changed with the machine-aware READ: this used to skip, which
    // left the pin permanently stranded (several machines on file, nothing ever
    // lands, the user is re-asked every single launch). chooseLaunchCwd now
    // prefers the row keyed to THIS machine over any amount of ambiguity, so
    // the row inserted here is precisely the one the next read will pick.
    it("more than 1 row, none matching, real hostname KNOWN → insert under it", () => {
      expect(
        decidePinMigration([{ hostname: "mac" }, { hostname: "linux" }], "Nicks-MacBook-Pro.local")
      ).toEqual({ action: "insert", hostname: "Nicks-MacBook-Pro.local" });
    });

    it("inserts without disturbing the rows already there (decision names only OUR hostname)", () => {
      const rows = [{ hostname: "mac" }, { hostname: "linux" }, { hostname: MANUAL_PIN_HOSTNAME }];
      const decision = decidePinMigration(rows, "Nicks-MacBook-Pro.local");
      expect(decision.action).toBe("insert");
      expect(decision.action === "insert" && decision.hostname).toBe("Nicks-MacBook-Pro.local");
      // The decision must never target another machine's row.
      expect(rows.map((r) => r.hostname)).not.toContain("Nicks-MacBook-Pro.local");
    });

    // End-to-end of the pair: migrate into an ambiguous set, then read back.
    // Before this change the read returned undefined here forever.
    it("insert then read → the machine's own row resolves out of an ambiguous set", () => {
      const existing = [
        { absolute_path: "/Users/other/x", hostname: "mac" },
        { absolute_path: "/home/other/x", hostname: "linux" },
      ];
      const decision = decidePinMigration(existing, "Nicks-MacBook-Pro.local");
      expect(decision).toEqual({ action: "insert", hostname: "Nicks-MacBook-Pro.local" });
      expect(chooseLaunchCwd(existing, "Nicks-MacBook-Pro.local")).toBeUndefined();
      const after = [
        ...existing,
        { absolute_path: "/Users/nick/projects/mine", hostname: "Nicks-MacBook-Pro.local" },
      ];
      expect(chooseLaunchCwd(after, "Nicks-MacBook-Pro.local")).toBe("/Users/nick/projects/mine");
    });
  });

  // The scenario the card explicitly requires: migrating under a real
  // hostname, then a later decision against the resulting row (standing in
  // for an agent's own record_project_path self-heal on the same machine)
  // must target the SAME row, not a second one.
  it("insert-under-real-hostname then a later decision against that same row converge on one hostname", () => {
    const inserted = decidePinMigration([], "Nicks-MacBook-Pro.local");
    expect(inserted).toEqual({ action: "insert", hostname: "Nicks-MacBook-Pro.local" });

    const relaunched = decidePinMigration(
      [{ hostname: inserted.hostname! }],
      "Nicks-MacBook-Pro.local"
    );
    expect(relaunched).toEqual({ action: "update", hostname: "Nicks-MacBook-Pro.local" });
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

  it("includes the defensive cd guard (Change #3): STOP if pwd is root or home", () => {
    const p = buildBoardBootstrapPrompt(base);
    expect(p).toMatch(
      /if `?pwd`? shows `?\/`? \(the filesystem root\) or your home directory, STOP/i
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

  // Card bd018a86: a board-level launch (no task chosen) must NOT silently
  // start on the top of the queue — the session exists for whatever the user
  // opened it for, and grabbing a task without asking forces them to interrupt
  // it. It must name the next task, ask, and WAIT. A per-task launch is the
  // opposite: the task was already chosen, so it goes straight in with no ask.
  it("board-level launch asks before starting; per-task launch does not", () => {
    const boardLevel = buildCompactBootstrapPrompt({
      appUrl: APP_URL,
      ideaId: "idea-1",
      ideaTitle: "My Idea",
      mode: "existing",
      repoUrl: null,
    });
    expect(boardLevel).toMatch(/ASK first/);
    expect(boardLevel).toMatch(/ask before starting it/);
    expect(boardLevel).toMatch(/wait for my reply/);

    const perTask = buildCompactBootstrapPrompt({
      appUrl: APP_URL,
      ideaId: "idea-1",
      ideaTitle: "My Idea",
      mode: "existing",
      repoUrl: null,
      taskId: "task-1",
    });
    expect(perTask).toContain("Work this task");
    expect(perTask).not.toMatch(/ASK first/);
    expect(perTask).not.toMatch(/wait for my reply/);
  });

  // Card 4cdcb33a: same hard exclusion as the full board bootstrap prompt, but
  // in the compact/terse phrasing this deep-link builder is budget-constrained
  // to. Assert the actual exclusion substring, not just "To Do"/"Backlog"
  // presence (those pass before AND after the fix and prove nothing) — and
  // confirm the fix didn't blow the deep link's hard URL ceiling.
  it("board-level (no taskId) work step explicitly excludes In Progress/Blocked/Verify tasks", () => {
    const p = buildCompactBootstrapPrompt({
      appUrl: APP_URL,
      ideaId: "idea-1",
      ideaTitle: "My Idea",
      mode: "existing",
      repoUrl: null,
    });
    expect(p).toContain("Only To Do/Backlog, never In Progress/Blocked/Verify");
    expect(p).toMatch(/may be live/);
    expect(buildClaudeDeepLink({ prompt: p }).length).toBeLessThanOrEqual(MAX_DEEP_LINK_URL_LENGTH);
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

  it("prefers the user's saved NEW-mode localStorage config (the browser store's one surviving job)", () => {
    writeLaunchPath("idea-1", {
      mode: "new",
      path: "~/projects/x",
      parent: "~/projects",
      name: "x",
    });
    expect(resolveDefaultLaunchState("idea-1", "My Idea", null)).toEqual({
      mode: "new",
      path: "~/projects/x",
      parent: "~/projects",
      name: "x",
    });
  });

  // Regression for the card: an EXISTING-mode localStorage pin used to win
  // outright (returned verbatim, before `effectiveTarget` was even consulted).
  // It's now retired as a read source here — `idea_project_paths`, via
  // `effectiveTarget`, is the only thing that can resolve an existing folder.
  it("ignores a saved EXISTING-mode localStorage pin — no known server folder falls through to the no-repo default", () => {
    writeLaunchPath("idea-1", { mode: "existing", path: "/Users/me/projects/stale-pin" });
    const state = resolveDefaultLaunchState("idea-1", "My First App", null);
    expect(state.mode).toBe("new");
    expect(state).not.toMatchObject({ path: "/Users/me/projects/stale-pin" });
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

  // ── Repo-backed idea + a known folder (effectiveTarget) ────────────────────
  // Second defect QA found: `resolveDefaultLaunchState`'s `if (ideaGithubUrl)`
  // branch used to fire BEFORE the effectiveTarget check, making a repo-backed
  // idea's recorded folder dead code — the two resolvers disagreed.
  it("repo-backed idea + a recorded DB path → existing mode at the recorded path", () => {
    const effectiveTarget = resolveEffectiveLaunchTarget({
      hasRepo: true,
      recordedPaths: [{ absolute_path: "/Users/nick/projects/widget", hostname: "Nicks-MacBook" }],
    });
    expect(
      resolveDefaultLaunchState("idea-1", "My Idea", "https://github.com/acme/widget", effectiveTarget)
    ).toEqual({ mode: "existing", path: "/Users/nick/projects/widget" });
  });

  // A manually-pinned row (dialog Save / pin migration) is just another
  // recordedPaths entry now — it resolves through the exact same path as an
  // agent-recorded row, no separate "pin" concept in this resolver anymore.
  it("repo-backed idea + a manually-pinned row (MANUAL_PIN_HOSTNAME) → existing mode at that path", () => {
    const effectiveTarget = resolveEffectiveLaunchTarget({
      hasRepo: true,
      recordedPaths: [{ absolute_path: "/Users/nick/projects/pinned-widget", hostname: MANUAL_PIN_HOSTNAME }],
    });
    expect(
      resolveDefaultLaunchState("idea-1", "My Idea", "https://github.com/acme/widget", effectiveTarget)
    ).toEqual({ mode: "existing", path: "/Users/nick/projects/pinned-widget" });
  });

  // UNCHANGED / the fresh-machine flow that must not regress: repo-backed with
  // NO known folder still opens empty-path existing mode so the bootstrap
  // prompt emits its clone/directory step.
  it("repo-backed idea + effectiveTarget but NO known folder → still the empty-path fresh-machine flow", () => {
    const effectiveTarget = resolveEffectiveLaunchTarget({
      hasRepo: true,
      recordedPaths: [],
    });
    expect(
      resolveDefaultLaunchState("idea-1", "My Idea", "https://github.com/acme/widget", effectiveTarget)
    ).toEqual({ mode: "existing", path: "" });
  });

  // Ambiguous (>1 distinct recorded paths) must not promote a repo-backed idea
  // either — same "don't guess which machine" contract as the no-repo case.
  it("repo-backed idea + >1 distinct recorded paths (ambiguous) → still the empty-path flow", () => {
    const effectiveTarget = resolveEffectiveLaunchTarget({
      hasRepo: true,
      recordedPaths: [
        { absolute_path: "/Users/nick/widget", hostname: "mac" },
        { absolute_path: "/home/nick/widget", hostname: "linux" },
      ],
    });
    expect(
      resolveDefaultLaunchState("idea-1", "My Idea", "https://github.com/acme/widget", effectiveTarget)
    ).toEqual({ mode: "existing", path: "" });
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

  it("a saved NEW-mode localStorage path (no repo) is NOT clobbered by an absent recorded path", () => {
    writeLaunchPath(IDEA_ID, { mode: "new", path: "~/projects/x", parent: "~/projects", name: "x" });
    const effectiveTarget = resolveEffectiveLaunchTarget({ hasRepo: false, recordedPaths: [] });
    // resolveDefaultLaunchState still reads localStorage itself for new-mode —
    // unaffected by effectiveTarget having nothing recorded.
    expect(resolveDefaultLaunchState(IDEA_ID, "My Idea", null, effectiveTarget)).toEqual({
      mode: "new",
      path: "~/projects/x",
      parent: "~/projects",
      name: "x",
    });
  });

  // Acceptance criterion "pin-and-record-disagree": before this fix, an
  // EXISTING-mode localStorage pin always won over a disagreeing recorded DB
  // path (the exact bug reported live: pin and server record pointed at two
  // different clones, and every launch silently followed the pin). Now the
  // server record is the only thing consulted — a leftover pin in
  // localStorage (e.g. one that failed to migrate) has no effect at all.
  it("pin-and-record-disagree: an EXISTING-mode pin no longer overrides a disagreeing recorded path", () => {
    writeLaunchPath(IDEA_ID, { mode: "existing", path: "/Users/nick/projects/stale-pin-path" });
    const effectiveTarget = resolveEffectiveLaunchTarget({
      hasRepo: false,
      recordedPaths: [{ absolute_path: RECORDED, hostname: "Nicks-MacBook" }],
    });
    expect(resolveDefaultLaunchState(IDEA_ID, "My Idea", null, effectiveTarget)).toEqual({
      mode: "existing",
      path: RECORDED,
    });
  });
});

// ── Risk 2 (QA): repo-backed idea + a known folder must get verify-the-folder
// wording, NOT the bare "cd your local clone, or git clone" fresh-machine
// instruction — the compact prompt's directory branch is reachable for
// repo-backed ideas for the first time once resolveDefaultLaunchState promotes
// them to existing-mode-with-a-path (see the "recorded-path idea promotes"
// block above). This exercises buildCompactBootstrapPrompt directly with
// repoUrl + existingPath both set, mirroring what resolveDefaultLaunchState +
// the callers in use-terminal-session.ts / launch-claude-code-button.tsx now
// produce for that case.
describe("repo-backed compact prompt with a known folder (Risk 2 — verify, don't re-clone)", () => {
  const APP_URL = "https://vibecodes.co.uk";
  const IDEA_ID = "idea-repo-recorded";
  const REPO_URL = "https://github.com/acme/widget";
  const KNOWN_PATH = "/Users/nick/projects/widget";

  it("repo-backed + known folder → verify-the-folder wording, confirms the clone, no fresh clone instruction", () => {
    const p = buildCompactBootstrapPrompt({
      appUrl: APP_URL,
      ideaId: IDEA_ID,
      ideaTitle: "Widget",
      mode: "existing",
      repoUrl: REPO_URL,
      existingPath: KNOWN_PATH,
    });
    expect(p).toContain(`already be in ${KNOWN_PATH}`);
    expect(p).toMatch(/recorded from a previous session/i);
    expect(p).toContain("clone of acme/widget");
    expect(p).toContain("git remote -v");
    expect(p).toMatch(/don't re-clone/i);
    // The fresh-machine "get into the repo" clone instruction must NOT appear —
    // we already know the folder, so don't tell the agent to (re-)clone it.
    expect(p).not.toContain("Get into the repo");
    expect(p).not.toContain("git clone https://github.com/acme/widget.git");
  });

  it("repo-backed + NO known folder → unchanged clone/cd instruction (fresh-machine flow)", () => {
    const p = buildCompactBootstrapPrompt({
      appUrl: APP_URL,
      ideaId: IDEA_ID,
      ideaTitle: "Widget",
      mode: "existing",
      repoUrl: REPO_URL,
      // no existingPath — nothing recorded/pinned yet.
    });
    expect(p).toContain("Get into the repo acme/widget first");
    expect(p).toContain(`git clone https://github.com/acme/widget.git ${DEFAULT_NEW_PROJECT_PARENT}/widget`);
    expect(p).not.toContain("already be in");
    expect(p).not.toContain("git remote -v");
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

  it("record_project_path is framed as re-confirm/self-heal, guarded against `/` or home", () => {
    const p = buildCompactBootstrapPrompt(MODES["new-no-repo"]);
    expect(p).toContain("record_project_path");
    expect(p).toMatch(/re-confirm/i);
    expect(p).toMatch(/never `?\/`? or home/i);
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

// ── Concurrent-terminal isolation (native `claude --worktree` flag) ────────
//
// QA root-cause fix: this used to be an ADVISORY TEXT PROTOCOL
// (buildWorktreeIsolationProtocol, since removed) injected into the bootstrap
// prompt — an agent could ignore it, and a URL length budget could silently
// drop the whole thing with no enforcement fallback. It is now Claude Code's
// own REAL, enforced, native `--worktree <name>` CLI flag (see
// terminal/bridge/src/resume-cmd.js and
// https://code.claude.com/docs/en/worktrees), wired onto a fresh bridge
// launch via the deep link's `worktree` boolean (terminal/shared/deep-link.mjs)
// — see terminal/bridge/src/resume-cmd.test.js and
// terminal/test/deep-link.test.mjs for the mechanism itself. What's left to
// test here, at the prompt-building layer, is exactly the SAME scoping
// decision the old protocol used (existing-mode launches with a known,
// possibly-shared folder — repo-backed or not, for the compact/deep-link
// path), now expressed as the plain `isolate` boolean on
// CompactPromptEssentials, and that no trace of the old protocol text is
// left in any prompt.
describe("concurrent-terminal isolation — the `isolate` flag (formerly the worktree-isolation protocol)", () => {
  const APP_URL = "https://vibecodes.co.uk";

  it("is set for existing-mode/no-repo with a known folder (existingPath)", () => {
    const essentials = buildCompactPromptEssentials({
      appUrl: APP_URL,
      ideaId: "idea-1",
      ideaTitle: "My Idea",
      mode: "existing",
      repoUrl: null,
      existingPath: "/Users/nick/projects/my-idea",
    });
    expect(essentials.isolate).toBe(true);
  });

  it("is set for existing-mode/repo-backed with a known folder too (repo slug alone isn't enough to disambiguate a real local shell)", () => {
    const essentials = buildCompactPromptEssentials({
      appUrl: APP_URL,
      ideaId: "idea-1",
      ideaTitle: "My Idea",
      mode: "existing",
      repoUrl: "https://github.com/acme/widget",
      existingPath: "/Users/nick/projects/widget",
    });
    expect(essentials.isolate).toBe(true);
  });

  it("is unset when no folder is known yet (repo-backed, fresh clone)", () => {
    const essentials = buildCompactPromptEssentials({
      appUrl: APP_URL,
      ideaId: "idea-1",
      ideaTitle: "My Idea",
      mode: "existing",
      repoUrl: "https://github.com/acme/widget",
    });
    expect(essentials.isolate).toBeUndefined();
  });

  it("is unset when no folder is known yet (no-repo, first launch)", () => {
    const essentials = buildCompactPromptEssentials({
      appUrl: APP_URL,
      ideaId: "idea-1",
      ideaTitle: "My Idea",
      mode: "existing",
      repoUrl: null,
    });
    expect(essentials.isolate).toBeUndefined();
  });

  it("is unset for create-new (mode: new) — a fresh folder has no concurrent-session ambiguity yet", () => {
    const essentials = buildCompactPromptEssentials({
      appUrl: APP_URL,
      ideaId: "idea-1",
      ideaTitle: "My Idea",
      mode: "new",
      repoUrl: null,
      newProject: { newProjectPath: "/Users/me/projects/my-idea" },
    });
    expect(essentials.isolate).toBeUndefined();
  });

  // claude-cli:// has no --worktree-flag plumbing (it's a third-party OS
  // handler, not our bridge), so `includeIsolationAdvisory` is the opt-in that
  // folds an advisory note into the prompt TEXT instead — see
  // `CompactBootstrapArgs.includeIsolationAdvisory`'s doc.
  describe("isolationNote — the claude-cli:// text companion to `isolate`", () => {
    it("is set when includeIsolationAdvisory is true and isolate is in scope (known folder)", () => {
      const essentials = buildCompactPromptEssentials({
        appUrl: APP_URL,
        ideaId: "idea-1",
        ideaTitle: "My Idea",
        mode: "existing",
        repoUrl: null,
        existingPath: "/Users/nick/projects/my-idea",
        includeIsolationAdvisory: true,
      });
      expect(essentials.isolate).toBe(true);
      expect(essentials.isolationNote).toBeTruthy();
      expect(essentials.isolationNote).toContain("git worktree add");
    });

    it("is unset when includeIsolationAdvisory is omitted — the vibecodes:// destination's shape, even though isolate is true", () => {
      const essentials = buildCompactPromptEssentials({
        appUrl: APP_URL,
        ideaId: "idea-1",
        ideaTitle: "My Idea",
        mode: "existing",
        repoUrl: null,
        existingPath: "/Users/nick/projects/my-idea",
      });
      expect(essentials.isolate).toBe(true);
      expect(essentials.isolationNote).toBeUndefined();
    });

    it("stays unset with includeIsolationAdvisory: true when isolate itself is out of scope (no known folder yet)", () => {
      const essentials = buildCompactPromptEssentials({
        appUrl: APP_URL,
        ideaId: "idea-1",
        ideaTitle: "My Idea",
        mode: "existing",
        repoUrl: "https://github.com/acme/widget",
        includeIsolationAdvisory: true,
      });
      expect(essentials.isolate).toBeUndefined();
      expect(essentials.isolationNote).toBeUndefined();
    });

    it("the claude-cli:// deep link's prompt carries the note for an existing-mode/known-folder launch", () => {
      const link = buildClampedDeepLink({
        appUrl: APP_URL,
        ideaId: "idea-1",
        ideaTitle: "My Idea",
        mode: "existing",
        repoUrl: null,
        existingPath: "/Users/nick/projects/my-idea",
        includeIsolationAdvisory: true,
      });
      expect(decodeQ(link)).toContain("git worktree add");
    });

    it("degrade ladder: directoryEcho drops first, then the note, `work` always survives whole", () => {
      const withNote = buildCompactPromptEssentials({
        appUrl: APP_URL,
        ideaId: "idea-1",
        ideaTitle: "My Idea",
        mode: "existing",
        repoUrl: null,
        existingPath: "/Users/nick/projects/my-idea",
        includeIsolationAdvisory: true,
      });
      const stepOffset = (withNote.headSteps ?? []).length;
      const directoryEcho = withNote.directoryEcho as string;
      const isolationNote = withNote.isolationNote as string;
      const work = withNote.work as string;

      // Tier 1 — everything fits: directoryEcho + isolationNote + work, whole.
      const fullTail = [directoryEcho, isolationNote, work]
        .map((s, i) => `${stepOffset + i + 1}. ${s}`)
        .join("\n");
      const fullOut = fitCompactEssentials(withNote, MAX_DEEP_LINK_PROMPT_LENGTH);
      expect(fullOut).toBe(`${withNote.head}${fullTail}`);

      // Tier 2 — directoryEcho dropped first (it only duplicates the deep
      // link's own cwd= param); the isolation note, the actual mitigation
      // text, survives alongside work.
      const tier2Tail = [isolationNote, work]
        .map((s, i) => `${stepOffset + i + 1}. ${s}`)
        .join("\n");
      const tier2Full = `${withNote.head}${tier2Tail}`;
      const tier2Budget = encodeURIComponent(tier2Full).length;
      const tier2Out = fitCompactEssentials(withNote, tier2Budget);
      expect(tier2Out).toBe(tier2Full);
      expect(tier2Out).not.toContain(directoryEcho);
      expect(tier2Out).toContain(isolationNote);
      expect(tier2Out).toContain(work);

      // Tier 3 — tighter still: the note is dropped too, but `work` (the
      // idea/task id, unrecoverable if lost) always survives whole.
      const tier3Tail = `${stepOffset + 1}. ${work}`;
      const tier3Full = `${withNote.head}${tier3Tail}`;
      const tier3Budget = encodeURIComponent(tier3Full).length;
      const tier3Out = fitCompactEssentials(withNote, tier3Budget);
      expect(tier3Out).toBe(tier3Full);
      expect(tier3Out).not.toContain(directoryEcho);
      expect(tier3Out).not.toContain(isolationNote);
      expect(tier3Out).toContain(work);
    });
  });

  // Regression guard: no prompt this file builds (verbose OR compact) should
  // contain so much as a trace of the removed advisory protocol's load-bearing
  // vocabulary — isolation is a flag now, never prompt text.
  it("no prompt contains any trace of the old advisory protocol text", () => {
    const oldProtocolTokens = [
      "WORKTREE ISOLATION",
      "kill -0",
      ".vibe/wt-N",
      "-b vibe/wt-N",
      "~/.vibecodes/locks",
      "⧉ Isolated worktree",
      "● Primary checkout",
    ];
    const board = buildBoardBootstrapPrompt({
      appUrl: APP_URL,
      ideaId: "idea-1",
      ideaTitle: "My Idea",
      mode: "existing",
      repoUrl: null,
    });
    const task = buildTaskBootstrapPrompt({
      appUrl: APP_URL,
      ideaId: "idea-1",
      taskId: "task-9",
      taskTitle: "Do the thing",
      mode: "existing",
      repoUrl: null,
    });
    const compact = buildCompactBootstrapPrompt({
      appUrl: APP_URL,
      ideaId: "idea-1",
      ideaTitle: "My Idea",
      mode: "existing",
      repoUrl: null,
      existingPath: "/Users/nick/projects/my-idea",
    });
    for (const token of oldProtocolTokens) {
      expect(board).not.toContain(token);
      expect(task).not.toContain(token);
      expect(compact).not.toContain(token);
    }
  });
});

// Direct unit tests of fitCompactEssentials (formerly fitCompactWorktreeProtocol,
// before the protocol concept was removed) — the atomic tail degrade ladder is
// unchanged in shape, just one rung shorter (no protocol candidate to drop
// first): directoryEcho + work whole -> work alone whole -> head only. `work`
// (the "find work" step carrying idea_id/task_id) is NEVER character-fragmented.
describe("fitCompactEssentials (shared pure helper)", () => {
  it("passes straight through to enforcePromptLength when there's no atomic work-step breakdown", () => {
    const noBreakdown: CompactPromptEssentials = { head: "HEAD\n", tail: "TAIL" };
    const out = fitCompactEssentials(noBreakdown, MAX_DEEP_LINK_PROMPT_LENGTH);
    expect(out).toBe(enforcePromptLength(noBreakdown.head, noBreakdown.tail, MAX_DEEP_LINK_PROMPT_LENGTH));
  });

  it("never exceeds the budget, even for a pathologically tiny one", () => {
    const noBreakdown: CompactPromptEssentials = { head: "HEAD\n", tail: "TAIL" };
    const out = fitCompactEssentials(noBreakdown, 2);
    expect(encodeURIComponent(out).length).toBeLessThanOrEqual(2);
  });

  describe("atomic work-step protection — never fragments the work step", () => {
    const header = "HEADER";
    const headSteps = ["STEP_ONE", "STEP_TWO"];
    const directoryEcho = "ECHO_LINE";
    const work = "WORK_STEP_WITH_IDEA_ID";

    const atomicEssentials: CompactPromptEssentials = {
      header,
      headSteps,
      head: `${header}\n\n1. ${headSteps[0]}\n2. ${headSteps[1]}\n`,
      tail: `3. ${directoryEcho}\n4. ${work}`,
      directoryEcho,
      work,
    };

    function enc(s: string): number {
      return encodeURIComponent(s).length;
    }

    it("includes directoryEcho + work all whole when the budget comfortably fits everything", () => {
      const out = fitCompactEssentials(atomicEssentials, 1000);
      expect(out).toContain(directoryEcho);
      expect(out).toContain(work);
      expect(out).toContain(headSteps[0]);
      expect(out).toContain(headSteps[1]);
    });

    it("drops directoryEcho (never the work step) once the budget can't fit both", () => {
      const withEcho = fitCompactEssentials(atomicEssentials, 1000);
      const workOnly = withEcho.replace(`3. ${directoryEcho}\n`, "").replace("4.", "3.");
      const budget = enc(workOnly);

      const out = fitCompactEssentials(atomicEssentials, budget);
      expect(out).not.toContain(directoryEcho);
      expect(out).toContain(work); // still whole, still the last thing dropped
    });

    it("never fragments the work step at the character level — omits it whole rather than truncating mid-string when even head+work can't fit", () => {
      // Reserve mirrors fitEssentialHead's own headroom for enforcePromptLength's
      // trailing marker, so a budget of headLen + reserve + slack is exactly
      // enough for the full (both-step) head, but not for the head plus even
      // the bare work step on top.
      const reserve = enc("\n…(truncated)");
      const budget = enc(atomicEssentials.head) + reserve + 2;
      expect(budget).toBeLessThan(enc(atomicEssentials.head) + enc(`3. ${work}`));

      const out = fitCompactEssentials(atomicEssentials, budget);
      expect(out).toContain(headSteps[0]); // head still survives whole...
      expect(out).toContain(headSteps[1]);
      expect(assertStepWholeOrAbsent(out, work, "work step at the absolute floor")).toBe(false);
      expect(out).not.toContain(work.slice(0, 10)); // ...never a fragment of it
      expect(encodeURIComponent(out).length).toBeLessThanOrEqual(budget);
    });
  });
});

// ── claude-cli:// worktree-isolation ADVISORY TEXT (board task 48eb844b) ────
//
// Mitigation: the vibecodes:// destination threads `isolate` into a REAL,
// enforced `claude --worktree` flag (see the describe block above), but
// claude-cli:// is a THIRD-PARTY handler VibeCodes doesn't build or control —
// there is no way to inject a real CLI flag through it. The prompt TEXT
// (`q=`) is the one thing VibeCodes fully owns for that scheme, so
// `includeIsolationAdvisory` folds an advisory note in there instead. This is
// NOT a regression to the old removed worktree-isolation protocol (which had
// no human-review step and could silently no-op): this scheme always shows
// the user the prefilled prompt before Claude Code runs it, so an ignored
// note is a visible gap, not a silent one.
describe("claude-cli:// isolation advisory (includeIsolationAdvisory)", () => {
  const existingArgs: CompactBootstrapArgs = {
    appUrl: APP_URL,
    ideaId: "idea-1",
    ideaTitle: "My Idea",
    mode: "existing",
    repoUrl: null,
    existingPath: "/Users/nick/projects/my-idea",
  };

  it("is present when isolate is true AND the caller opts in", () => {
    const essentials = buildCompactPromptEssentials({
      ...existingArgs,
      includeIsolationAdvisory: true,
    });
    expect(essentials.isolate).toBe(true);
    expect(essentials.isolationNote).toBeDefined();
    expect(essentials.isolationNote).toContain("git worktree add");
    // Folded into the back-compat `tail` too, not just the atomic field.
    expect(essentials.tail).toContain(essentials.isolationNote as string);
  });

  it("is absent when the caller does NOT opt in (the vibecodes:// default — real flag already covers it)", () => {
    const essentials = buildCompactPromptEssentials(existingArgs);
    expect(essentials.isolate).toBe(true); // isolate itself is unaffected
    expect(essentials.isolationNote).toBeUndefined();
    expect(essentials.tail).not.toContain("git worktree add");
  });

  it("is absent when opted in but isolate itself is false (no known folder yet)", () => {
    const essentials = buildCompactPromptEssentials({
      appUrl: APP_URL,
      ideaId: "idea-1",
      ideaTitle: "My Idea",
      mode: "existing",
      repoUrl: "https://github.com/acme/widget",
      includeIsolationAdvisory: true,
    });
    expect(essentials.isolate).toBeUndefined();
    expect(essentials.isolationNote).toBeUndefined();
  });

  it("also folds into the non-budgeted compact prompt (buildCompactBootstrapPrompt) when opted in", () => {
    const prompt = buildCompactBootstrapPrompt({ ...existingArgs, includeIsolationAdvisory: true });
    expect(prompt).toContain("git worktree add");
  });

  it("end-to-end: rides intact in the fired claude-cli:// deep link's decoded prompt under a normal budget", () => {
    const essentials = buildCompactPromptEssentials({
      ...existingArgs,
      includeIsolationAdvisory: true,
    });
    const result = buildBoundedDeepLink({
      essentials,
      cwd: existingArgs.existingPath,
      cap: MAX_DEEP_LINK_URL_LENGTH,
      buildLink: ({ prompt, cwd }) => buildClaudeDeepLink({ prompt, cwd }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(decodeQ(result.url)).toContain("git worktree add");
    expect(result.url.length).toBeLessThanOrEqual(MAX_DEEP_LINK_URL_LENGTH);
  });

  describe("degrade ladder — isolationNote is atomic (whole or absent, never fragmented) and lower priority than work", () => {
    const header = "HEADER";
    const headSteps = ["STEP_ONE", "STEP_TWO"];
    const directoryEcho = "ECHO_LINE";
    const isolationNote = "ISOLATION_NOTE_TEXT";
    const work = "WORK_STEP_WITH_IDEA_ID";

    const atomicEssentials: CompactPromptEssentials = {
      header,
      headSteps,
      head: `${header}\n\n1. ${headSteps[0]}\n2. ${headSteps[1]}\n`,
      tail: `3. ${directoryEcho}\n4. ${isolationNote}\n5. ${work}`,
      directoryEcho,
      isolationNote,
      work,
    };

    function enc(s: string): number {
      return encodeURIComponent(s).length;
    }

    it("includes directoryEcho + isolationNote + work all whole when the budget comfortably fits everything", () => {
      const out = fitCompactEssentials(atomicEssentials, 1000);
      expect(out).toContain(directoryEcho);
      expect(out).toContain(isolationNote);
      expect(out).toContain(work);
    });

    it("drops directoryEcho before isolationNote once the budget can't fit all three", () => {
      const full = fitCompactEssentials(atomicEssentials, 1000);
      const withoutEcho = full.replace(`3. ${directoryEcho}\n`, "").replace(/^4\./m, "3.");
      const budget = enc(withoutEcho);

      const out = fitCompactEssentials(atomicEssentials, budget);
      expect(out).not.toContain(directoryEcho);
      expect(out).toContain(isolationNote);
      expect(out).toContain(work);
    });

    it("drops isolationNote (never the work step) once the budget can't fit both remaining pieces", () => {
      const withoutEcho = fitCompactEssentials(
        { ...atomicEssentials, directoryEcho: undefined },
        1000
      );
      const workOnly = withoutEcho
        .replace(`3. ${isolationNote}\n`, "")
        .replace(/^4\./m, "3.");
      const budget = enc(workOnly);

      const out = fitCompactEssentials(atomicEssentials, budget);
      expect(out).not.toContain(directoryEcho);
      expect(out).not.toContain(isolationNote);
      expect(out).toContain(work); // still the last thing dropped
    });

    it("never fragments isolationNote at the character level — whole or cleanly absent", () => {
      // A budget between "fits with isolationNote" and "fits without it" must
      // never produce a truncated fragment of the note text.
      const withNote = fitCompactEssentials(
        { ...atomicEssentials, directoryEcho: undefined },
        1000
      );
      const withoutNote = withNote.replace(`3. ${isolationNote}\n`, "").replace(/^4\./m, "3.");
      const budget = enc(withoutNote) + 5; // too small for the full note line, bigger than without it

      const out = fitCompactEssentials(atomicEssentials, budget);
      expect(
        assertStepWholeOrAbsent(out, isolationNote, "isolation note at a tight budget")
      ).toBe(false);
      expect(out).not.toContain(isolationNote.slice(0, 10));
      expect(encodeURIComponent(out).length).toBeLessThanOrEqual(budget);
    });
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
              // (deliberately LOWEST-priority, per the degrade ladder)
              // directory-echo TAIL step ("You should already be in
              // <path>...") also legitimately echoes the raw cwd and may be
              // omitted WHOLE by fitCompactEssentials when the budget is
              // tight (BUG C fix: never a character-level fragment, unlike
              // pre-fix behaviour); that is expected, unrelated behaviour,
              // not a cd-line fragment.
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
  // fitCompactEssentials's own synthetic-essentials tests work above.
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

    it("without a cwd at all, behaves exactly like fitCompactEssentials (tier 1 with cwd undefined)", () => {
      const result = buildBoundedDeepLink({ essentials, cwd: undefined, cap: 500, buildLink });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.droppedCwd).toBe(false);
        expect(result.url).not.toContain("cwd=");
      }
    });
  });
});
