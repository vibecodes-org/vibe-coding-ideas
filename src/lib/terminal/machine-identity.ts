// In-app terminal — this browser's recorded MACHINE identity/identities
// (Nick's sign-off change 2: "hide conversations that aren't on the machine
// that you're running vibecodes on"). Set the first time a bridge announces
// its hostname (the `bridge-version` frame's optional `host` field — see
// use-terminal-session.ts and terminal/shared/control-frames.mjs); read by
// chooser-data.ts to filter the session entry chooser's Recent section down
// to sessions that ended on THIS machine. A never-set (empty) identity always
// shows everything — an honest "we don't know yet" default, never a broken
// feature.
//
// Pure localStorage helpers, unit-tested against jsdom's real localStorage
// (the same pattern as paired-flag.ts) — no React involved.
//
// MULTI-NAME BUG (2026-09, board card 094927ee): Nick's one Mac reports TWO
// different `os.hostname()` values depending on which network it's on —
// `Nicks-MBP.home.local` on his home wifi, `Nicks-MacBook-Pro.local` on
// others. Domain-stripping doesn't help — the SHORT names themselves differ,
// not just the `.local` suffix. A single remembered name meant every network
// switch silently overwrote it and wiped the OTHER name's sessions out of
// Recent. Fix: this browser now remembers the SET of every hostname it has
// ever been paired with (localStorage is per-browser-install, never synced
// across physical machines, so that set is exactly "every name this one Mac
// has reported"), and a Recent row matches if its machine label is ANY
// remembered name — see chooser-data.ts's updated filter.

/** Legacy single-value key — kept for back-compat reads and still written on every add() so nothing downstream that reads it directly regresses. */
export const MACHINE_IDENTITY_KEY = "vc:term:machine";

/** New key holding the accumulated set of every hostname this browser has seen, as a JSON string array. */
export const MACHINE_IDENTITIES_KEY = "vc:term:machines";

/** Cap on the remembered set so a browser that hops networks forever can't grow this without bound — keeps the most-recently-added names. */
const MAX_IDENTITIES = 20;

/**
 * Every machine name this browser has ever recorded, newest-added last.
 * Unions the new set-key with the legacy single-value key so a value written
 * before this fix (only ever under `MACHINE_IDENTITY_KEY`) is still honoured
 * — an existing user with one name stored keeps seeing it, no migration step
 * required. SSR-safe: empty array on the server, on no data, or if storage
 * throws (private mode, disabled storage, etc).
 */
export function getMachineIdentities(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const names = new Set<string>();
    const raw = window.localStorage.getItem(MACHINE_IDENTITIES_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const v of parsed) {
          if (typeof v === "string" && v) names.add(v);
        }
      }
    }
    const legacy = window.localStorage.getItem(MACHINE_IDENTITY_KEY);
    if (legacy) names.add(legacy);
    return Array.from(names);
  } catch {
    return [];
  }
}

/** This browser's single MOST RECENTLY recorded machine identity, or null if never set / storage unavailable. SSR-safe. Still used by callers that want "the name we're on right now" (e.g. stamping a freshly-saved project path) rather than the full known-machines set. */
export function getMachineIdentity(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(MACHINE_IDENTITY_KEY);
  } catch {
    return null;
  }
}

/**
 * Record this browser's machine identity, ADDING it to the remembered set
 * rather than overwriting — the fix for the two-hostnames-one-Mac bug above.
 * Also still writes the legacy single-value key (to the latest label) so
 * every existing direct reader of `getMachineIdentity()` — e.g. "which
 * machine am I saving this project path against right now" call sites —
 * keeps getting today's real answer. Deduped (adding an already-known name
 * is a no-op beyond bumping it to "most recent") and capped at
 * `MAX_IDENTITIES`, dropping the oldest name once that many distinct
 * hostnames have been seen — nobody's Mac is on more than a handful of
 * networks in practice, so this is a safety valve, not a real limit.
 *
 * Only ever called to ADD a freshly announced host — no product flow ever
 * calls this to clear one (an intermittent bridge that fails to announce on
 * some connection must not erase a previously known identity). SSR-safe,
 * best-effort: a full/disabled store just means the chooser's filter never
 * activates for this name, never a thrown error.
 */
export function addMachineIdentity(label: string): void {
  if (typeof window === "undefined") return;
  try {
    const existing = getMachineIdentities().filter((name) => name !== label);
    const next = [...existing, label].slice(-MAX_IDENTITIES);
    window.localStorage.setItem(MACHINE_IDENTITIES_KEY, JSON.stringify(next));
    window.localStorage.setItem(MACHINE_IDENTITY_KEY, label);
  } catch {
    // Storage disabled/full — worst case Recent stays unfiltered for this name.
  }
}

/**
 * Record this browser's machine identity, OVERWRITING any previous single
 * value. Kept for the non-chooser callers that want "the name we're on right
 * now" recorded as a plain string (project-path saves, launch-path pin
 * migration) rather than accumulated into a set. Does NOT touch the
 * accumulated set — use `addMachineIdentity` for that. SSR-safe, best-effort.
 */
export function setMachineIdentity(label: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MACHINE_IDENTITY_KEY, label);
  } catch {
    // Storage disabled/full — worst case Recent stays unfiltered.
  }
}

/** Clear every recorded identity, single-value and accumulated (test/reset use only — no product flow calls this today). SSR-safe. */
export function clearMachineIdentity(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(MACHINE_IDENTITY_KEY);
    window.localStorage.removeItem(MACHINE_IDENTITIES_KEY);
  } catch {
    // Nothing to do — storage unavailable.
  }
}
