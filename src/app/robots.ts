import type { MetadataRoute } from "next";

// Opt out of build-time static prerendering. Next 16 intermittently fails to
// prerender /robots.txt under its multi-worker static-gen with "No response is
// returned from route handler in all branches", crashing the whole build (seen
// on several CI runs; force-static did NOT help — it keeps the route in that
// flaky path). Serving it dynamically skips build-time prerender entirely, the
// same approach sitemap.ts already uses successfully. robots() is trivial, so
// the per-request cost is negligible.
export const dynamic = "force-dynamic";

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
