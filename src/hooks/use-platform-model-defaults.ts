"use client";

import { useEffect, useState } from "react";
import { getPlatformModelDefaultsAction } from "@/actions/admin-platform";
import { SEED_PLATFORM_MODEL_DEFAULTS, type PlatformModelDefaults } from "@/lib/platform-model-defaults";

// Module-level cache shared by every mounted consumer (model-tier-select.tsx,
// model-tier-settings.tsx, step-detail-dialog.tsx) — fetched once per session
// rather than once per mount, mirroring use-viewer-model-tier-map.ts's cache
// for the analogous per-user override. `undefined` = not yet fetched.
let cachedDefaults: PlatformModelDefaults | undefined;
let inFlight: Promise<PlatformModelDefaults> | null = null;
const listeners = new Set<(defaults: PlatformModelDefaults) => void>();

function fetchOnce(): Promise<PlatformModelDefaults> {
  if (!inFlight) {
    inFlight = getPlatformModelDefaultsAction()
      .then((defaults) => {
        cachedDefaults = defaults;
        return defaults;
      })
      .catch(() => {
        // Never surface this to the UI as an error — fall back to the seed,
        // same posture as the server-side getPlatformModelDefaults() helper.
        cachedDefaults = SEED_PLATFORM_MODEL_DEFAULTS;
        return SEED_PLATFORM_MODEL_DEFAULTS;
      });
  }
  return inFlight;
}

/**
 * Called by the admin Platform tab after a successful save so any
 * already-mounted consumer (Profile → Models, step-detail dialogs, row
 * badges) reflects the new default immediately, without a full reload —
 * mirrors setViewerModelTierMapCache().
 */
export function setPlatformModelDefaultsCache(defaults: PlatformModelDefaults): void {
  cachedDefaults = defaults;
  listeners.forEach((listener) => listener(defaults));
}

/**
 * The current LIVE platform model-tier defaults (admin-configurable), fetched
 * once and shared across every mounted consumer. Returns the seed constants
 * as an immediate, safe placeholder while the real fetch is in flight —
 * callers should NOT treat this as "loading vs loaded"; the seed value here
 * is a deliberate no-flash floor, matching getPlatformModelDefaults()'s own
 * "missing/invalid -> seed" behaviour.
 */
export function usePlatformModelDefaults(): PlatformModelDefaults {
  const [defaults, setDefaults] = useState<PlatformModelDefaults>(cachedDefaults ?? SEED_PLATFORM_MODEL_DEFAULTS);

  useEffect(() => {
    let cancelled = false;
    const listener = (d: PlatformModelDefaults) => {
      if (!cancelled) setDefaults(d);
    };
    listeners.add(listener);

    if (cachedDefaults === undefined) {
      fetchOnce().then((d) => {
        if (!cancelled) setDefaults(d);
      });
    }

    return () => {
      cancelled = true;
      listeners.delete(listener);
    };
  }, []);

  return defaults;
}
