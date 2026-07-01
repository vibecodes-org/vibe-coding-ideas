import { describe, it, expect } from "vitest";
import {
  resolveTerminalPlatform,
  TERMINAL_HELPER_DOWNLOAD_URL,
  type PlatformSignals,
} from "./platform";

// Representative UA strings (trimmed) — browsers report "Intel Mac OS X" even on
// Apple Silicon, which is exactly why the arch signal (not the UA) decides Intel.
const APPLE_SILICON_MAC: PlatformSignals = {
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  platform: "MacIntel",
  uaDataPlatform: "macOS",
  maxTouchPoints: 0,
};

const WINDOWS: PlatformSignals = {
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
  platform: "Win32",
  uaDataPlatform: "Windows",
  maxTouchPoints: 0,
};

describe("resolveTerminalPlatform — Apple Silicon Mac (supported)", () => {
  it("is a supported Apple-Silicon target with the OS/arch-aware download", () => {
    const p = resolveTerminalPlatform(APPLE_SILICON_MAC);
    expect(p.os).toBe("mac");
    expect(p.isAppleSilicon).toBe(true);
    expect(p.supported).toBe(true);
    expect(p.downloadLabel).toBe("Download for Mac (Apple Silicon)");
    expect(p.downloadUrl).toBe(TERMINAL_HELPER_DOWNLOAD_URL);
  });

  it("stays Apple Silicon when the arch signal confirms arm", () => {
    const p = resolveTerminalPlatform({ ...APPLE_SILICON_MAC, architecture: "arm" });
    expect(p.supported).toBe(true);
    expect(p.isAppleSilicon).toBe(true);
  });
});

describe("resolveTerminalPlatform — Intel Mac (unsupported)", () => {
  it("routes an x86 Mac to coming-soon with no download target", () => {
    const p = resolveTerminalPlatform({ ...APPLE_SILICON_MAC, architecture: "x86" });
    expect(p.os).toBe("mac");
    expect(p.isAppleSilicon).toBe(false);
    expect(p.supported).toBe(false);
    expect(p.downloadUrl).toBeNull();
  });

  it("treats x86_64 the same as x86", () => {
    const p = resolveTerminalPlatform({ ...APPLE_SILICON_MAC, architecture: "x86_64" });
    expect(p.supported).toBe(false);
  });
});

describe("resolveTerminalPlatform — non-Mac (coming soon, no deep link)", () => {
  it("Windows is unsupported with a null download url", () => {
    const p = resolveTerminalPlatform(WINDOWS);
    expect(p.os).toBe("windows");
    expect(p.supported).toBe(false);
    expect(p.downloadUrl).toBeNull();
    expect(p.downloadLabel).toBe("Download for Windows");
  });

  it("Linux resolves to 'other' and unsupported", () => {
    const p = resolveTerminalPlatform({
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      platform: "Linux x86_64",
    });
    expect(p.os).toBe("other");
    expect(p.supported).toBe(false);
  });

  it("iPhone is unsupported even though it is Apple hardware", () => {
    const p = resolveTerminalPlatform({
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
      platform: "iPhone",
      maxTouchPoints: 5,
    });
    expect(p.os).toBe("other");
    expect(p.supported).toBe(false);
  });

  it("an iPad masquerading as Macintosh (touch points) is not treated as a Mac", () => {
    const p = resolveTerminalPlatform({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15",
      platform: "MacIntel",
      uaDataPlatform: "macOS",
      maxTouchPoints: 5,
    });
    expect(p.os).toBe("other");
    expect(p.supported).toBe(false);
  });
});

describe("resolveTerminalPlatform — SSR / empty signals", () => {
  it("an empty navigator (server) is unsupported, never a deep-link target", () => {
    const p = resolveTerminalPlatform({ userAgent: "" });
    expect(p.os).toBe("other");
    expect(p.supported).toBe(false);
    expect(p.downloadUrl).toBeNull();
  });
});
