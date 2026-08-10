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
 *  bridge's machine-identity (hostname) announcement. */
export const MINIMUM_RECOMMENDED_HELPER_VERSION = "0.3.2";

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
