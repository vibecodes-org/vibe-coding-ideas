#!/usr/bin/env node
// Checks that the helper release the site points at carries all 6 files
// (card 51d424f7, release 1b): the 2 Mac disk images, the 2 Mac zips and the
// 2 Windows installers. Run by .github/workflows/helper-release-check.yml.
//
// Usage: node scripts/check-helper-release.mjs [version]
// With no version it checks MINIMUM_RECOMMENDED_HELPER_VERSION. Needs a Node
// that runs TypeScript files directly (22.18+ / 24+), because the file names
// come from the same module the download route uses.
import { helperAssetUrls } from "../src/lib/terminal/helper-assets.ts";
import { MINIMUM_RECOMMENDED_HELPER_VERSION } from "../src/lib/terminal/helper-version.ts";
import { checkReleaseFiles, releaseReport } from "./lib/helper-release-check.mjs";

const version = process.argv[2]?.trim() || MINIMUM_RECOMMENDED_HELPER_VERSION;
const results = await checkReleaseFiles(helperAssetUrls(version), fetch);
const { ok, lines } = releaseReport(version, results);
for (const line of lines) console.log(line);
process.exit(ok ? 0 : 1);
