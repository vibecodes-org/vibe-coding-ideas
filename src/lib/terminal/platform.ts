// In-app terminal — client OS / architecture detection for the install-first flow.
//
// The in-browser terminal only works on machines we ship a helper for: any Mac
// (an arm64 and an x64 DMG per release) and, from helper 0.4.0, any Windows PC
// (an x64 and an arm64 installer per release; card 51d424f7). See
// src/app/download/terminal-helper/route.ts. Everything else (Linux, phones,
// tablets) lands on a calm "coming soon" and NEVER fires the `vibecodes://` deep
// link (so they are never ambushed by an OS dialog for a scheme nothing handles).
//
// resolveTerminalPlatform() is PURE — it takes explicit signals so the whole
// OS/arch policy is unit-testable without a real navigator. readPlatformSignals()
// is the only impure part: it pulls those signals off `navigator` at the call site
// and is SSR-safe (no navigator → treated as an unsupported machine).

export type TerminalOs = "mac" | "windows" | "other";

/** Where the OS-aware download always points for a supported (Apple Silicon) Mac. */
export const TERMINAL_HELPER_DOWNLOAD_URL = "/download/terminal-helper";

/** The Windows download (x64 unless `arch=arm64` is added). */
export const TERMINAL_HELPER_WINDOWS_DOWNLOAD_URL = "/download/terminal-helper?os=win";

/** The small "other version" link under the main download button. */
export interface AltDownload {
  prompt: string;
  label: string;
  href: string;
}

export interface PlatformSignals {
  /** navigator.userAgent — always present in a browser. */
  userAgent: string;
  /** navigator.platform (legacy, still a useful coarse signal). */
  platform?: string;
  /** navigator.userAgentData.platform (Chromium) — "macOS" | "Windows" | … */
  uaDataPlatform?: string;
  /**
   * UA-CH high-entropy architecture ("arm" | "x86" | …) when the caller has
   * fetched it. Usually absent for the synchronous read; see the Apple-Silicon
   * note in resolveTerminalPlatform.
   */
  architecture?: string;
  /** navigator.maxTouchPoints — disambiguates an iPad that reports as "Macintosh". */
  maxTouchPoints?: number;
}

export interface TerminalPlatform {
  os: TerminalOs;
  /** Best-effort: is this an Apple-Silicon Mac (the default download target)? */
  isAppleSilicon: boolean;
  /** Do we ship a helper this machine can run? (Any Mac or Windows PC.) */
  supported: boolean;
  /** Download control label — information scent, never "Download" / "Submit". */
  downloadLabel: string;
  /** Where the download points, or null when we ship nothing for this machine. */
  downloadUrl: string | null;
  /**
   * The opt-in link for the other architecture ("Intel Mac?" / "Windows on
   * ARM?"). Absent or null when we ship nothing for this machine.
   */
  altDownload?: AltDownload | null;
}

function detectOs(signals: PlatformSignals): TerminalOs {
  const ua = signals.userAgent ?? "";
  const uaData = signals.uaDataPlatform?.toLowerCase() ?? "";
  const plat = signals.platform?.toLowerCase() ?? "";
  const touch = signals.maxTouchPoints ?? 0;

  // iPhone / iPod / an explicit iPad string never runs the helper.
  if (/iphone|ipod|ipad/i.test(ua)) return "other";

  const looksMac =
    uaData === "macos" || /mac/.test(plat) || /macintosh|mac os x/i.test(ua);
  if (looksMac) {
    // iPadOS 13+ masquerades as "Macintosh"; a touch-capable "Mac" is really an
    // iPad → unsupported.
    if (touch > 1) return "other";
    return "mac";
  }

  const looksWindows =
    uaData === "windows" || /win/.test(plat) || /windows/i.test(ua);
  if (looksWindows) return "windows";

  return "other";
}

