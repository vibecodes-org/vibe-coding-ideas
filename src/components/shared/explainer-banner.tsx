"use client";

import { useEffect, useState } from "react";
import { Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ExplainerBannerProps {
  /** localStorage key; "1" means dismissed in this browser. */
  storageKey: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Dismissible explainer note shown at the top of a tab. Renders nothing until
 * mounted so server and browser output always agree, then reads the remembered
 * dismissal. Storage failures (blocked site data) fall back to "not dismissed".
 */
export function ExplainerBanner({ storageKey, children, className }: ExplainerBannerProps) {
  const [mounted, setMounted] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- hydrate the dismissed flag from localStorage on mount (client-only API) */
    try {
      setDismissed(localStorage.getItem(storageKey) === "1");
    } catch {
      setDismissed(false);
    }
    setMounted(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [storageKey]);

  if (!mounted || dismissed) return null;

  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-lg border border-border bg-muted/20 px-4 py-3",
        className
      )}
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-violet-400" />
      <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => {
          setDismissed(true);
          try {
            localStorage.setItem(storageKey, "1");
          } catch {
            // storage blocked: the note stays hidden for this visit only
          }
        }}
        className="mt-0.5 shrink-0 text-muted-foreground/60 transition-colors hover:text-muted-foreground"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
