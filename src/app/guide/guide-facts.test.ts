import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GUIDE_SECTIONS } from "@/components/guide/guide-sections";
import { MCP_TOOL_COUNT } from "@/lib/site-facts";

const GUIDE_DIR = join(process.cwd(), "src/app/guide");
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const slugs = GUIDE_SECTIONS.map((s) => s.slug);
const pageSource = (slug: string) => readFileSync(join(GUIDE_DIR, slug, "page.tsx"), "utf8");

// Text a reader can see: every guide page, the home page, the sidebar list and the pipeline strip.
function visibleSources(): { name: string; text: string }[] {
  const files = [
    ...slugs.map((s) => ({ name: `guide/${s}`, text: pageSource(s) })),
    { name: "guide/page", text: read("src/app/guide/page.tsx") },
    { name: "guide-sections", text: read("src/components/guide/guide-sections.ts") },
    { name: "pipeline-flow", text: read("src/components/landing/pipeline-flow.tsx") },
  ];
  return files.map((f) => ({ ...f, text: f.text.replace(/\s+/g, " ") }));
}

describe("guide page list", () => {
  it("has a page.tsx for every sidebar entry and no page missing from the sidebar", () => {
    const folders = readdirSync(GUIDE_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(GUIDE_DIR, d.name, "page.tsx")))
      .map((d) => d.name);
    expect([...folders].sort()).toEqual([...slugs].sort());
  });

  it("lists 12 pages in reading order with the new Settings page before Admin", () => {
    expect(slugs).toEqual([
      "getting-started",
      "ideas-and-voting",
      "collaboration",
      "discussions",
      "kanban-boards",
      "project-kits",
      "workflows",
      "mcp-integration",
      "launching-claude-code",
      "ai-agent-teams",
      "settings",
      "admin",
    ]);
  });

  it("keeps the old addresses and gives the renamed pages their new titles", () => {
    const title = (slug: string) => GUIDE_SECTIONS.find((s) => s.slug === slug)?.title;
    expect(title("launching-claude-code")).toBe("Launching Claude Code or Codex");
    expect(title("project-kits")).toBe("Project Types");
  });
});

describe("MCP page facts", () => {
  const mcp = pageSource("mcp-integration");

  it("lists exactly the tools the server registers", () => {
    const listed = [...mcp.matchAll(/name:\s*"([a-z_]+)"/g)].map((m) => m[1]);
    const registered = [
      ...read("mcp-server/src/register-tools.ts").matchAll(/registerTool\(\s*"([a-z_]+)"/g),
    ].map((m) => m[1]);
    expect(registered.length).toBe(MCP_TOOL_COUNT);
    expect([...new Set(listed)].sort()).toEqual([...registered].sort());
  });

  it("reads the tool count from the shared facts, never types it", () => {
    expect(mcp).toContain("MCP_TOOL_COUNT");
    expect(mcp.replace(/\s+/g, " ")).not.toMatch(/\b\d{2,3}\s+(VibeCodes\s+)?tools\b/);
  });
});

describe("retired wording stays out of the guide", () => {
  const banned = [
    "milestones",
    "12 colors",
    "Apply All",
    "Design Sprint",
    "Contextual Nudges",
    "Switch to my Developer agent",
    "never leaves your computer",
    "all 86",
    "Rematch",
    "three default",
    "Explore the Feed",
    "profile page",
    "rate limits",
  ];
  for (const phrase of banned) {
    it(`does not say "${phrase}"`, () => {
      const pattern = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      const hits = visibleSources()
        .filter((f) => pattern.test(f.text))
        .map((f) => f.name);
      expect(hits).toEqual([]);
    });
  }
});
