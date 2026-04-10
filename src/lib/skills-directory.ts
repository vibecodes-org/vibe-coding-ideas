/**
 * Fetches and caches the community skills directory from Anthropic's GitHub repo.
 * Falls back to a built-in curated list when GitHub is unavailable.
 */

import { parseSkillMd } from "./skill-md";

export interface SkillDirectoryEntry {
  name: string;
  description: string;
  content: string;
  category: string | null;
  source_url: string;
}

// In-memory cache with TTL + in-flight deduplication
let cachedDirectory: SkillDirectoryEntry[] | null = null;
let cacheTimestamp = 0;
let inflight: Promise<SkillDirectoryEntry[]> | null = null;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_CONTENT_LENGTH = 200_000; // 200KB per skill

/** Category inference from skill name/description */
function inferCategory(name: string, description: string): string | null {
  const text = `${name} ${description}`.toLowerCase();

  if (/pdf|docx|pptx|xlsx|document|spreadsheet|presentation/.test(text)) return "Document";
  if (/test|qa|debug|lint|review/.test(text)) return "Development";
  if (/mcp|api|server|build|deploy|code/.test(text)) return "Development";
  if (/design|art|pixel|canvas|theme|frontend|ui|ux/.test(text)) return "Creative";
  if (/brand|comms|internal|enterprise|legal/.test(text)) return "Enterprise";

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
  },
  {
    name: "create-pdf",
    description: "Create and manipulate PDF documents with text, images, tables, headers, footers, and complex formatting.",
    content: "# PDF Creation\n\nUse this skill when creating PDF documents.\n\n1. Set up document structure\n2. Add content (text, images, tables)\n3. Apply formatting\n4. Generate the PDF file",
    category: "Document",
    source_url: "https://github.com/anthropics/skills/tree/main/skills/pdf",
  },
  {
    name: "mcp-builder",
    description: "Build Model Context Protocol servers with proper transport setup, tool registration, resource handling, and error management.",
    content: "# MCP Server Builder\n\nUse this skill when building MCP servers.\n\n1. Set up the transport layer\n2. Register tools with schemas\n3. Implement handlers\n4. Add error handling",
    category: "Development",
    source_url: "https://github.com/anthropics/skills/tree/main/skills/mcp-builder",
  },
  {
    name: "frontend-design",
    description: "Create distinctive, production-grade frontend interfaces with high design quality.",
    content: "# Frontend Design\n\nUse this skill when building web interfaces.\n\n1. Understand the context and audience\n2. Choose a bold aesthetic direction\n3. Implement with attention to detail\n4. Ensure accessibility and responsiveness",
    category: "Creative",
    source_url: "https://github.com/anthropics/skills/tree/main/skills/frontend-design",
  },
  {
    name: "claude-api",
    description: "Build applications using the Claude API and Anthropic SDKs with best practices for prompting, tool use, and error handling.",
    content: "# Claude API\n\nUse this skill when building Claude API applications.\n\n1. Set up the Anthropic SDK\n2. Configure the client\n3. Implement tool use\n4. Handle streaming and errors",
    category: "Development",
    source_url: "https://github.com/anthropics/skills/tree/main/skills/claude-api",
  },
];

interface GitHubContent {
  name: string;
  type: string;
  path: string;
  download_url: string | null;
}

/**
 * Fetch skills from Anthropic's GitHub repo.
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

  inflight = _fetchFromGitHub().finally(() => { inflight = null; });
  return inflight;
}

async function _fetchFromGitHub(): Promise<SkillDirectoryEntry[]> {
  try {
    // List skill directories
    const res = await fetch(
      "https://api.github.com/repos/anthropics/skills/contents/skills",
      {
        headers: { Accept: "application/vnd.github.v3+json" },
        signal: AbortSignal.timeout(10000),
      }
    );

    // Handle rate limiting — keep stale cache, backoff
    if (res.status === 403 || res.status === 429) {
      if (cachedDirectory) {
        cacheTimestamp = Date.now(); // prevent re-fetching immediately
        return cachedDirectory;
      }
      return FALLBACK_SKILLS;
    }

    if (!res.ok) throw new Error(`GitHub API: ${res.status}`);

    const contents: GitHubContent[] = await res.json();
    const dirs = contents.filter((c) => c.type === "dir");

    // Fetch each skill's SKILL.md in parallel (with limit)
    const entries: SkillDirectoryEntry[] = [];
    const batchSize = 5;

    for (let i = 0; i < dirs.length; i += batchSize) {
      const batch = dirs.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map(async (dir) => {
          const rawUrl = `https://raw.githubusercontent.com/anthropics/skills/main/skills/${dir.name}/SKILL.md`;
          const skillRes = await fetch(rawUrl, {
            signal: AbortSignal.timeout(5000),
          });
          if (!skillRes.ok) return null;

          const text = await skillRes.text();
          const parsed = parseSkillMd(text);

          return {
            name: parsed.name,
            description: parsed.description,
            content: parsed.body.slice(0, MAX_CONTENT_LENGTH),
            category: inferCategory(parsed.name, parsed.description),
            source_url: `https://github.com/anthropics/skills/tree/main/skills/${dir.name}`,
          } satisfies SkillDirectoryEntry;
        })
      );

      for (const result of results) {
        if (result.status === "fulfilled" && result.value) {
          entries.push(result.value);
        }
      }
    }

    // Cache results
    cachedDirectory = entries;
    cacheTimestamp = Date.now();

    return entries;
  } catch {
    // On error, prefer stale cache over fallback
    if (cachedDirectory) return cachedDirectory;
    return FALLBACK_SKILLS;
  }
}

/**
 * Get the fallback skills list (always available, no network needed).
 */
export function getFallbackSkills(): SkillDirectoryEntry[] {
  return FALLBACK_SKILLS;
}

/**
 * Clear the cache (useful for testing or manual refresh).
 */
export function clearSkillsCache(): void {
  cachedDirectory = null;
  cacheTimestamp = 0;
}
