import { changelog } from "@/data/changelog";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://vibecodes.co.uk";

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function GET() {
  const items = changelog
    .map(
      (entry) => `    <item>
      <title>${escapeXml(entry.title)}</title>
      <link>${BASE_URL}/changelog#${entry.isoDate}</link>
      <guid isPermaLink="true">${BASE_URL}/changelog#${entry.isoDate}</guid>
      <pubDate>${new Date(entry.isoDate + "T12:00:00Z").toUTCString()}</pubDate>
      <description>${escapeXml(
        entry.items.map((item) => `[${item.type}] ${item.description}`).join("\n")
      )}</description>
    </item>`,
    )
    .join("\n");

  const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>VibeCodes Changelog</title>
    <link>${BASE_URL}/changelog</link>
    <description>New features, improvements, and fixes from VibeCodes</description>
    <language>en-gb</language>
    <atom:link href="${BASE_URL}/feed.xml" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>`;

  return new Response(feed, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
