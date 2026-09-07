"use client";

import { useEffect, useState } from "react";
import { getPlatformModelDefaultsAction, getAgentAwarePlatformModelDefaultsAction } from "@/actions/admin-platform";
import {
  SEED_PLATFORM_MODEL_DEFAULTS,
  SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS,
  type PlatformModelDefaults,
  type AgentAwarePlatformModelDefaults,
} from "@/lib/platform-model-defaults";

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

// ============================================================
// Agent-aware platform model defaults (Codex model-tier task, FR-7 UI slice)
// — same module-level shared-cache pattern as usePlatformModelDefaults above,
// but for AgentAwarePlatformModelDefaults (both agents, model + effort) and
// exposing an explicit `isLoading` flag: the agent-aware Profile/Admin grid
// (docs/codex-model-tiers-ux-design.html §1/§2) shows real skeletons while
// the platform defaults haven't resolved yet, rather than silently rendering
// the seed as if it were live.
// ============================================================

let cachedAgentAwareDefaults: AgentAwarePlatformModelDefaults | undefined;
let agentAwareInFlight: Promise<AgentAwarePlatformModelDefaults> | null = null;
const agentAwareListeners = new Set<(defaults: AgentAwarePlatformModelDefaults) => void>();

function fetchAgentAwareOnce(): Promise<AgentAwarePlatformModelDefaults> {
  if (!agentAwareInFlight) {
    agentAwareInFlight = getAgentAwarePlatformModelDefaultsAction()
      .then((defaults) => {
        cachedAgentAwareDefaults = defaults;
        return defaults;
      })
      .catch(() => {
        cachedAgentAwareDefaults = SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS;
        return SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS;
      });
  }
  return agentAwareInFlight;
}

/** Mirrors setPlatformModelDefaultsCache — called after an admin save so every
 *  mounted consumer (Profile dialog, admin card, tier picker) updates immediately. */
export function setPlatformAgentAwareModelDefaultsCache(defaults: AgentAwarePlatformModelDefaults): void {
  cachedAgentAwareDefaults = defaults;
  agentAwareListeners.forEach((listener) => listener(defaults));
}

/**
 * The current LIVE agent-aware platform model-tier defaults, fetched once and
 * shared across every mounted consumer. `isLoading` is true only until the
 * first fetch resolves (success or fallback-to-seed) — callers use it to
 * render the loading-skeleton state rather than assuming the seed is live.
 */
export function usePlatformAgentAwareModelDefaults(): {
  defaults: AgentAwarePlatformModelDefaults;
  isLoading: boolean;
} {
  const [defaults, setDefaults] = useState<AgentAwarePlatformModelDefaults>(
    cachedAgentAwareDefaults ?? SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS
  );
  const [isLoading, setIsLoading] = useState(cachedAgentAwareDefaults === undefined);

  useEffect(() => {
    let cancelled = false;
    const listener = (d: AgentAwarePlatformModelDefaults) => {
      if (!cancelled) setDefaults(d);
    };
    agentAwareListeners.add(listener);

    if (cachedAgentAwareDefaults === undefined) {
      fetchAgentAwareOnce().then((d) => {
        if (!cancelled) {
          setDefaults(d);
          setIsLoading(false);
        }
      });
    }
    // else: already resolved before mount — the useState initializer above
    // already read isLoading=false, so there's nothing to update here (never
    // call setState synchronously in the effect body itself).

    return () => {
      cancelled = true;
      agentAwareListeners.delete(listener);
    };
  }, []);

  return { defaults, isLoading };
}
