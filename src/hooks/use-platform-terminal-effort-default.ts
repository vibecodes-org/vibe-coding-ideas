"use client";

import { useEffect, useState } from "react";
import { getPlatformTerminalEffortDefaultAction } from "@/actions/admin-platform";

// Module-level cache shared by every mounted consumer (model-tier-settings.tsx's
// "Terminal sessions" group, the chooser footer, the per-task dedupe dialog) —
// fetched once per session. `undefined` = not yet fetched; `null` = fetched,
// no platform default set (binding note: there is NO seed to fall back to
// here, unlike use-platform-model-defaults.ts).
let cachedDefault: string | null | undefined;
let inFlight: Promise<string | null> | null = null;
const listeners = new Set<(effort: string | null) => void>();

function fetchOnce(): Promise<string | null> {
  if (!inFlight) {
    inFlight = getPlatformTerminalEffortDefaultAction()
      .then((effort) => {
        cachedDefault = effort;
        return effort;
      })
      .catch(() => {
        // Never surface this to the UI as an error — degrade to "no default",
        // same posture as the server-side getPlatformTerminalEffortDefault().
        cachedDefault = null;
        return null;
      });
  }
  return inFlight;
}

/**
 * Called by the admin Platform tab after a successful save (or clear) so any
 * already-mounted consumer reflects the new value immediately, without a
 * full reload — mirrors setPlatformModelDefaultsCache().
 */
export function setPlatformTerminalEffortDefaultCache(effort: string | null): void {
  cachedDefault = effort;
  listeners.forEach((listener) => listener(effort));
}

/**
 * The current LIVE platform terminal starting-effort default (admin-
 * configurable). Returns `undefined` while loading — UNLIKE
 * usePlatformModelDefaults(), there is no seed constant to show as an
 * immediate placeholder (binding approval-gate note: no seed at all), so
 * callers must treat `undefined` as "not yet known" and `null` as "no
 * default set" — two genuinely different states here.
 */
export function usePlatformTerminalEffortDefault(): string | null | undefined {
  const [effort, setEffort] = useState<string | null | undefined>(cachedDefault);

  useEffect(() => {
    let cancelled = false;
    const listener = (m: string | null) => {
      if (!cancelled) setEffort(m);
    };
    listeners.add(listener);

    if (cachedDefault === undefined) {
      fetchOnce().then((m) => {
        if (!cancelled) setEffort(m);
      });
    }

    return () => {
      cancelled = true;
      listeners.delete(listener);
    };
  }, []);

  return effort;
}
