// Which step-cost command a claim carries (card 5e654dd1, stage 2b).
//
// The long command (about 3,000 characters) always works. The short one
// (about 200) only works on a Mac whose helper has saved the script file, which
// needs helper 0.3.27 or newer. The server can't see a session's helper, so the
// short form is behind an env switch that stays OFF until the helper is out:
// STEP_USAGE_SHORT_COMMAND=1. Release order: ship the helper, wait for it to
// reach Nick's Mac, then switch this on. Off, every claim is unchanged.
//
// Even switched on, a session without the file (not launched by the helper)
// prints "NO_TRANSCRIPT no-script", which the hand-off already treats as "leave
// usage out": the step's cost is missing, the step is never blocked.

import { stepUsageCommand, stepUsageShortCommand } from "../../../src/lib/step-cost/usage-command";

/** Blank values count as off (Vercel can store a sensitive var as ""). */
export function shortUsageCommandEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const v = (env.STEP_USAGE_SHORT_COMMAND ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "on";
}

export function stepUsageCommandForClaim(marker: string, env: Record<string, string | undefined> = process.env): string {
  return shortUsageCommandEnabled(env) ? stepUsageShortCommand(marker) : stepUsageCommand(marker);
}
