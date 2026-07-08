"use client";

import { useEffect, useState } from "react";
import { getModelTierMap } from "@/actions/profile";
import type { ModelTierMap } from "@/lib/constants";

// Module-level cache shared by every mounted ModelTierSelect — fetched once
// per session rather than once per mount (there are 5 mounts). `undefined` =
// not yet fetched; `null` = fetched, no overrides.
let cachedMap: ModelTierMap | null | undefined;
let inFlight: Promise<ModelTierMap | null> | null = null;
const listeners = new Set<(map: ModelTierMap | null) => void>();

function fetchOnce(): Promise<ModelTierMap | null> {
  if (!inFlight) {
    inFlight = getModelTierMap()
      .then((map) => {
        cachedMap = map;
        return map;
      })
      .catch(() => {
        cachedMap = null;
        return null;
      });
  }
  return inFlight;
}

/**
 * Called by the Model Tiers settings dialog after a successful save so any
 * ModelTierSelect already mounted on the page reflects the new map
 * immediately, without a full reload.
 */
export function setViewerModelTierMapCache(map: ModelTierMap | null): void {
  cachedMap = map;
  listeners.forEach((listener) => listener(map));
}

/**
 * The current viewer's model_tier_map, fetched once and shared across every
 * mounted ModelTierSelect (Design-Review CONDITION 3). Returns undefined
 * while loading — callers should show the platform-default gloss until this
 * resolves, never a wrong steady state.
 */
export function useViewerModelTierMap(): ModelTierMap | null | undefined {
  const [map, setMap] = useState<ModelTierMap | null | undefined>(cachedMap);

  useEffect(() => {
    let cancelled = false;
    const listener = (m: ModelTierMap | null) => {
      if (!cancelled) setMap(m);
    };
    listeners.add(listener);

    // useState(cachedMap) above already captured the cached value as initial
    // state — only kick off a fetch when nothing has been cached yet.
    if (cachedMap === undefined) {
      fetchOnce().then((m) => {
        if (!cancelled) setMap(m);
      });
    }

    return () => {
      cancelled = true;
      listeners.delete(listener);
    };
  }, []);

  return map;
}
