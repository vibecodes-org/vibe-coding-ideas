// In-app terminal — where each helper release's files live (card 51d424f7).
//
// Pure, shared by the download route (src/app/download/terminal-helper) and
// the release check script (scripts/check-helper-release.mjs), so the address
// the site sends people to and the address CI checks can never drift apart.
// Every helper release carries 6 files: 4 for the Mac (built on Nick's Mac)
// and 2 Windows installers (built by .github/workflows/helper-windows.yml).

export const HELPER_RELEASE_BASE = "https://github.com/vibecodes-org/vibe-coding-ideas/releases/download";

export const MAC_HELPER_ARCHS = ["arm64", "x64"] as const;
export type MacHelperArch = (typeof MAC_HELPER_ARCHS)[number];

export const WIN_HELPER_ARCHS = ["x64", "arm64"] as const;
export type WinHelperArch = (typeof WIN_HELPER_ARCHS)[number];

function releaseDir(version: string): string {
  return `${HELPER_RELEASE_BASE}/terminal-helper-v${version}`;
}

export function macDmgUrl(version: string, arch: MacHelperArch): string {
  return `${releaseDir(version)}/VibeCodes-${version}-${arch}.dmg`;
}

/** electron-builder names the x64 Mac zip without an arch (seen on every release so far). */
export function macZipUrl(version: string, arch: MacHelperArch): string {
  return `${releaseDir(version)}/VibeCodes-${version}${arch === "arm64" ? "-arm64" : ""}-mac.zip`;
}

export function winSetupUrl(version: string, arch: WinHelperArch): string {
  return `${releaseDir(version)}/VibeCodes-Setup-${version}-${arch}.exe`;
}

/** All 6 files a helper release must carry before the minimum version can point at it. */
export function helperAssetUrls(version: string): string[] {
  return [
    ...MAC_HELPER_ARCHS.map((a) => macDmgUrl(version, a)),
    ...MAC_HELPER_ARCHS.map((a) => macZipUrl(version, a)),
    ...WIN_HELPER_ARCHS.map((a) => winSetupUrl(version, a)),
  ];
}
