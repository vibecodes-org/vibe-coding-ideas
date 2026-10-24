"use client";

import { useEffect, useState } from "react";
import { getPlatformTerminalAutoCompactDefaultAction } from "@/actions/admin-platform";
import type { AutoCompactAgent } from "@/lib/terminal/auto-compact";

// Module-level cache per agent, shared by every mounted consumer (Settings'
// "Terminal sessions" group, the launch buttons). `undefined` = not yet
// fetched; `null` = fetched, no site default set (there is no seed in code).
const cachedDefault: Record<AutoCompactAgent, number | null | undefined> = { claude: undefined, codex: undefined };
const inFlight: Record<AutoCompactAgent, Promise<number | null> | null> = { claude: null, codex: null };
const listeners: Record<AutoCompactAgent, Set<(window: number | null) => void>> = {
  claude: new Set(),
  codex: new Set(),
};

function fetchOnce(agent: AutoCompactAgent): Promise<number | null> {
  if (!inFlight[agent]) {
    inFlight[agent] = getPlatformTerminalAutoCompactDefaultAction(agent)
      .then((window) => {
        cachedDefault[agent] = window;
        return window;
      })
      .catch(() => {
        // Never surface this to the UI as an error: degrade to "no default",
        // same posture as the server-side getPlatformTerminalAutoCompactDefault().
        cachedDefault[agent] = null;
        return null;
      });
  }
  return inFlight[agent]!;
}

/**
 * Called by the admin Platform tab after a successful save (or clear) so any
 * already-mounted consumer reflects the new value immediately, without a
 * full reload.
 */
export function setPlatformTerminalAutoCompactDefaultCache(agent: AutoCompactAgent, window: number | null): void {
  cachedDefault[agent] = window;
  listeners[agent].forEach((listener) => listener(window));
}

/**
 * The current LIVE site-wide memory limit for one agent. `undefined` while
 * loading, `null` when no site default is set: two genuinely different states.
 */
export function usePlatformTerminalAutoCompactDefault(agent: AutoCompactAgent): number | null | undefined {
  const [value, setValue] = useState<number | null | undefined>(cachedDefault[agent]);

  useEffect(() => {
    let cancelled = false;
    const listener = (m: number | null) => {
      if (!cancelled) setValue(m);
    };
    listeners[agent].add(listener);

    if (cachedDefault[agent] === undefined) {
      fetchOnce(agent).then((m) => {
        if (!cancelled) setValue(m);
      });
    }

    return () => {
      cancelled = true;
      listeners[agent].delete(listener);
    };
  }, [agent]);

  return value;
}
