import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const offlineHtml = readFileSync(join(process.cwd(), "public/offline.html"), "utf-8");
const swJs = readFileSync(join(process.cwd(), "public/sw.js"), "utf-8");

describe("public/offline.html", () => {
  it("has a Try again control", () => {
    expect(offlineHtml).toMatch(/Try again/);
  });

  it("listens for the browser's online event", () => {
    expect(offlineHtml).toMatch(/addEventListener\(\s*["']online["']/);
  });

  it("probes the health endpoint to detect real connectivity", () => {
    expect(offlineHtml).toMatch(/\/api\/health/);
  });

  it("reloads the page once connectivity is confirmed", () => {
    expect(offlineHtml).toMatch(/location\.reload\(\)/);
  });

  it("does not reference any external script or stylesheet", () => {
    // Must keep working entirely from the service worker cache while offline.
    expect(offlineHtml).not.toMatch(/<script[^>]+src=/i);
    expect(offlineHtml).not.toMatch(/<link[^>]+rel=["']stylesheet["']/i);
  });
});

describe("public/sw.js", () => {
  it("bumps the cache name past the version that trapped stale offline.html copies", () => {
    expect(swJs).not.toMatch(/CACHE_NAME\s*=\s*["']vibecodes-v3["']/);
  });

  it("still precaches /offline.html", () => {
    expect(swJs).toMatch(/cache\.add\(\s*["']\/offline\.html["']\s*\)/);
  });
});
