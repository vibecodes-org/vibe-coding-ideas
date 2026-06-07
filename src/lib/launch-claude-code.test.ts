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
  composeNewProjectPath,
  buildBoardBootstrapPrompt,
  buildTaskBootstrapPrompt,
  buildLaunchCommand,
  readLaunchPath,
  writeLaunchPath,
  launchPathKey,
  folderNameFromRelativePath,
} from "./launch-claude-code";

const APP_URL = "https://staging.vibecodes.co.uk";

describe("buildClaudeDeepLink", () => {
  it("encodes spaces as %20, never +", () => {
    const link = buildClaudeDeepLink({ prompt: "hello world foo" });
    expect(link).toContain("q=hello%20world%20foo");
    expect(link).not.toContain("+");
  });

  it("includes cwd and repo when present, URL-encoded", () => {
    const link = buildClaudeDeepLink({
      prompt: "p",
      cwd: "/Users/me/my project",
      repo: "https://github.com/o/n",
    });
    expect(link).toContain("cwd=%2FUsers%2Fme%2Fmy%20project");
    expect(link).toContain("repo=https%3A%2F%2Fgithub.com%2Fo%2Fn");
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
  it("create-new mode keeps `claude mcp add` even with a ~6000-char path", () => {
    const p = buildBoardBootstrapPrompt({
      appUrl: APP_URL,
      ideaId: "idea-1",
      ideaTitle: "My Idea",
      mode: "new",
      newProject: { newProjectPath: "/Users/me/" + "x".repeat(6000) },
    });
    expect(p).toContain("claude mcp add");
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
  it("create-new mode keeps `claude mcp add` even with a ~6000-char path", () => {
    const p = buildTaskBootstrapPrompt({
      appUrl: APP_URL,
      ideaId: "idea-1",
      taskId: "task-9",
      taskTitle: "Add OAuth rotation",
      mode: "new",
      newProject: { newProjectPath: "/Users/me/" + "x".repeat(6000) },
    });
    expect(p).toContain("claude mcp add");
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

describe("folderNameFromRelativePath", () => {
  it("returns the first path segment (the picked folder name)", () => {
    expect(folderNameFromRelativePath("my-project/src/index.ts")).toBe("my-project");
  });

  it("returns the whole value when there is no slash", () => {
    expect(folderNameFromRelativePath("my-project")).toBe("my-project");
  });

  it("returns '' for empty/nullish input", () => {
    expect(folderNameFromRelativePath("")).toBe("");
    expect(folderNameFromRelativePath(undefined)).toBe("");
    expect(folderNameFromRelativePath(null)).toBe("");
  });
});
