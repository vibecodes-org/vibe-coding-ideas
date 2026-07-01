// In-app terminal — client OS / architecture detection for the install-first flow.
//
// The in-browser terminal only works on machines we ship a helper for. Today that
// is an Apple-Silicon Mac; everything else lands on a calm "coming soon" and NEVER
// fires the `vibecodes://` deep link (so a non-Mac user is never ambushed by an OS
// dialog for a scheme nothing can handle).
//
// resolveTerminalPlatform() is PURE — it takes explicit signals so the whole
// OS/arch policy is unit-testable without a real navigator. readPlatformSignals()
// is the only impure part: it pulls those signals off `navigator` at the call site
// and is SSR-safe (no navigator → treated as an unsupported machine).

export type TerminalOs = "mac" | "windows" | "other";

/** Where the OS-aware download always points for a supported (Apple Silicon) Mac. */
export const TERMINAL_HELPER_DOWNLOAD_URL = "/download/terminal-helper";

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
  /** Best-effort: is this an Apple-Silicon Mac (the shipped helper target)? */
  isAppleSilicon: boolean;
  /** Do we ship a helper this machine can run? (Apple-Silicon Mac only, today.) */
  supported: boolean;
  /** Download control label — information scent, never "Download" / "Submit". */
  downloadLabel: string;
  /** Where the download points, or null when we ship nothing for this machine. */
  downloadUrl: string | null;
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
 * therefore treat any Mac as Apple Silicon — the only helper we ship is arm64 —
 * UNLESS a trustworthy UA-CH `architecture` says "x86"/"x86_64", the one case where
 * we can be reasonably sure it is an Intel Mac and route it to "coming soon".
 */
export function resolveTerminalPlatform(signals: PlatformSignals): TerminalPlatform {
  const os = detectOs(signals);
  const arch = signals.architecture?.toLowerCase();
  const isAppleSilicon = os === "mac" && arch !== "x86" && arch !== "x86_64";
  const supported = os === "mac" && isAppleSilicon;

  if (supported) {
    return {
      os,
      isAppleSilicon,
      supported,
      downloadLabel: "Download for Mac (Apple Silicon)",
      downloadUrl: TERMINAL_HELPER_DOWNLOAD_URL,
    };
  }

  return {
    os,
    isAppleSilicon,
    supported,
    // Windows is the next platform on the roadmap; the button is gated (disabled)
    // in the UI, so this label is informational, not an active target.
    downloadLabel: "Download for Windows",
    downloadUrl: null,
  };
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
