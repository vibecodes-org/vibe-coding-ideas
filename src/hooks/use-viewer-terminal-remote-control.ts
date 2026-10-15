"use client";

import { useEffect, useState } from "react";
import { getTerminalRemoteControl } from "@/actions/profile";

// Task 5c8969cc — a line-for-line mirror of use-viewer-terminal-auto-accept.ts.
// Module-level cache: fetched once per session rather than once per mount.
// `undefined` = not yet fetched.
let cachedRemoteControl: boolean | undefined;
let inFlight: Promise<boolean> | null = null;
const listeners = new Set<(remoteControl: boolean) => void>();

function fetchOnce(): Promise<boolean> {
  if (!inFlight) {
    inFlight = getTerminalRemoteControl()
      .then((remoteControl) => {
        cachedRemoteControl = remoteControl;
        return remoteControl;
      })
      .catch(() => {
        cachedRemoteControl = false;
        return false;
      });
  }
  return inFlight;
}

/**
 * Called by the Model Tiers settings dialog after a successful save so any
 * already-mounted consumer (the chooser footer, the per-task dialog) reflects
 * the new switch immediately, without a full reload.
 */
export function setViewerTerminalRemoteControlCache(remoteControl: boolean): void {
  cachedRemoteControl = remoteControl;
  listeners.forEach((listener) => listener(remoteControl));
}

/**
 * The current viewer's terminal_remote_control preference, fetched once and
 * shared across every mounted consumer. Returns undefined while loading —
 * callers omit the launch label until this resolves.
 */
export function useViewerTerminalRemoteControl(): boolean | undefined {
  const [remoteControl, setRemoteControl] = useState<boolean | undefined>(cachedRemoteControl);

  useEffect(() => {
    let cancelled = false;
    const listener = (r: boolean) => {
      if (!cancelled) setRemoteControl(r);
    };
    listeners.add(listener);

    if (cachedRemoteControl === undefined) {
      fetchOnce().then((r) => {
        if (!cancelled) setRemoteControl(r);
      });
    }

    return () => {
      cancelled = true;
      listeners.delete(listener);
    };
  }, []);

  return remoteControl;
}
