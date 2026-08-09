import { NextResponse } from "next/server";
import { MINIMUM_RECOMMENDED_HELPER_VERSION } from "@/lib/terminal/helper-version";

// Stable, public download endpoint for the in-app terminal's macOS helper.
// The signed + notarized installer is hosted as a GitHub Release asset (public
// CDN); this route 302-redirects to it so the app can link to a clean, stable
// path (`/download/terminal-helper`) and we can ship a new release without
// touching the UI or editing a hard-coded URL (see board card 3e9d525e: the
// old hard-coded v0.1.0 URL is why a broken 0.2.0 build had to be clobbered
// over the same asset instead of published as a real release).
//
// Version: `TERMINAL_HELPER_VERSION` env var overrides the default, which is
// `MINIMUM_RECOMMENDED_HELPER_VERSION` (src/lib/terminal/helper-version.ts) —
// the same constant that drives the "update your helper" nudge, so the
// default download and the nudge threshold can never silently drift apart.
// Bump that constant (in lockstep with terminal/helper/package.json) when
// publishing a new helper release.
const HELPER_ARCHS = ["arm64", "x64"] as const;
type HelperArch = (typeof HELPER_ARCHS)[number];

/** Anything other than an exact "x64" match falls back to arm64 (today's default target). */
function resolveArch(raw: string | null): HelperArch {
  return raw === "x64" ? "x64" : "arm64";
}

export function helperDownloadUrl(version: string, arch: HelperArch): string {
  return `https://github.com/vibecodes-org/vibe-coding-ideas/releases/download/terminal-helper-v${version}/VibeCodes-${version}-${arch}.dmg`;
}

export function GET(request: Request) {
  const version = process.env.TERMINAL_HELPER_VERSION || MINIMUM_RECOMMENDED_HELPER_VERSION;
  const { searchParams } = new URL(request.url);
  const arch = resolveArch(searchParams.get("arch"));
  const url = helperDownloadUrl(version, arch);

  // no-store: a version bump must take effect on the very next click, never
  // served stale from a browser/CDN redirect cache.
  return NextResponse.redirect(url, {
    status: 302,
    headers: { "Cache-Control": "no-store" },
  });
}
