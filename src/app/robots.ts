import type { MetadataRoute } from "next";

// Force static generation. Without this, Next 16 intermittently tries to
// prerender /robots.txt as a *dynamic* route handler and fails the build with
// "No response is returned from route handler in all branches" — the same CI
// flake fixed for manifest.ts in aca8dac. robots() is pure, so static is correct.
export const dynamic = "force-static";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://vibecodes.co.uk";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/guide/", "/changelog", "/terms", "/privacy"],
        disallow: [
          "/api/",
          "/dashboard",
          "/admin",
          "/agents",
          "/ideas/new",
          "/ideas/*/edit",
          "/ideas/*/board",
          "/oauth/",
          "/ingest/",
          "/.well-known/",
          "/monitoring",
        ],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
