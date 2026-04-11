import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fetchSkillsFromGitHub, clearSkillsCache, getProviders } from "./skills-directory";

type FetchResponder = (url: string) => Response | Promise<Response>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain" } });
}

function treeResponse(paths: string[]) {
  return jsonResponse({
    tree: paths.map((path) => ({ path, type: "blob" })),
    truncated: false,
  });
}

function skillMd(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nBody text.`;
}

describe("fetchSkillsFromGitHub", () => {
  beforeEach(() => {
    clearSkillsCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearSkillsCache();
  });

  function installFetch(responder: FetchResponder) {
    const spy = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      return responder(url);
    });
    vi.stubGlobal("fetch", spy);
    return spy;
  }

  it("fetches SKILL.md files from all sources via git trees API", async () => {
    installFetch((url) => {
      // Git trees API calls
      if (url === "https://api.github.com/repos/anthropics/skills/git/trees/main?recursive=1") {
        return treeResponse(["skills/a1/SKILL.md", "skills/a2/SKILL.md", "README.md"]);
      }
      if (url === "https://api.github.com/repos/microsoft/skills/git/trees/main?recursive=1") {
        return treeResponse([
          ".github/skills/m-flat/SKILL.md",
          ".github/plugins/azure-sdk-py/skills/m-nested-1/SKILL.md",
          ".github/plugins/azure-sdk-py/skills/m-nested-2/SKILL.md",
          "docs/something/SKILL.md", // should be filtered out by pathPrefixes
          "tests/fixture.md",
        ]);
      }
      if (url === "https://api.github.com/repos/vercel-labs/agent-skills/git/trees/main?recursive=1") {
        return treeResponse(["skills/v1/SKILL.md"]);
      }

      // Raw SKILL.md fetches
      const rawMatch = url.match(/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\/(.+)\/SKILL\.md$/);
      if (rawMatch) {
        const leaf = rawMatch[1].split("/").pop() ?? "unknown";
        return textResponse(skillMd(leaf, `desc for ${leaf}`));
      }
      return new Response("not found", { status: 404 });
    });

    const skills = await fetchSkillsFromGitHub();
    const names = skills.map((s) => s.name).sort();

    expect(names).toEqual(["a1", "a2", "m-flat", "m-nested-1", "m-nested-2", "v1"]);

    const providers = new Set(skills.map((s) => s.provider));
    expect(providers).toEqual(new Set(["Anthropic", "Microsoft", "Vercel"]));
  });

  it("respects pathPrefixes to filter out non-skill SKILL.md files in microsoft/skills", async () => {
    installFetch((url) => {
      if (url.includes("anthropics/skills/git/trees")) return treeResponse([]);
      if (url.includes("vercel-labs/agent-skills/git/trees")) return treeResponse([]);
      if (url.includes("microsoft/skills/git/trees")) {
        return treeResponse([
          ".github/skills/real-1/SKILL.md",
          ".github/plugins/azure-sdk-dotnet/skills/real-2/SKILL.md",
          "docs/example/SKILL.md", // must be excluded
          "tests/sample/SKILL.md", // must be excluded
        ]);
      }
      const rawMatch = url.match(/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\/(.+)\/SKILL\.md$/);
      if (rawMatch) {
        const leaf = rawMatch[1].split("/").pop() ?? "x";
        return textResponse(skillMd(leaf, "d"));
      }
      return new Response("nope", { status: 404 });
    });

    const skills = await fetchSkillsFromGitHub();
    const names = skills.map((s) => s.name).sort();
    expect(names).toEqual(["real-1", "real-2"]);
  });

  it("builds correct source_url from file path", async () => {
    installFetch((url) => {
      if (url.includes("anthropics/skills/git/trees")) {
        return treeResponse(["skills/pdf/SKILL.md"]);
      }
      if (url.includes("microsoft/skills/git/trees")) return treeResponse([]);
      if (url.includes("vercel-labs/agent-skills/git/trees")) return treeResponse([]);

      if (url.endsWith("/anthropics/skills/main/skills/pdf/SKILL.md")) {
        return textResponse(skillMd("pdf", "PDF toolkit"));
      }
      return new Response("nope", { status: 404 });
    });

    const skills = await fetchSkillsFromGitHub();
    expect(skills).toHaveLength(1);
    expect(skills[0].source_url).toBe(
      "https://github.com/anthropics/skills/tree/main/skills/pdf"
    );
  });

  it("falls back to built-in skills when all sources fail", async () => {
    installFetch(() => new Response("boom", { status: 500 }));
    const skills = await fetchSkillsFromGitHub();
    expect(skills.length).toBeGreaterThan(0);
    expect(skills.some((s) => s.name === "webapp-testing")).toBe(true);
  });

  it("returns empty from a source on rate limit without failing others", async () => {
    installFetch((url) => {
      if (url.includes("microsoft/skills/git/trees")) {
        return new Response("rate limited", { status: 403 });
      }
      if (url.includes("anthropics/skills/git/trees")) {
        return treeResponse(["skills/a1/SKILL.md"]);
      }
      if (url.includes("vercel-labs/agent-skills/git/trees")) {
        return treeResponse([]);
      }
      if (url.includes("raw.githubusercontent")) {
        return textResponse(skillMd("a1", "anth"));
      }
      return new Response("nope", { status: 404 });
    });

    const skills = await fetchSkillsFromGitHub();
    expect(skills.map((s) => s.name)).toEqual(["a1"]);
  });

  it("deduplicates concurrent in-flight requests", async () => {
    installFetch((url) => {
      if (url.includes("git/trees")) return treeResponse([]);
      return new Response("empty", { status: 404 });
    });

    const [a, b] = await Promise.all([fetchSkillsFromGitHub(), fetchSkillsFromGitHub()]);
    expect(a).toBe(b);
  });

  it("getProviders returns unique provider names", () => {
    expect(getProviders()).toEqual(["Anthropic", "Microsoft", "Vercel"]);
  });
});
