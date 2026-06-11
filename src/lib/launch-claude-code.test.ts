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
  buildClaudeDeepLink,
  mcpEndpoint,
  enforcePromptLength,
  MAX_DEEP_LINK_PROMPT_LENGTH,
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
} from "./launch-claude-code";

const APP_URL = "https://staging.vibecodes.co.uk";

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

  it("keeps the whole head even if the head alone exceeds the cap", () => {
    const head = "h".repeat(MAX_DEEP_LINK_PROMPT_LENGTH + 100);
    const out = enforcePromptLength(head, "tail");
    expect(out).toBe(head);
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
  it("existing mode contains the env-derived MCP add and get_my_tasks", () => {
    const p = buildBoardBootstrapPrompt({
      appUrl: APP_URL,
      ideaId: "idea-1",
      ideaTitle: "My Idea",
      mode: "existing",
    });
    expect(p).toContain(`vibecodes-remote ${APP_URL}/api/mcp`);
    expect(p).toContain("get_my_tasks");
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
    expect(t.displayLabel).toBe("This machine (set manually)");
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

  it("records only AFTER the vibecodes-remote connector is available (Change #2)", () => {
    const p = buildBoardBootstrapPrompt(base);
    // The record instruction is gated on the board tools being available.
    expect(p).toMatch(/as soon as the vibecodes-remote board tools are available/i);
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
