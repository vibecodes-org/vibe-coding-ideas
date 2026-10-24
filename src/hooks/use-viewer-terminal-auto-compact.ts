"use client";

import { useEffect, useState } from "react";
import { getTerminalAutoCompact } from "@/actions/profile";

export type ViewerAutoCompact = { claude: number | null; codex: number | null };

// Module-level cache mirroring use-viewer-terminal-effort.ts. `undefined` =
// not yet fetched; `{claude: null, ...}` = fetched, no personal override.
let cached: ViewerAutoCompact | undefined;
let inFlight: Promise<ViewerAutoCompact> | null = null;
const listeners = new Set<(v: ViewerAutoCompact) => void>();

function fetchOnce(): Promise<ViewerAutoCompact> {
  if (!inFlight) {
    inFlight = getTerminalAutoCompact()
      .then((v) => {
        cached = v;
        return v;
      })
      .catch(() => {
        cached = { claude: null, codex: null };
        return cached;
      });
  }
  return inFlight;
}

/** Called after a successful Settings save so mounted consumers update at once. */
export function setViewerTerminalAutoCompactCache(value: ViewerAutoCompact): void {
  cached = value;
  listeners.forEach((listener) => listener(value));
}

/** The viewer's own memory limits, fetched once and shared. undefined while loading. */
export function useViewerTerminalAutoCompact(): ViewerAutoCompact | undefined {
  const [value, setValue] = useState<ViewerAutoCompact | undefined>(cached);

  useEffect(() => {
    let cancelled = false;
    const listener = (v: ViewerAutoCompact) => {
      if (!cancelled) setValue(v);
    };
    listeners.add(listener);

    if (cached === undefined) {
      fetchOnce().then((v) => {
        if (!cancelled) setValue(v);
      });
    }

    return () => {
      cancelled = true;
      listeners.delete(listener);
    };
  }, []);

  return value;
}
