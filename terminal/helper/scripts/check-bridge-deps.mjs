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
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const bridgeModules = join(here, "..", "..", "bridge", "node_modules");
const required = ["ws", "node-pty", join("node-pty", "prebuilds", "darwin-arm64")];
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
