"use client";

import { useEffect, useState } from "react";
import { getTerminalModel } from "@/actions/profile";

// Module-level cache mirroring use-viewer-model-tier-map.ts's pattern —
// fetched once per session rather than once per mount. `undefined` = not yet
// fetched; `null` = fetched, no override (use the platform default).
let cachedModel: string | null | undefined;
let inFlight: Promise<string | null> | null = null;
const listeners = new Set<(model: string | null) => void>();

function fetchOnce(): Promise<string | null> {
  if (!inFlight) {
    inFlight = getTerminalModel()
      .then((model) => {
        cachedModel = model;
        return model;
      })
      .catch(() => {
        cachedModel = null;
        return null;
      });
  }
  return inFlight;
}

/**
 * Called by the Model Tiers settings dialog's "Terminal sessions" group
 * after a successful save so any already-mounted consumer (the chooser
 * footer, the per-task dedupe dialog) reflects the new override immediately,
 * without a full reload — mirrors setViewerModelTierMapCache().
 */
export function setViewerTerminalModelCache(model: string | null): void {
  cachedModel = model;
  listeners.forEach((listener) => listener(model));
}

/**
 * The current viewer's terminal_model override, fetched once and shared
 * across every mounted consumer. Returns undefined while loading — callers
 * should omit the launch-surface model line until this resolves, never show
 * a wrong steady state (mirrors useViewerModelTierMap's posture).
 */
export function useViewerTerminalModel(): string | null | undefined {
  const [model, setModel] = useState<string | null | undefined>(cachedModel);

  useEffect(() => {
    let cancelled = false;
    const listener = (m: string | null) => {
      if (!cancelled) setModel(m);
    };
    listeners.add(listener);

    if (cachedModel === undefined) {
      fetchOnce().then((m) => {
        if (!cancelled) setModel(m);
      });
    }

    return () => {
      cancelled = true;
      listeners.delete(listener);
    };
  }, []);

  return model;
}
