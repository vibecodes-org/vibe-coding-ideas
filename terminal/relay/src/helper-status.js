// Pure helper-leg status derivation (card cc74a067, helper lifecycle) — factored
// out of the DO/stand-in relay attach logic the SAME way pairing.js and
// activity-throttle.js are, so the "stopped unexpectedly" rule is unit-tested
// without a socket or workerd.
//
// Shared by:
//   - relay/src/index.js        (Cloudflare Worker + Durable Object)
//   - test/standin-relay.mjs    (plain-ws Node stand-in used by the automated tests)
//
// A helper leg is a single, PER-OWNER control connection (see
// ../../shared/session-token.mjs's "helper" role doc comment) — nothing here
// tracks pairing; it just answers "is my Mac's helper reachable, and did it
// leave cleanly?" for the web app's Helper row (design §5a).

/**
 * "Stopped unexpectedly" (the rose chip) clears on its own after this long,
 * even if nobody ever reconnects — a disconnect from months ago shouldn't
 * haunt the row forever (design §3's "Update quiescence" review rule).
 */
export const STOPPED_UNEXPECTEDLY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * @typedef {Object} HelperStatus
 * @property {boolean} connected
 * @property {string|null} version
 * @property {string|null} machineLabel
 * @property {boolean} alwaysOn
 * @property {boolean} stoppedUnexpectedly
 * @property {number|null} lastEventAt - unix ms of the unclean disconnect, only
 *   set while `stoppedUnexpectedly` is true (drives the chip's "3:42 pm" line).
 */

/**
 * Derive the Helper row's status from durable DO storage + the live-socket
 * check the caller already did. Pure: no storage access, no clock reads beyond
 * the `now` the caller supplies.
 *
 * @param {{ connected: boolean, version?: string|null, machineLabel?: string|null,
 *           alwaysOn?: boolean, uncleanAt?: number|null, now: number,
 *           unexpectedTtlMs?: number }} args
 *   `uncleanAt` — set by the caller whenever a helper leg's socket closed
 *   WITHOUT a preceding goodbye frame; cleared on the next successful attach
 *   (see relay/src/index.js's helper-leg fetch path).
 * @returns {HelperStatus}
 */
export function computeHelperStatus({
  connected,
  version = null,
  machineLabel = null,
  alwaysOn = false,
  uncleanAt = null,
  now,
  unexpectedTtlMs = STOPPED_UNEXPECTEDLY_TTL_MS,
}) {
  const stoppedUnexpectedly = !connected && uncleanAt != null && now - uncleanAt < unexpectedTtlMs;
  return {
    connected: !!connected,
    version,
    machineLabel,
    alwaysOn: !!alwaysOn,
    stoppedUnexpectedly,
    lastEventAt: stoppedUnexpectedly ? uncleanAt : null,
  };
}
