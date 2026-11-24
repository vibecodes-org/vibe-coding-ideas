import { NextResponse } from "next/server";
import { MINIMUM_RECOMMENDED_HELPER_VERSION } from "@/lib/terminal/helper-version";
import { macDmgUrl, winSetupUrl, type MacHelperArch, type WinHelperArch } from "@/lib/terminal/helper-assets";

// Stable, public download endpoint for the in-app terminal's helper app (Mac
// and Windows). The installers are hosted as GitHub Release assets (public
// CDN); this route 302-redirects to one so the app can link to a clean, stable
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
// publishing a new helper release, and only once all 6 files exist (the
// helper-release-check CI job enforces this).
//
// Query: `os=win|mac` picks the system; with no `os`, a Windows User-Agent
// means Windows. `arch`: Mac defaults to arm64 (only an exact "x64" changes
// it); Windows defaults to x64 (only an exact "arm64" changes it).

/** Anything other than an exact "x64" match falls back to arm64 (today's default target). */
function resolveMacArch(raw: string | null): MacHelperArch {
  return raw === "x64" ? "x64" : "arm64";
}

/** Anything other than an exact "arm64" match falls back to x64 (most Windows PCs). */
function resolveWinArch(raw: string | null): WinHelperArch {
  return raw === "arm64" ? "arm64" : "x64";
}

function wantsWindows(request: Request, os: string | null): boolean {
  if (os === "win") return true;
  if (os === "mac") return false;
  return /windows/i.test(request.headers.get("user-agent") ?? "");
}

export function GET(request: Request) {
  const version = process.env.TERMINAL_HELPER_VERSION || MINIMUM_RECOMMENDED_HELPER_VERSION;
  const { searchParams } = new URL(request.url);
  const arch = searchParams.get("arch");
  const url = wantsWindows(request, searchParams.get("os"))
    ? winSetupUrl(version, resolveWinArch(arch))
    : macDmgUrl(version, resolveMacArch(arch));

  // no-store: a version bump must take effect on the very next click, never
  // served stale from a browser/CDN redirect cache.
  return NextResponse.redirect(url, {
    status: 302,
    headers: { "Cache-Control": "no-store" },
  });
}
