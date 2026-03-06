import type { MetadataRoute } from "next";

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
