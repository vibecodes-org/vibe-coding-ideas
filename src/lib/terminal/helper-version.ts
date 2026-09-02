// In-app terminal — terminal-helper update nudge (release-gate rework 2a/2b).
//
// The bridge announces its own version at attach (terminal/bridge/src/index.js
// reads it — helper-injected env, falling back to its own package.json — and
// sends it as a `helperVersion` query param on its relay connect URL; the relay
// stores it durably and forwards it to the browser leg as a `bridge-version`
// TEXT control frame — see terminal/relay/src/index.js +
// terminal/shared/control-frames.mjs). This module is the PURE comparison/gating
// policy over whatever version string the dock ends up with, decoupled from the
// wire format so it can be fully unit-tested without a socket.
//
// Gating rule: EVERY currently-installed helper predates this feature and so
// never sends a version at all — a missing version must therefore nudge, not
// silently trust an old install. A malformed (non-semver) string is treated
// the same as missing, for the same reason: never silently trust garbage.

/** The minimum helper version we no longer nudge the user to update away from.
 *  Bump this in lockstep with terminal/helper/package.json's version — see
 *  that file's header comment and docs/release-process.md for the release
 *  checklist. 0.3.0 (card cc74a067) is the first release with the helper
 *  lifecycle rework — quit-when-idle, crash log-and-exit, and the "Keep
 *  helper ready" opt-in. 0.3.2 (card cbe60db5, sign-off change 2) adds the
 *  bridge's machine-identity (hostname) announcement. 0.3.3 (rework 5,
 *  exact-conversation Resume) adds the bridge's own conversation-id minting
 *  (`--session-id`/`--resume`) and its announcement alongside version/host.
 *  0.3.4 (Bug B, Nick's field test 2026-08-15) fixes a promptless/Resume
 *  launch's PTY spawning at a hardcoded 80x24 — it now spawns at the
 *  browser's real panel size, carried on the SAME launch deep link (see
 *  terminal/bridge/src/spawn-dims.js). 0.3.5 (Nick's field report
 *  2026-08-25: fresh sessions started on the machine's default model, not
 *  the configured one) is the first helper that actually ships the bridge's
 *  `--model` (task c4ca2d95) and `--permission-mode` auto-accept (task
 *  d3de150c) support — both landed in terminal/bridge on 22–24 Aug WITHOUT a
 *  helper release, so every 0.3.4 install silently ignored them. Lesson: a
 *  bridge/shared change the app relies on is not shipped until the helper is
 *  rebuilt, released, and this constant is bumped. 0.3.6 (same day):
 *  the auto-accept toggle now launches Claude Code's `auto` permission
 *  mode — what Nick actually asked for on card d3de150c — instead of the
 *  narrower `acceptEdits`; the bridge/shared whitelist accepts both for
 *  deploy skew. 0.3.7 (task e2420590): first helper that ships the
 *  bridge's `--worktree` flag (real, Claude-Code-enforced concurrent-
 *  session isolation) — an older helper silently ignores the new
 *  `worktree` deep-link param, same as every prior unshipped bridge
 *  change, so this bump is what actually nudges users to it. 0.3.8
 *  (task 6d7a50ab): first helper that speaks the PTY end-to-end
 *  encryption protocol — an older helper negotiates plaintext only. */
export const MINIMUM_RECOMMENDED_HELPER_VERSION = "0.3.9";

export type HelperVersionParts = readonly [number, number, number];

/**
 * Parse a strict `x.y.z` (non-negative integers only) version string. Returns
 * null for anything else — missing, empty, pre-release/build suffixes, extra
 * segments, non-numeric parts, etc. Deliberately strict: the only versions
 * this ever needs to compare are ones WE mint (helper package.json), so a
 * loose semver parser would only invite ambiguity for no benefit.
 */
export function parseHelperVersion(raw: string | null | undefined): HelperVersionParts | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(trimmed);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])] as const;
}

/** Compare two parsed versions: negative if `a` < `b`, 0 if equal, positive if `a` > `b`. */
export function compareHelperVersions(a: HelperVersionParts, b: HelperVersionParts): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/**
 * Should the dock show the non-blocking "update your terminal helper" nudge?
 *
 *   - missing (null/undefined/empty)   -> true  (every pre-2a helper)
 *   - malformed (fails parse)          -> true  (never trust unparseable data)
 *   - older than the minimum           -> true
 *   - equal to the minimum            -> false
 *   - newer than the minimum           -> false
 *
 * A misconfigured `minVersion` (itself unparseable) fails OPEN — never nag the
 * user over our own config mistake.
 */
export function shouldShowHelperUpdateNudge(
  reportedVersion: string | null | undefined,
  minVersion: string = MINIMUM_RECOMMENDED_HELPER_VERSION,
): boolean {
  const min = parseHelperVersion(minVersion);
  if (!min) return false;
  const reported = parseHelperVersion(reportedVersion);
  if (!reported) return true;
  return compareHelperVersions(reported, min) < 0;
}

/**
 * Chooser-specific variant (card cbe60db5, rework 3 — Nick's field test: "I
 * click Open and there's no indication I need to update"). The chooser is now
 * the front door for EVERY entry, including a fresh account that has never
 * connected a helper at all — for that account "no version recorded" just
 * means "no data yet", not "an old helper". That's the opposite assumption
 * from `shouldShowHelperUpdateNudge` above, which is only ever evaluated once
 * a session/helper connection already exists (where a missing version safely
 * implies a pre-2a install and SHOULD nudge). This variant only nudges when a
 * version WAS reported and is provably older than the minimum — missing or
 * malformed data stays silent rather than assuming the worst.
 */
export function shouldShowChooserHelperNudge(
  reportedVersion: string | null | undefined,
  minVersion: string = MINIMUM_RECOMMENDED_HELPER_VERSION,
): boolean {
  const min = parseHelperVersion(minVersion);
  if (!min) return false;
  const reported = parseHelperVersion(reportedVersion);
  if (!reported) return false;
  return compareHelperVersions(reported, min) < 0;
}
