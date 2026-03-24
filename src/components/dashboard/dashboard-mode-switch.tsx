"use client";

import { useState, useEffect, useCallback, type ReactNode } from "react";
import { FIRST_RUN_OVERRIDE_KEY } from "./first-run-dashboard";

interface DashboardModeSwitchProps {
  isActivated: boolean;
  firstRunContent: (onSwitch: () => void) => ReactNode;
  standardContent: ReactNode;
}

/**
 * Renders either first-run dashboard OR standard dashboard, never both.
 * - Activated users (3+ board tasks) always see standard.
 * - Non-activated users see first-run until they click "Switch to full dashboard".
 * - Override persists in localStorage.
 */
export function DashboardModeSwitch({
  isActivated,
  firstRunContent,
  standardContent,
}: DashboardModeSwitchProps) {
  const [showStandard, setShowStandard] = useState(isActivated);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (isActivated) {
      setShowStandard(true);
    } else {
      try {
        if (localStorage.getItem(FIRST_RUN_OVERRIDE_KEY) === "true") {
          setShowStandard(true);
        }
      } catch {
        // localStorage unavailable
      }
    }
    setMounted(true);
  }, [isActivated]);

  const handleSwitchToStandard = useCallback(() => {
    setShowStandard(true);
  }, []);

  // Avoid flash — don't render until we've checked localStorage
  if (!mounted) return null;

  return showStandard ? <>{standardContent}</> : <>{firstRunContent(handleSwitchToStandard)}</>;
}
