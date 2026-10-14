"use client";

import { useEffect, useState } from "react";
import { getTerminalEffort } from "@/actions/profile";

// Module-level cache mirroring use-viewer-effort-tier-map.ts's pattern —
// fetched once per session rather than once per mount. `undefined` = not yet
// fetched; `null` = fetched, no override (use the platform default).
let cachedEffort: string | null | undefined;
let inFlight: Promise<string | null> | null = null;
const listeners = new Set<(effort: string | null) => void>();

function fetchOnce(): Promise<string | null> {
  if (!inFlight) {
    inFlight = getTerminalEffort()
      .then((effort) => {
        cachedEffort = effort;
        return effort;
      })
      .catch(() => {
        cachedEffort = null;
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
export function setViewerTerminalEffortCache(effort: string | null): void {
  cachedEffort = effort;
  listeners.forEach((listener) => listener(effort));
}

/**
 * The current viewer's terminal_effort setting, fetched once and shared
 * across every mounted consumer. Returns undefined while loading — callers
 * should omit the launch-surface effort line until this resolves, never show
 * a wrong steady state (mirrors useViewerModelTierMap's posture).
 */
export function useViewerTerminalEffort(): string | null | undefined {
  const [effort, setEffort] = useState<string | null | undefined>(cachedEffort);

  useEffect(() => {
    let cancelled = false;
    const listener = (m: string | null) => {
      if (!cancelled) setEffort(m);
    };
    listeners.add(listener);

    if (cachedEffort === undefined) {
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
