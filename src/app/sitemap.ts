import { createClient } from "@supabase/supabase-js";
import type { MetadataRoute } from "next";

export const dynamic = "force-dynamic";
export const revalidate = 3600; // regenerate at most once per hour

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://vibecodes.co.uk";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: BASE_URL,
      changeFrequency: "weekly",
      priority: 1.0,
    },
    {
      url: `${BASE_URL}/guide`,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${BASE_URL}/guide/getting-started`,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: `${BASE_URL}/guide/ideas-and-voting`,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: `${BASE_URL}/guide/collaboration`,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: `${BASE_URL}/guide/kanban-boards`,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: `${BASE_URL}/guide/ai-agent-teams`,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: `${BASE_URL}/guide/mcp-integration`,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: `${BASE_URL}/guide/admin`,
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: `${BASE_URL}/changelog`,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${BASE_URL}/press`,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${BASE_URL}/terms`,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${BASE_URL}/privacy`,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  // Race queries against a 10s timeout so builds don't fail when Supabase is slow
  const timeout = <T>(ms: number, fallback: T) =>
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms));

  const emptyResult = { data: [], error: null };

  const [ideasResult, usersResult] = await Promise.all([
    Promise.race([
      supabase
        .from("ideas")
        .select("id, updated_at, author_id")
        .eq("visibility", "public")
        .limit(50000),
      timeout(10000, emptyResult),
    ]),
    Promise.race([
      supabase
        .from("users")
        .select("id, updated_at")
        .eq("is_bot", false)
        .limit(50000),
      timeout(10000, emptyResult),
    ]),
  ]);

  if (ideasResult.error) {
    console.error("[sitemap] ideas query failed:", ideasResult.error.message);
  }
  if (usersResult.error) {
    console.error("[sitemap] users query failed:", usersResult.error.message);
  }

  const ideas = ideasResult.data ?? [];
  const users = usersResult.data ?? [];

  // Only include users who have authored at least one public idea
  const authorIds = new Set(ideas.map((idea) => idea.author_id));

  const ideaEntries: MetadataRoute.Sitemap = ideas.map((idea) => ({
    url: `${BASE_URL}/ideas/${idea.id}`,
    lastModified: idea.updated_at ? new Date(idea.updated_at) : undefined,
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  const profileEntries: MetadataRoute.Sitemap = users
    .filter((user) => authorIds.has(user.id))
    .map((user) => ({
      url: `${BASE_URL}/profile/${user.id}`,
      lastModified: user.updated_at ? new Date(user.updated_at) : undefined,
      changeFrequency: "monthly",
      priority: 0.5,
    }));

  return [...staticPages, ...ideaEntries, ...profileEntries];
}
