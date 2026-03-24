"use client";

import { useState, useEffect, useCallback, createContext, useContext, type ReactNode } from "react";
import { FIRST_RUN_OVERRIDE_KEY } from "./first-run-dashboard";

const SwitchContext = createContext<(() => void) | null>(null);

/** Hook for FirstRunDashboard to trigger switch to standard dashboard */
export function useSwitchToStandard() {
  return useContext(SwitchContext);
}

interface DashboardModeSwitchProps {
  isActivated: boolean;
  firstRunContent: ReactNode;
  standardContent: ReactNode;
}

/**
 * Renders either first-run dashboard OR standard dashboard, never both.
 * - Activated users (3+ board tasks) always see standard.
 * - Non-activated users see first-run until they click "Switch to full dashboard".
 * - Override persists in localStorage.
 * - Provides switch callback via context (avoids passing functions across RSC boundary).
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

  // Activated users always see standard — render immediately (no localStorage check needed)
  if (isActivated) return <>{standardContent}</>;

  // Non-activated: if localStorage override detected after mount, show standard
  if (mounted && showStandard) return <>{standardContent}</>;

  // Server render + pre-mount: default to first-run (no blank flash)
  return (
    <SwitchContext.Provider value={handleSwitchToStandard}>
      {firstRunContent}
    </SwitchContext.Provider>
  );
}
