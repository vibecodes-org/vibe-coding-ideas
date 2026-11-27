"use client";

import { useEffect } from "react";
import { pingAppVersion } from "@/actions/app-version";
import { isStaleVersionError, showStaleVersionToast } from "@/lib/stale-version";

const CHECK_EVERY_MS = 5 * 60 * 1000;
const MIN_GAP_MS = 60 * 1000;

/**
 * Tells the person to refresh when this tab is too old to save anything (its
 * deployment has expired), before they lose work to a "Failed to …" error.
 * Checks every few minutes and whenever the tab comes back into view. Never
 * reloads by itself: the board page hosts the in-app terminal.
 */
export function StaleVersionWatcher() {
  useEffect(() => {
    let lastCheck = 0;
    let stale = false;

    const check = async () => {
      if (stale || document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastCheck < MIN_GAP_MS) return;
      lastCheck = now;
      try {
        await pingAppVersion();
      } catch (error) {
        if (isStaleVersionError(error)) {
          stale = true;
          showStaleVersionToast();
        }
        // Anything else (offline, network blip) is not ours to report.
      }
    };

    const timer = setInterval(check, CHECK_EVERY_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);

  return null;
}
