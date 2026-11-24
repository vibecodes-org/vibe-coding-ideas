// Pre-build guard: refuse to package the helper unless the bridge's
// dependencies are installed next to it.
//
// electron-builder.yml ships `../bridge` (including its node_modules) as
// extraResources, and main.js require()s `ws` from there at startup. Helper
// 0.3.15 (7 Sep 2026) was built from a fresh git worktree where
// `terminal/bridge/node_modules` had never been installed: the build succeeded,
// the packaged app had no `ws` / `node-pty`, and it crashed on every launch
// ("Cannot find module …/Resources/bridge/node_modules/ws") — no terminal
// session could start for anyone who updated. Run `npm ci` in terminal/bridge
// first; this script makes forgetting that a build failure, not a release.
//
// Card 51d424f7 (release 1b): the helper is built for the Mac AND Windows, so
// the check names the build's own system: `--win` checks the two Windows
// node-pty builds, otherwise the two Mac ones.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * What must be inside terminal/bridge/node_modules for a build for `platform`.
 * @param {"darwin" | "win32"} platform
 * @returns {string[]}
 */
export function requiredBridgeModules(platform) {
  const archs = ["arm64", "x64"];
  return ["ws", "node-pty", ...archs.map((a) => join("node-pty", "prebuilds", `${platform}-${a}`))];
}

/** @param {string[]} argv */
export function buildPlatform(argv) {
  return argv.includes("--win") ? "win32" : "darwin";
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const here = dirname(fileURLToPath(import.meta.url));
  const bridgeModules = join(here, "..", "..", "bridge", "node_modules");
  const required = requiredBridgeModules(buildPlatform(process.argv.slice(2)));
  const missing = required.filter((r) => !existsSync(join(bridgeModules, r)));
  if (missing.length) {
    console.error(
      `\n✗ Refusing to package the helper: ${bridgeModules} is missing ${missing.join(", ")}.\n` +
        `  The packaged app would crash on launch (see helper 0.3.15).\n` +
        `  Fix: (cd ../bridge && npm ci) then re-run the build.\n`,
    );
    process.exit(1);
  }
  console.log(`✓ bridge deps present (${required.join(", ")})`);
}
