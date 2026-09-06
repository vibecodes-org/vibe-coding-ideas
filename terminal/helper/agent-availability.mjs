// The helper's STANDING "is codex/claude installed?" signal (Codex support,
// docs/codex-terminal-requirements.md FR-3's helper-side half, per the
// requirements' correction: "and, per the requirements' correction, claude
// installed?" — a pre-flight the app can read BEFORE any launch fires, not
// just the bridge's own per-launch check inside the PTY-spawn gate).
//
// Pure, plain-node (no Electron import) so it's unit-testable without a
// running app — same posture as lifecycle.js/proto-reg.js. main.js imports
// this via a lazy ESM import (like its other shared .mjs modules) and
// reports the result as query params on the control-connection URL (see
// terminal/relay/src/index.js's `codexInstalled`/`claudeInstalled` handling
// and helper-status.js's computeHelperStatus).
//
// PACKAGING NOTE (learn from card 3e9d525e — a missing electron-builder
// `files:` entry crashed the packaged app on first launch): THIS file ships
// INSIDE the app's asar (electron-builder.yml `files:` list), while
// terminal/shared/ ships OUTSIDE it, via `extraResources` (main.js's own
// SHARED_* constants resolve that split explicitly for every other shared
// module it uses). A relative `../shared/…` import from a file packaged
// inside the asar SHOULD still resolve correctly (path normalization removes
// the `app.asar/..` segment before Node's asar interception ever sees it —
// the same reasoning that lets the bridge, shipped via extraResources,
// import "../../shared/…" successfully today) but this exact asar-crossing
// direction is UNVERIFIED against a real packaged build in this
// implementation slice. To avoid depending on it at all in production,
// `checkAgentAvailability` takes `resolveLoginShellPathImpl` /
// `isBinaryInstalledImpl` overrides — main.js ALWAYS supplies both (from ITS
// OWN correctly dev/packaged-aware resolution, mirroring SHARED_DEEPLINK
// etc.), so the fallback import below is a DEV/TEST convenience only
// (terminal/test/agent-availability.test.mjs imports this file directly,
// outside any asar, where the relative path is just a normal file) and never
// actually executes in the packaged app.

export const KNOWN_AGENT_BINARIES = Object.freeze({ claude: "claude", codex: "codex" });

let _fallbackDeps = null;
/** Lazily import the real implementations — ONLY reached when a caller omits
 *  an override (dev/test convenience; see the file header). */
async function fallbackDeps() {
  if (!_fallbackDeps) {
    const [{ resolveLoginShellPath }, { isBinaryInstalled }] = await Promise.all([
      import("../shared/spawn-path.mjs"),
      import("../shared/binary-check.mjs"),
    ]);
    _fallbackDeps = { resolveLoginShellPath, isBinaryInstalled };
  }
  return _fallbackDeps;
}

/**
 * Check which known agents resolve on the given (or freshly-resolved) PATH.
 * Deliberately re-resolves the login-shell PATH by default rather than
 * caching it forever — a user can install/upgrade an agent while the helper
 * keeps running, and this runs once per control-connect (main.js), not on a
 * hot path.
 *
 * @param {{ pathEnv?: string, resolveLoginShellPathImpl?: (opts?: object) => string,
 *           isBinaryInstalledImpl?: (name: string, pathEnv: string) => boolean }} [opts]
 * @returns {Promise<{ claude: boolean, codex: boolean }>}
 */
export async function checkAgentAvailability(opts = {}) {
  // Short-circuiting `||` means fallbackDeps() (and its relative import) is
  // NEVER invoked when the caller supplies both overrides — see the file
  // header for why that matters in the packaged app.
  const resolvePath = opts.resolveLoginShellPathImpl || (await fallbackDeps()).resolveLoginShellPath;
  const isInstalled = opts.isBinaryInstalledImpl || (await fallbackDeps()).isBinaryInstalled;
  const pathEnv = opts.pathEnv ?? resolvePath();
  return {
    claude: isInstalled(KNOWN_AGENT_BINARIES.claude, pathEnv),
    codex: isInstalled(KNOWN_AGENT_BINARIES.codex, pathEnv),
  };
}
