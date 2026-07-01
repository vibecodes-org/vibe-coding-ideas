import { NextResponse } from "next/server";

// Stable, public download endpoint for the in-app terminal's macOS helper.
// The signed + notarized installer is hosted as a GitHub Release asset (public
// CDN); this route 302-redirects to it so the app can link to a clean, stable
// path (`/download/terminal-helper`) and we can bump the target per release
// without touching the UI. Bump the tag/filename below when publishing a new
// helper build. Apple Silicon (arm64) only for now — Intel/x64 is a follow-up.
const HELPER_DMG_URL =
  "https://github.com/vibecodes-org/vibe-coding-ideas/releases/download/terminal-helper-v0.1.0/VibeCodes-0.1.0-arm64.dmg";

export function GET() {
  return NextResponse.redirect(HELPER_DMG_URL, 302);
}
