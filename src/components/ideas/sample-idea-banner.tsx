"use client";

import { useState } from "react";
import { Sparkles, X } from "lucide-react";

const DISMISS_KEY = "sample-idea-banner-dismissed";

export function SampleIdeaBanner() {
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(DISMISS_KEY) === "1";
  });

  if (dismissed) return null;

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  };

  return (
    <div className="mb-4 flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/[0.06] px-4 py-3">
      <Sparkles className="h-4 w-4 shrink-0 text-primary" />
      <p className="flex-1 text-sm text-muted-foreground">
        This is a starter project to help you explore.{" "}
        <strong className="text-foreground">
          Make it your own or delete it anytime.
        </strong>
      </p>
      <button
        onClick={handleDismiss}
        className="shrink-0 rounded-md p-1 text-muted-foreground/60 transition-colors hover:text-muted-foreground"
        aria-label="Dismiss banner"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
