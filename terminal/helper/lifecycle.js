// Pure quit-when-idle decision logic for the helper (card cc74a067).
//
// Extracted out of main.js's bridge-count bookkeeping — same reason proto-reg.js
// is separate from main.js's protocol registration: a pure, dependency-free
// module is trivially unit-testable under plain node (terminal/test/
// helper-lifecycle-module.test.mjs), where main.js itself (an Electron entry
// point) is not importable outside a running app.
//
// The rule (design §1, decision 2): "quit-when-idle by default" — a 60s linger
// after the LAST bridge exits, cancelled by any new bridge attaching within the
// window — UNLESS "Keep helper ready" (always-on) is on, in which case the
// helper never lingers toward a quit at all. main.js owns the actual setTimeout;
// this module only decides WHAT that timer should do, given the current bridge
// count and the always-on setting — so the timing itself needs no test double.

/** The linger window (design §1, decision 2): 60s after the last session ends. */
const LINGER_MS = 60 * 1000;

/**
 * Decide what the linger timer should do right now. Called every time the live
 * bridge count changes (a child bridge exits, a new one is forked) and every
 * time the always-on setting itself changes.
 *
 * @param {{ bridgeCount: number, alwaysOn: boolean }} args
 * @returns {"start"|"cancel"}
 *   "start"  - (re)arm a fresh LINGER_MS timer: no bridges are live and
 *              always-on is off, so the helper should start counting down
 *              toward a clean quit.
 *   "cancel" - clear any pending timer: either a bridge is live (Active), or
 *              always-on is on (never linger toward quit while it's set).
 */
function decideLingerAction({ bridgeCount, alwaysOn }) {
  if (alwaysOn) return "cancel";
  return bridgeCount > 0 ? "cancel" : "start";
}

/**
 * The linger timer just fired — should the helper actually quit? Re-checked
 * against the CURRENT state rather than trusted from when the timer was set,
 * because a new bridge can attach (or always-on can flip on) in the window
 * between arming the timer and it firing; JS timers don't self-cancel on a
 * state change, only `decideLingerAction`'s "cancel" result (acted on by the
 * caller) does that; this is the belt-and-braces re-check for anything that
 * slips through (e.g. a state change that raced the timer callback itself).
 *
 * @param {{ bridgeCount: number, alwaysOn: boolean }} args
 * @returns {boolean}
 */
function shouldQuitOnLingerExpiry({ bridgeCount, alwaysOn }) {
  return !alwaysOn && bridgeCount === 0;
}

module.exports = { LINGER_MS, decideLingerAction, shouldQuitOnLingerExpiry };
