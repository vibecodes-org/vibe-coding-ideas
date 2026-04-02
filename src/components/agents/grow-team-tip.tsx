"use client";

import { useState, useEffect } from "react";
import { Users, X } from "lucide-react";

const STORAGE_KEY = "agents-grow-team-dismissed";

interface GrowTeamTipProps {
  onBrowseCommunity: () => void;
}

export function GrowTeamTip({ onBrowseCommunity }: GrowTeamTipProps) {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(STORAGE_KEY) === "true");
    } catch {
      // localStorage unavailable
    }
  }, []);

  if (dismissed) return null;

  function handleDismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(STORAGE_KEY, "true");
    } catch {
      // localStorage unavailable
    }
  }

  return (
    <div className="flex items-start gap-3.5 rounded-lg border border-emerald-500/15 bg-emerald-500/[0.04] px-4 py-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 mt-0.5">
        <Users className="h-[18px] w-[18px] text-emerald-400" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold mb-2">Grow your team</div>
        <div className="grid gap-4 sm:grid-cols-2 mb-2.5">
          <div>
            <div className="text-xs font-semibold text-foreground/85 mb-0.5">
              Create from scratch
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Build a custom agent with your own role, personality, and system
              prompt. Use the{" "}
              <span className="font-medium text-foreground">+ Create Agent</span>{" "}
              button above.
            </p>
          </div>
          <div>
            <div className="text-xs font-semibold text-foreground/85 mb-0.5">
              Clone from community
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Browse proven agents built by others and add them to your team in
              one click. Customise them after cloning.
            </p>
          </div>
        </div>
        <button
          onClick={onBrowseCommunity}
          className="text-[13px] font-medium text-violet-400 hover:text-violet-300 transition-colors"
        >
          Browse Community Agents &rarr;
        </button>
      </div>
      <button
        onClick={handleDismiss}
        className="shrink-0 rounded-md p-1 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-muted-foreground"
        aria-label="Dismiss grow your team tip"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
