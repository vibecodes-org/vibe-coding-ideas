// In-app terminal — this browser's recorded MACHINE identity (Nick's sign-off
// change 2: "hide conversations that aren't on the machine that you're
// running vibecodes on"). Set the first time a bridge announces its hostname
// (the `bridge-version` frame's optional `host` field — see
// use-terminal-session.ts and terminal/shared/control-frames.mjs); read by
// chooser-data.ts to filter the session entry chooser's Recent section down
// to sessions that ended on THIS machine. A never-set (null) identity always
// shows everything — an honest "we don't know yet" default, never a broken
// feature.
//
// Pure localStorage helpers, unit-tested against jsdom's real localStorage
// (the same pattern as paired-flag.ts) — no React involved.

/** localStorage key holding this browser's recorded machine identity. */
export const MACHINE_IDENTITY_KEY = "vc:term:machine";

/** This browser's recorded machine identity, or null if never set / storage unavailable. SSR-safe. */
export function getMachineIdentity(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(MACHINE_IDENTITY_KEY);
  } catch {
    return null;
  }
}

/**
 * Record this browser's machine identity. Only ever called to SET a freshly
 * announced host — no product flow ever calls this to clear one (an
 * intermittent bridge that fails to announce on some connection must not
 * erase a previously known identity). SSR-safe, best-effort: a full/disabled
 * store just means the chooser's filter never activates, never a thrown error.
 */
export function setMachineIdentity(label: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MACHINE_IDENTITY_KEY, label);
  } catch {
    // Storage disabled/full — worst case Recent stays unfiltered.
  }
}

/** Clear the recorded identity (test/reset use only — no product flow calls this today). SSR-safe. */
export function clearMachineIdentity(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(MACHINE_IDENTITY_KEY);
  } catch {
    // Nothing to do — storage unavailable.
  }
}
