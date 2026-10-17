// The names this machine goes by (card 6b2cb8ac).
//
// A Mac's `os.hostname()` drifts with the network (the MacBook reports
// `Nicks-MacBook-Pro.local` on one network and `Nicks-MBP.home.local` on home
// Wi-Fi), so folder records keyed by it fragment, and one Mac looks like two.
// The Mac's LocalHostName (System Settings → Sharing → Local hostname, read
// with `scutil --get LocalHostName`) does not drift. The bridge and the helper
// report that as the CANONICAL name, plus the plain hostname as an alias, and
// the app treats every name in the list as the same Mac.
//
// Pure: the caller injects `hostname`, `platform` and a synchronous `run`
// (e.g. a wrapper over child_process.execFileSync with a 1s timeout), so this
// is unit-testable without a Mac.

import { sanitizeMachineLabel } from "./control-frames.mjs";

/**
 * @param {{ hostname: string, platform: string, run: (file: string, args: string[]) => string }} deps
 * @returns {{ canonical: string | null, names: string[] }}
 */
export function resolveMachineNames({ hostname, platform, run }) {
  /** @type {string[]} */
  const raw = [];
  if (platform === "darwin") {
    try {
      const local = String(run("/usr/sbin/scutil", ["--get", "LocalHostName"]) ?? "").trim();
      if (local) raw.push(`${local}.local`);
    } catch {
      // Not set, or scutil unavailable: the hostname alone is still a name.
    }
  }
  raw.push(hostname);

  /** @type {string[]} */
  const names = [];
  const seen = new Set();
  for (const candidate of raw) {
    const label = sanitizeMachineLabel(candidate);
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(label);
  }
  return { canonical: names[0] ?? null, names };
}
