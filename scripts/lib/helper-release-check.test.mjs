import { describe, it, expect } from "vitest";
import { checkReleaseFiles, releaseReport } from "./helper-release-check.mjs";
import { helperAssetUrls } from "../../src/lib/terminal/helper-assets";

describe("helper release check (card 51d424f7)", () => {
  const urls = helperAssetUrls("0.4.0");

  it("checks all 6 files with a HEAD request that follows the redirect", async () => {
    const seen = [];
    const results = await checkReleaseFiles(urls, async (url, init) => {
      seen.push([url, init]);
      return { ok: true, status: 200 };
    });
    expect(seen).toHaveLength(6);
    expect(seen.every(([, init]) => init.method === "HEAD" && init.redirect === "follow")).toBe(true);
    const report = releaseReport("0.4.0", results);
    expect(report.ok).toBe(true);
    expect(report.lines.at(-1)).toBe("Helper 0.4.0: all 6 files are on the release.");
  });

  it("fails when one Windows installer is missing, naming it", async () => {
    const results = await checkReleaseFiles(urls, async (url) =>
      url.endsWith("Setup-0.4.0-arm64.exe") ? { ok: false, status: 404 } : { ok: true, status: 200 },
    );
    const report = releaseReport("0.4.0", results);
    expect(report.ok).toBe(false);
    expect(report.lines.filter((l) => l.startsWith("MISSING"))).toEqual([
      "MISSING 404 https://github.com/vibecodes-org/vibe-coding-ideas/releases/download/terminal-helper-v0.4.0/VibeCodes-Setup-0.4.0-arm64.exe",
    ]);
    expect(report.lines.at(-1)).toContain("1 of 6 files are missing");
  });

  it("a network error counts as missing, never as present", async () => {
    const results = await checkReleaseFiles(urls.slice(0, 1), async () => {
      throw new Error("offline");
    });
    expect(results).toEqual([{ url: urls[0], ok: false, status: null }]);
    expect(releaseReport("0.4.0", results).ok).toBe(false);
  });
});
