/**
 * Fetches and caches the community skills directory from multiple GitHub repos.
 * Falls back to a built-in curated list when GitHub is unavailable.
 *
 * Uses the GitHub git trees recursive API to find every SKILL.md in a repo
 * with a single API call, regardless of directory depth or symlinks.
 *
 * Sources (approximate SKILL.md counts):
 * - Anthropic (~18): github.com/anthropics/skills
 * - Microsoft (~177): github.com/microsoft/skills — skills live under
 *   .github/skills and .github/plugins/{plugin}/skills
 * - Vercel (~7): github.com/vercel-labs/agent-skills
 */

import { parseSkillMd } from "./skill-md";

export interface SkillDirectoryEntry {
  name: string;
  description: string;
  content: string;
  category: string | null;
  source_url: string;
  provider: string;
}

// In-memory cache with TTL + in-flight deduplication
let cachedDirectory: SkillDirectoryEntry[] | null = null;
let cacheTimestamp = 0;
let inflight: Promise<SkillDirectoryEntry[]> | null = null;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_CONTENT_LENGTH = 200_000; // 200KB per skill

/** Skill sources — each is a GitHub repo scanned via git trees API */
interface SkillSource {
  provider: string;
  owner: string;
  repo: string;
  branch: string;
  /**
   * Optional path filter. If set, only SKILL.md files whose path starts
   * with one of these prefixes are included. Use to exclude docs/test
   * SKILL.md files that aren't real skills.
   */
  pathPrefixes?: string[];
}

const SOURCES: SkillSource[] = [
  {
    provider: "Anthropic",
    owner: "anthropics",
    repo: "skills",
    branch: "main",
  },
  {
    provider: "Microsoft",
    owner: "microsoft",
    repo: "skills",
    branch: "main",
    pathPrefixes: [".github/skills/", ".github/plugins/"],
  },
  {
    provider: "Vercel",
    owner: "vercel-labs",
    repo: "agent-skills",
    branch: "main",
  },
];

/** Category inference from skill name/description */
function inferCategory(name: string, description: string): string | null {
  const text = `${name} ${description}`.toLowerCase();

  if (/pdf|docx|pptx|xlsx|document|spreadsheet|presentation/.test(text)) return "Document";
  if (/test|qa|debug|lint|review/.test(text)) return "Development";
  if (/mcp|api|server|build|deploy|code|sdk|cli/.test(text)) return "Development";
  if (/design|art|pixel|canvas|theme|frontend|ui|ux|css|react|animation/.test(text)) return "Creative";
  if (/brand|comms|internal|enterprise|legal|architect/.test(text)) return "Enterprise";
  if (/azure|cosmos|blob|event|service.bus|entra|key.vault|monitor/.test(text)) return "Cloud";
  if (/python|dotnet|typescript|java|rust|spring/.test(text)) return "Development";

  return null;
}

/** Built-in fallback when GitHub is unavailable */
const FALLBACK_SKILLS: SkillDirectoryEntry[] = [
  {
    name: "webapp-testing",
    description: "Test web applications by launching browsers, navigating pages, clicking elements, filling forms, and verifying behavior.",
    content: "# Web App Testing\n\nUse this skill when testing web applications.\n\n1. Launch a browser\n2. Navigate to the target URL\n3. Interact with elements\n4. Verify expected behavior\n5. Report findings",
    category: "Development",
    source_url: "https://github.com/anthropics/skills/tree/main/skills/webapp-testing",
    provider: "Anthropic",
  },
  {
    name: "create-pdf",
    description: "Create and manipulate PDF documents with text, images, tables, headers, footers, and complex formatting.",
    content: "# PDF Creation\n\nUse this skill when creating PDF documents.\n\n1. Set up document structure\n2. Add content (text, images, tables)\n3. Apply formatting\n4. Generate the PDF file",
    category: "Document",
    source_url: "https://github.com/anthropics/skills/tree/main/skills/pdf",
    provider: "Anthropic",
  },
  {
    name: "mcp-builder",
    description: "Build Model Context Protocol servers with proper transport setup, tool registration, resource handling, and error management.",
    content: "# MCP Server Builder\n\nUse this skill when building MCP servers.\n\n1. Set up the transport layer\n2. Register tools with schemas\n3. Implement handlers\n4. Add error handling",
    category: "Development",
    source_url: "https://github.com/anthropics/skills/tree/main/skills/mcp-builder",
    provider: "Anthropic",
  },
  {
    name: "react-best-practices",
    description: "40+ performance rules across 8 categories for React applications including waterfalls, bundle optimization, and re-renders.",
    content: "# React Best Practices\n\nUse this skill when building React applications.\n\n1. Avoid render waterfalls\n2. Optimize bundle size\n3. Prevent unnecessary re-renders\n4. Use proper state management",
    category: "Creative",
    source_url: "https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices",
    provider: "Vercel",
  },
  {
    name: "copilot-sdk-py",
    description: "Build AI agents using the Microsoft Copilot SDK for Python with best practices for tool use and orchestration.",
    content: "# Copilot SDK (Python)\n\nUse this skill when building AI agents with the Microsoft Copilot SDK.\n\n1. Set up the SDK\n2. Define agent capabilities\n3. Implement tool handlers\n4. Configure orchestration",
    category: "Development",
    source_url: "https://github.com/microsoft/skills/tree/main/.github/skills/copilot-sdk-py",
    provider: "Microsoft",
  },
];

