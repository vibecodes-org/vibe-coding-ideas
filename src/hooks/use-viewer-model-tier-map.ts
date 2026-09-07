"use client";

import { useEffect, useState } from "react";
import { getModelTierMap, getAgentAwareModelTierMap } from "@/actions/profile";
import type { ModelTierMap } from "@/lib/constants";
import type { AgentAwareUserModelTierMap } from "@/lib/platform-model-defaults";

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

// ============================================================
// Agent-aware viewer model-tier map (Codex model-tier task, FR-7 UI slice) —
// same shared-cache-across-mounts pattern as useViewerModelTierMap above, but
// for the full agent-aware override shape (both agents, model + effort) used
// by the tier picker's both-agent resolution line and the step-detail
// dialog. `undefined` = not yet fetched; an empty object `{}` = fetched, no
// overrides (never `null` — normalizeUserModelTierMap never returns null).
// ============================================================

let cachedAgentAwareMap: AgentAwareUserModelTierMap | undefined;
let agentAwareInFlight: Promise<AgentAwareUserModelTierMap> | null = null;
const agentAwareListeners = new Set<(map: AgentAwareUserModelTierMap) => void>();

function fetchAgentAwareOnce(): Promise<AgentAwareUserModelTierMap> {
  if (!agentAwareInFlight) {
    agentAwareInFlight = getAgentAwareModelTierMap()
      .then((map) => {
        cachedAgentAwareMap = map;
        return map;
      })
      .catch(() => {
        cachedAgentAwareMap = {};
        return {};
      });
  }
  return agentAwareInFlight;
}

/** Mirrors setViewerModelTierMapCache — called after the Model Tiers dialog
 *  saves so any already-mounted consumer (tier picker, step detail) updates
 *  immediately without a full reload. */
export function setViewerAgentAwareModelTierMapCache(map: AgentAwareUserModelTierMap): void {
  cachedAgentAwareMap = map;
  agentAwareListeners.forEach((listener) => listener(map));
}

/** The current viewer's agent-aware model_tier_map (normalized — legacy flat
 *  values upgrade transparently), fetched once and shared across every
 *  mounted consumer. Returns undefined while loading. */
export function useViewerAgentAwareModelTierMap(): AgentAwareUserModelTierMap | undefined {
  const [map, setMap] = useState<AgentAwareUserModelTierMap | undefined>(cachedAgentAwareMap);

  useEffect(() => {
    let cancelled = false;
    const listener = (m: AgentAwareUserModelTierMap) => {
      if (!cancelled) setMap(m);
    };
    agentAwareListeners.add(listener);

    if (cachedAgentAwareMap === undefined) {
      fetchAgentAwareOnce().then((m) => {
        if (!cancelled) setMap(m);
      });
    }

    return () => {
      cancelled = true;
      agentAwareListeners.delete(listener);
    };
  }, []);

  return map;
}
