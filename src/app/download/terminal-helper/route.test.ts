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

describe("GET /download/terminal-helper — Windows (card 51d424f7)", () => {
  const V = MINIMUM_RECOMMENDED_HELPER_VERSION;
  const base = `https://github.com/vibecodes-org/vibe-coding-ideas/releases/download/terminal-helper-v${V}`;
  const WIN_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
  const MAC_UA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

  beforeEach(() => {
    delete process.env.TERMINAL_HELPER_VERSION;
  });

  it("?os=win sends the x64 installer, with no-store and a 302", async () => {
    const { GET } = await import("./route");
    const res = GET(req("https://vibecodes.co.uk/download/terminal-helper?os=win"));
    expect(res.status).toBe(302);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("location")).toBe(`${base}/VibeCodes-Setup-${V}-x64.exe`);
  });

  it("?os=win&arch=arm64 sends the ARM installer", async () => {
    const { GET } = await import("./route");
    const res = GET(req("https://vibecodes.co.uk/download/terminal-helper?os=win&arch=arm64"));
    expect(res.headers.get("location")).toBe(`${base}/VibeCodes-Setup-${V}-arm64.exe`);
  });

  it("any other Windows arch falls back to x64", async () => {
    const { GET } = await import("./route");
    for (const bogus of ["x86", "arm", "ARM64", "arm64 ", "../../x", ""]) {
      const res = GET(
        req(`https://vibecodes.co.uk/download/terminal-helper?os=win&arch=${encodeURIComponent(bogus)}`),
      );
      expect(res.headers.get("location")).toBe(`${base}/VibeCodes-Setup-${V}-x64.exe`);
    }
  });

  it("no os but a Windows browser gets the Windows x64 installer", async () => {
    const { GET } = await import("./route");
    const res = GET(
      new Request("https://vibecodes.co.uk/download/terminal-helper", { headers: { "user-agent": WIN_UA } }),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("location")).toBe(`${base}/VibeCodes-Setup-${V}-x64.exe`);
  });

  it("?os=mac wins over a Windows browser, and a Mac browser is unchanged", async () => {
    const { GET } = await import("./route");
    const forced = GET(
      new Request("https://vibecodes.co.uk/download/terminal-helper?os=mac", { headers: { "user-agent": WIN_UA } }),
    );
    expect(forced.headers.get("location")).toBe(`${base}/VibeCodes-${V}-arm64.dmg`);
    const mac = GET(
      new Request("https://vibecodes.co.uk/download/terminal-helper?arch=x64", { headers: { "user-agent": MAC_UA } }),
    );
    expect(mac.headers.get("location")).toBe(`${base}/VibeCodes-${V}-x64.dmg`);
  });

  it("TERMINAL_HELPER_VERSION applies to Windows too", async () => {
    process.env.TERMINAL_HELPER_VERSION = "9.9.9";
    const { GET } = await import("./route");
    const res = GET(req("https://vibecodes.co.uk/download/terminal-helper?os=win&arch=arm64"));
    expect(res.headers.get("location")).toBe(
      "https://github.com/vibecodes-org/vibe-coding-ideas/releases/download/terminal-helper-v9.9.9/VibeCodes-Setup-9.9.9-arm64.exe",
    );
  });
});
