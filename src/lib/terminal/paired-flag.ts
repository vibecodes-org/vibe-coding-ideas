// In-app terminal — the "this browser has paired before" flag + the first-run gate.
//
// One localStorage flag is the WHOLE branch between the numbered setup panel (an
// unpaired browser) and silent auto-connect (a browser that has paired before). The
// web page cannot detect whether the native helper is installed, so we infer
// readiness from an explicit past success: on the first connection we set this flag,
// and every future open trusts it.
//
// Pure gate + SSR-safe storage helpers, all unit-tested without React.

/** localStorage key marking that THIS browser has paired at least once (v1). */
export const PAIRED_FLAG_KEY = "vibecodes:terminal:paired-v1";

/** True once this browser has successfully paired at least once. SSR-safe. */
export function isBrowserPaired(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(PAIRED_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

/** Mark this browser paired (called on the first successful connection). SSR-safe. */
export function markBrowserPaired(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PAIRED_FLAG_KEY, "1");
  } catch {
    // Storage disabled/full — worst case the user simply sees the setup panel again.
  }
}

/** Clear the paired flag (for tests / a future "reset this Mac" affordance). SSR-safe. */
export function clearBrowserPaired(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(PAIRED_FLAG_KEY);
  } catch {
    // Nothing to do — storage unavailable.
  }
}

export type FirstRunEntry = "coming-soon" | "setup" | "connecting";

/**
 * The install-first entry decision. Pure: given whether we ship a helper for this
 * machine and whether this browser has paired before, decide the first screen.
 *
 *  - unsupported machine       → "coming-soon"  (no deep link, ever)
 *  - supported + never paired  → "setup"        (numbered setup; NO deep link yet)
 *  - supported + paired before → "connecting"   (auto-connect; fire the deep link)
 *
 * This is the single source of truth for criterion #2 (link fires only after an
 * explicit Connect for an unpaired browser) and #6 (a paired browser auto-connects
 * and skips the setup wall).
 */
export function resolveFirstRunEntry(input: {
  supported: boolean;
  paired: boolean;
}): FirstRunEntry {
  if (!input.supported) return "coming-soon";
  return input.paired ? "connecting" : "setup";
}