/**
 * Resolve the terminal platform from raw signals. Pure + deterministic.
 *
 * Apple-Silicon caveat: browsers report "Intel Mac OS X" in the UA even on Apple
 * Silicon (a compatibility lie), so the UA alone can NEVER prove Apple Silicon. We
 * therefore treat any Mac as Apple Silicon by default — the primary download button
 * targets arm64 — UNLESS a trustworthy UA-CH `architecture` says "x86"/"x86_64", the
 * one case where we can be reasonably sure it is an Intel Mac.
 *
 * Every Mac is `supported` now (we ship an x64 DMG alongside arm64), so an Intel
 * signal no longer routes to "coming soon" — it just flips `isAppleSilicon` to
 * false. We deliberately do NOT auto-switch `downloadUrl`/`downloadLabel` off of
 * this signal (UA-CH architecture is opt-in and often absent for the synchronous
 * read, so silently trusting it here would default plenty of real Apple-Silicon
 * users onto the wrong DMG); the UI instead surfaces a manual "Intel Mac?" link the
 * user opts into themselves — see SetupPanel in terminal-session-view.tsx.
 */
export function resolveTerminalPlatform(signals: PlatformSignals): TerminalPlatform {
  const os = detectOs(signals);
  const arch = signals.architecture?.toLowerCase();
  const isAppleSilicon = os === "mac" && arch !== "x86" && arch !== "x86_64";
  const supported = os === "mac" || os === "windows";

  if (os === "mac") {
    return {
      os,
      isAppleSilicon,
      supported,
      downloadLabel: "Download for Mac (Apple Silicon)",
      downloadUrl: TERMINAL_HELPER_DOWNLOAD_URL,
      altDownload: {
        prompt: "Intel Mac?",
        label: "Download the x64 version",
        href: `${TERMINAL_HELPER_DOWNLOAD_URL}?arch=x64`,
      },
    };
  }

  if (os === "windows") {
    // Same shape as the Mac: the main button gets the common build (x64) and
    // ARM users opt in with the link, as in the approved mock.
    return {
      os,
      isAppleSilicon,
      supported,
      downloadLabel: "Download for Windows",
      downloadUrl: TERMINAL_HELPER_WINDOWS_DOWNLOAD_URL,
      altDownload: {
        prompt: "Windows on ARM?",
        label: "Download the ARM version",
        href: `${TERMINAL_HELPER_WINDOWS_DOWNLOAD_URL}&arch=arm64`,
      },
    };
  }

  return {
    os,
    isAppleSilicon,
    supported,
    downloadLabel: "Download",
    downloadUrl: null,
    altDownload: null,
  };
}

/**
 * Where "Update now" downloads the helper for this machine. The Mac keeps
 * today's address exactly. On Windows, `archHint` is the browser's reported
 * CPU architecture (UA-CH "arm" → the ARM installer); anything else is x64.
 */
export function helperDownloadUrlFor(platform: Pick<TerminalPlatform, "os">, archHint?: string | null): string {
  if (platform.os !== "windows") return TERMINAL_HELPER_DOWNLOAD_URL;
  const arch = archHint?.toLowerCase();
  return arch === "arm" || arch === "arm64"
    ? `${TERMINAL_HELPER_WINDOWS_DOWNLOAD_URL}&arch=arm64`
    : TERMINAL_HELPER_WINDOWS_DOWNLOAD_URL;
}

/**
 * The chip family ("arm" | "x86" | …) from the browser's high-entropy client
 * hints (Chromium only), or null when the browser won't say within `timeoutMs`.
 * Used only to pick the Windows installer (card 51d424f7); never throws.
 */
export async function readArchitectureHint(timeoutMs = 500): Promise<string | null> {
  if (typeof navigator === "undefined") return null;
  const uaData = (navigator as Navigator & {
    userAgentData?: { getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string }> };
  }).userAgentData;
  if (!uaData?.getHighEntropyValues) return null;
  try {
    const values = await Promise.race([
      uaData.getHighEntropyValues(["architecture"]),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    return values?.architecture ?? null;
  } catch {
    return null;
  }
}

/** Read detection signals from the live navigator. SSR-safe (empty → unsupported). */
export function readPlatformSignals(): PlatformSignals {
  if (typeof navigator === "undefined") return { userAgent: "" };
  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  return {
    userAgent: nav.userAgent ?? "",
    platform: nav.platform,
    uaDataPlatform: nav.userAgentData?.platform,
    maxTouchPoints: nav.maxTouchPoints,
    // `architecture` needs an async UA-CH high-entropy call; left undefined for the
    // synchronous read (we default Mac → Apple Silicon — see resolveTerminalPlatform).
  };
}