interface GitHubTreeEntry {
  path: string;
  type: string;
}

interface GitHubTreeResponse {
  tree: GitHubTreeEntry[];
  truncated: boolean;
}

/**
 * Fetch skills from all configured GitHub repos.
 * Returns cached results if available and fresh.
 * Uses in-flight deduplication to prevent stampedes.
 */
export async function fetchSkillsFromGitHub(): Promise<SkillDirectoryEntry[]> {
  // Return cache if fresh
  if (cachedDirectory && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
    return cachedDirectory;
  }

  // Deduplicate in-flight requests
  if (inflight) return inflight;

  inflight = _fetchAllSources().finally(() => { inflight = null; });
  return inflight;
}

/** Fetch from all sources in parallel, merge results */
async function _fetchAllSources(): Promise<SkillDirectoryEntry[]> {
  try {
    const results = await Promise.allSettled(
      SOURCES.map((source) => _fetchFromSource(source))
    );

    // Dedupe by skill name, preserving first occurrence (source order wins —
    // see SOURCES above). Multiple repos publish the same canonical skills
    // (e.g. mcp-builder exists in both anthropics/skills and microsoft/skills),
    // and showing duplicates breaks React key reconciliation in the UI.
    const seenNames = new Set<string>();
    const allEntries: SkillDirectoryEntry[] = [];
    for (const result of results) {
      if (result.status === "fulfilled") {
        for (const entry of result.value) {
          if (seenNames.has(entry.name)) continue;
          seenNames.add(entry.name);
          allEntries.push(entry);
        }
      }
    }

    // If we got at least some results, cache them
    if (allEntries.length > 0) {
      cachedDirectory = allEntries;
      cacheTimestamp = Date.now();
      return allEntries;
    }

    // All sources failed — use stale cache or fallback
    if (cachedDirectory) return cachedDirectory;
    return FALLBACK_SKILLS;
  } catch {
    if (cachedDirectory) return cachedDirectory;
    return FALLBACK_SKILLS;
  }
}

/**
 * List every SKILL.md path in a repo using the git trees recursive API.
 * Returns an array of paths like ".github/plugins/foo/skills/bar/SKILL.md".
 */
async function _listSkillPaths(source: SkillSource): Promise<string[]> {
  const treeUrl = `https://api.github.com/repos/${source.owner}/${source.repo}/git/trees/${source.branch}?recursive=1`;
  const res = await fetch(treeUrl, {
    headers: { Accept: "application/vnd.github.v3+json" },
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 403 || res.status === 429) return [];
  if (!res.ok) return [];

  const json = (await res.json()) as GitHubTreeResponse;
  let paths = json.tree
    .filter((e) => e.type === "blob" && e.path.endsWith("/SKILL.md"))
    .map((e) => e.path);

  if (source.pathPrefixes && source.pathPrefixes.length > 0) {
    paths = paths.filter((p) => source.pathPrefixes!.some((prefix) => p.startsWith(prefix)));
  }
  return paths;
}

/** Fetch skills from a single GitHub source using the git trees API */
async function _fetchFromSource(source: SkillSource): Promise<SkillDirectoryEntry[]> {
  const skillPaths = await _listSkillPaths(source);

  const entries: SkillDirectoryEntry[] = [];
  const batchSize = 15;

  for (let i = 0; i < skillPaths.length; i += batchSize) {
    const batch = skillPaths.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(async (filePath) => {
        const rawUrl = `https://raw.githubusercontent.com/${source.owner}/${source.repo}/${source.branch}/${filePath}`;
        const skillRes = await fetch(rawUrl, {
          signal: AbortSignal.timeout(8000),
        });
        if (!skillRes.ok) return null;

        const text = await skillRes.text();
        const parsed = parseSkillMd(text);
        const dirPath = filePath.slice(0, -"/SKILL.md".length);

        return {
          name: parsed.name,
          description: parsed.description,
          content: parsed.body.slice(0, MAX_CONTENT_LENGTH),
          category: inferCategory(parsed.name, parsed.description),
          source_url: `https://github.com/${source.owner}/${source.repo}/tree/${source.branch}/${dirPath}`,
          provider: source.provider,
        } satisfies SkillDirectoryEntry;
      })
    );

    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        entries.push(result.value);
      }
    }
  }

  return entries;
}

/**
 * Get the fallback skills list (always available, no network needed).
 */
export function getFallbackSkills(): SkillDirectoryEntry[] {
  return FALLBACK_SKILLS;
}

/**
 * Get the list of all provider names.
 */
export function getProviders(): string[] {
  return Array.from(new Set(SOURCES.map((s) => s.provider)));
}

/**
 * Clear the cache (useful for testing or manual refresh).
 */
export function clearSkillsCache(): void {
  cachedDirectory = null;
  cacheTimestamp = 0;
}
