"use client";

import { useEffect, useState } from "react";
import { getTerminalAutoAccept } from "@/actions/profile";

// Module-level cache mirroring use-viewer-terminal-model.ts's pattern —
// fetched once per session rather than once per mount. `undefined` = not yet
// fetched.
let cachedAutoAccept: boolean | undefined;
let inFlight: Promise<boolean> | null = null;
const listeners = new Set<(autoAccept: boolean) => void>();

function fetchOnce(): Promise<boolean> {
  if (!inFlight) {
    inFlight = getTerminalAutoAccept()
      .then((autoAccept) => {
        cachedAutoAccept = autoAccept;
        return autoAccept;
      })
      .catch(() => {
        cachedAutoAccept = false;
        return false;
      });
  }
  return inFlight;
}

/**
 * Called by the Model Tiers settings dialog's "Terminal sessions" group
 * after a successful save so any already-mounted consumer (the chooser
 * footer, the per-task dedupe dialog) reflects the new toggle immediately,
 * without a full reload — mirrors setViewerTerminalModelCache().
 */
export function setViewerTerminalAutoAcceptCache(autoAccept: boolean): void {
  cachedAutoAccept = autoAccept;
  listeners.forEach((listener) => listener(autoAccept));
}

/**
 * The current viewer's terminal_auto_accept preference, fetched once and
 * shared across every mounted consumer. Returns undefined while loading —
 * callers should omit the launch-surface chip until this resolves, never
 * show a wrong steady state (mirrors useViewerTerminalModel's posture).
 */
export function useViewerTerminalAutoAccept(): boolean | undefined {
  const [autoAccept, setAutoAccept] = useState<boolean | undefined>(cachedAutoAccept);

  useEffect(() => {
    let cancelled = false;
    const listener = (a: boolean) => {
      if (!cancelled) setAutoAccept(a);
    };
    listeners.add(listener);

    if (cachedAutoAccept === undefined) {
      fetchOnce().then((a) => {
        if (!cancelled) setAutoAccept(a);
      });
    }

    return () => {
      cancelled = true;
      listeners.delete(listener);
    };
  }, []);

  return autoAccept;
}
