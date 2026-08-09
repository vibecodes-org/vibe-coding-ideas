import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MINIMUM_RECOMMENDED_HELPER_VERSION } from "@/lib/terminal/helper-version";

function req(url: string): Request {
  return new Request(url);
}

describe("GET /download/terminal-helper", () => {
  beforeEach(() => {
    delete process.env.TERMINAL_HELPER_VERSION;
  });

  afterEach(() => {
    delete process.env.TERMINAL_HELPER_VERSION;
  });

  it("defaults to MINIMUM_RECOMMENDED_HELPER_VERSION and arm64 with no query string", async () => {
    const { GET } = await import("./route");
    const res = GET(req("https://vibecodes.co.uk/download/terminal-helper"));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      `https://github.com/vibecodes-org/vibe-coding-ideas/releases/download/terminal-helper-v${MINIMUM_RECOMMENDED_HELPER_VERSION}/VibeCodes-${MINIMUM_RECOMMENDED_HELPER_VERSION}-arm64.dmg`,
    );
  });

  it("overrides the version from TERMINAL_HELPER_VERSION when set", async () => {
    process.env.TERMINAL_HELPER_VERSION = "9.9.9";
    const { GET } = await import("./route");
    const res = GET(req("https://vibecodes.co.uk/download/terminal-helper"));
    expect(res.headers.get("location")).toBe(
      "https://github.com/vibecodes-org/vibe-coding-ideas/releases/download/terminal-helper-v9.9.9/VibeCodes-9.9.9-arm64.dmg",
    );
  });

  it("builds the x64 asset URL when ?arch=x64 is passed", async () => {
    const { GET } = await import("./route");
    const res = GET(req("https://vibecodes.co.uk/download/terminal-helper?arch=x64"));
    expect(res.headers.get("location")).toBe(
      `https://github.com/vibecodes-org/vibe-coding-ideas/releases/download/terminal-helper-v${MINIMUM_RECOMMENDED_HELPER_VERSION}/VibeCodes-${MINIMUM_RECOMMENDED_HELPER_VERSION}-x64.dmg`,
    );
  });

  it("falls back to arm64 for any arch value outside the allowlist", async () => {
    const { GET } = await import("./route");
    for (const bogus of ["x86", "arm", "ARM64", "x64 ", "../../etc/passwd", ""]) {
      const res = GET(req(`https://vibecodes.co.uk/download/terminal-helper?arch=${encodeURIComponent(bogus)}`));
      expect(res.headers.get("location")).toContain(`-${MINIMUM_RECOMMENDED_HELPER_VERSION}-arm64.dmg`);
    }
  });

  it("always sets Cache-Control: no-store so a version bump is picked up immediately", async () => {
    const { GET } = await import("./route");
    const res = GET(req("https://vibecodes.co.uk/download/terminal-helper"));
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("is a 302 (not a permanent redirect) so the target can keep changing", async () => {
    const { GET } = await import("./route");
    const res = GET(req("https://vibecodes.co.uk/download/terminal-helper"));
    expect(res.status).toBe(302);
  });
});
