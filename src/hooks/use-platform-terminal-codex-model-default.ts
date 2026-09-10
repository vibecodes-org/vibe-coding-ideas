"use client";

import { useEffect, useState } from "react";
import {
  getPlatformTerminalCodexModelDefaultAction,
  type PlatformTerminalCodexModelAudit,
} from "@/actions/admin-platform";

type Pair = PlatformTerminalCodexModelAudit["value"];
let cachedDefault: Pair | undefined;
let inFlight: Promise<Pair> | null = null;
const listeners = new Set<(pair: Pair) => void>();

function fetchOnce(): Promise<Pair> {
  if (!inFlight) {
    inFlight = getPlatformTerminalCodexModelDefaultAction()
      .then((pair) => (cachedDefault = pair))
      .catch(() => (cachedDefault = null));
  }
  return inFlight;
}

export function setPlatformTerminalCodexModelDefaultCache(pair: Pair): void {
  cachedDefault = pair;
  listeners.forEach((listener) => listener(pair));
}

export function usePlatformTerminalCodexModelDefault(): Pair | undefined {
  const [pair, setPair] = useState<Pair | undefined>(cachedDefault);
  useEffect(() => {
    let cancelled = false;
    const listener = (next: Pair) => { if (!cancelled) setPair(next); };
    listeners.add(listener);
    if (cachedDefault === undefined) fetchOnce().then((next) => { if (!cancelled) setPair(next); });
    return () => { cancelled = true; listeners.delete(listener); };
  }, []);
  return pair;
}
