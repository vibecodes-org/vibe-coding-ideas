// PTY spawn dimensions — Bug B (card cbe60db5, Nick's field test 2026-08-15):
// a promptless (Resume, or any prompt-less) launch used to spawn its PTY at a
// hardcoded 80x24 because the browser's real panel size could never reach a
// not-yet-existent process in time. Promptless launches call spawnPty()
// SYNCHRONOUSLY, before the relay socket even opens (see index.js's R1
// SEQUENCING comment) — and the browser's own resize send is gated on
// connection status "connected", which itself only flips on the FIRST
// inbound PTY byte. Waiting for a post-spawn resize is therefore circular:
// nothing produces that first byte until the PTY exists.
//
// The fix carries the browser's already-computed cols/rows (the SAME
// fit-addon read `sendResize()` uses — see use-terminal-session.ts's
// `currentLaunchDims`) on the SAME launch deep link that names the command to
// run, so the bridge has the real size before it ever calls pty.spawn. No
// wire round-trip, no timing race.
//
// Pure so it's unit-testable without a PTY (same idiom as resume-cmd.js).

import { isValidDim } from "./framing.js";

/** The PTY's default size — unchanged from before this fix, and still what a
 * non-deep-link CLI run (no launch-url) or a launch that raced xterm's mount
 * (fast click before the fit-addon was ready) falls back to. */
export const DEFAULT_SPAWN_COLS = 80;
export const DEFAULT_SPAWN_ROWS = 24;

/**
 * Resolve the `{ cols, rows }` to hand `pty.spawn`. `launched` is whatever
 * `parseLaunchDeepLink` returned (or `null` for a bare CLI run with no
 * `--launch-url`) — its `cols`/`rows` are re-validated here with the SAME
 * rule the resize wire format uses (defense in depth, same posture as
 * RESUME_ID's re-check in index.js) rather than trusted blindly. A
 * missing/malformed value falls back to the pre-existing hardcoded default —
 * exactly today's behaviour, so an old app that never sends the params (or a
 * link with only one of the pair) never regresses.
 *
 * @param {{ cols?: unknown, rows?: unknown } | null | undefined} launched
 * @returns {{ cols: number, rows: number }}
 */
export function resolveSpawnDims(launched) {
  const cols = Number(launched?.cols);
  const rows = Number(launched?.rows);
  return {
    cols: isValidDim(cols) ? cols : DEFAULT_SPAWN_COLS,
    rows: isValidDim(rows) ? rows : DEFAULT_SPAWN_ROWS,
  };
}
