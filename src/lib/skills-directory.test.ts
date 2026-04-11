import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fetchSkillsFromGitHub, clearSkillsCache } from "./skills-directory";

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

function dir(name: string) {
  return { name, type: "dir", path: name, download_url: null };
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

  it("merges flat and nested Microsoft sources with Anthropic and Vercel", async () => {
    installFetch((url) => {
      // Top-level directory listings
      if (url.includes("/repos/anthropics/skills/contents/skills")) {
        return jsonResponse([dir("a1"), dir("a2")]);
      }
      if (url.includes("/repos/microsoft/skills/contents/.github/skills")) {
        return jsonResponse([dir("m-flat-1")]);
      }
      if (url.endsWith("/repos/microsoft/skills/contents/skills")) {
        return jsonResponse([dir("python"), dir("rust")]);
      }
      if (url.endsWith("/repos/microsoft/skills/contents/skills/python")) {
        return jsonResponse([dir("py1"), dir("py2")]);
      }
      if (url.endsWith("/repos/microsoft/skills/contents/skills/rust")) {
        return jsonResponse([dir("rs1")]);
      }
      if (url.includes("/repos/vercel-labs/agent-skills/contents/skills")) {
        return jsonResponse([dir("v1")]);
      }

      // Raw SKILL.md fetches — match nested paths too
      const rawMatch = url.match(/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/main\/(.+)\/SKILL\.md$/);
      if (rawMatch) {
        const [, , , fullPath] = rawMatch;
        const leaf = fullPath.split("/").pop() ?? "unknown";
        return textResponse(skillMd(leaf, `desc for ${leaf}`));
      }

      return new Response("not found", { status: 404 });
    });

    const skills = await fetchSkillsFromGitHub();
    const names = skills.map((s) => s.name).sort();

    // Anthropic: a1, a2 — Microsoft flat: m-flat-1 — Microsoft nested: py1, py2, rs1 — Vercel: v1
    expect(names).toEqual(["a1", "a2", "m-flat-1", "py1", "py2", "rs1", "v1"]);

    const providers = new Set(skills.map((s) => s.provider));
    expect(providers).toEqual(new Set(["Anthropic", "Microsoft", "Vercel"]));

    // Nested Microsoft skill has correct source URL including the language category
    const py1 = skills.find((s) => s.name === "py1");
    expect(py1?.provider).toBe("Microsoft");
    expect(py1?.source_url).toBe(
      "https://github.com/microsoft/skills/tree/main/skills/python/py1"
    );
  });

  it("falls back to built-in skills when all sources fail", async () => {
    installFetch(() => new Response("boom", { status: 500 }));
    const skills = await fetchSkillsFromGitHub();
    // Fallback list has at least one entry and includes known fallback names
    expect(skills.length).toBeGreaterThan(0);
    expect(skills.some((s) => s.name === "webapp-testing")).toBe(true);
  });

  it("deduplicates concurrent in-flight requests", async () => {
    let callCount = 0;
    installFetch((url) => {
      if (url.includes("api.github.com")) {
        callCount++;
        return jsonResponse([dir("only")]);
      }
      return textResponse(skillMd("only", "only desc"));
    });

    const [a, b] = await Promise.all([fetchSkillsFromGitHub(), fetchSkillsFromGitHub()]);
    expect(a).toBe(b); // same reference — cached/deduped
    // Each API call should have happened exactly once per source, not twice
    // (4 sources configured: Anthropic, MS flat, MS nested top, Vercel — MS nested also does 1 inner listing per category, but "only" dir means 1)
    // We just assert it didn't double up to 8+.
    expect(callCount).toBeLessThan(10);
  });
});
