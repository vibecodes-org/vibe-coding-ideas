"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { X, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { UNMEASURED_ALERT_DAYS, type UnmeasuredAlert } from "@/lib/step-cost/unmeasured-alert";

// Card fe1896ee: amber strip above the board when finished steps have no cost
// recorded. Same shape and dismiss rule as the setup strip.

interface UnmeasuredCostBannerProps {
  alert: UnmeasuredAlert;
  ideaId: string;
  isReadOnly?: boolean;
  className?: string;
}

const STYLES = {
  bg: "bg-amber-500/[0.04]",
  border: "border-amber-500/15",
  iconBg: "bg-amber-500/10",
  btnClass: "bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20",
};

function getDismissKey(ideaId: string) {
  return `unmeasured-banner-dismissed-${ideaId}`;
}

// sessionStorage can be blocked: a failed read just means "not dismissed".
function getStoredDismissCount(ideaId: string): number {
  try {
    const val = sessionStorage.getItem(getDismissKey(ideaId));
    const n = val ? parseInt(val, 10) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function Reason({ text, quote }: { text: string; quote: string | null }) {
  return quote ? (
    <>
      {text} <q>{quote}</q>
    </>
  ) : (
    <>{text}</>
  );
}

export function UnmeasuredCostBanner({ alert, ideaId, isReadOnly, className }: UnmeasuredCostBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const count = alert.cards.length;

  useEffect(() => {
    const stored = getStoredDismissCount(ideaId);
    /* eslint-disable react-hooks/set-state-in-effect -- sync dismissed state from sessionStorage on mount and when the card count changes */
    setDismissed(stored > 0 && count <= stored);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [ideaId, count]);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    setExpanded(false);
    try {
      sessionStorage.setItem(getDismissKey(ideaId), String(count));
    } catch {
      // Blocked storage: the strip is hidden for this page view only.
    }
  }, [ideaId, count]);

  if (dismissed || isReadOnly || count === 0) return null;

  const latestOpenable = alert.cards.find((c) => c.taskId); // cards are newest first

  return (
    <div className={cn("shrink-0", className)}>
      <div
        className={cn(
          "flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3",
          STYLES.bg,
          STYLES.border
        )}
        role="status"
        aria-label="Missing step costs"
      >
        <div
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm",
            STYLES.iconBg
          )}
          aria-hidden="true"
        >
          {"⚠️"}
        </div>

        <div className="min-w-0 flex-1 basis-60">
          <div className="text-sm font-semibold">
            {count === 1 ? "1 card had" : `${count} cards had`} steps finish with no cost recorded in the last{" "}
            {UNMEASURED_ALERT_DAYS} days
          </div>
          <div className="text-xs text-muted-foreground">
            {alert.topReasonQuote ? (
              <>
                Most often the session said: <q>{alert.topReasonQuote}</q>
              </>
            ) : (
              <>Most often: {alert.topReasonText.replace(/:$/, "")}</>
            )}
            . Those costs are missing from the cost report, not zero.
          </div>
        </div>

        <div className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:w-auto">
          {latestOpenable && (
            <Link href={`?taskId=${latestOpenable.taskId}`}>
              <Button size="sm" variant="outline" className={cn("h-7 text-xs", STYLES.btnClass)}>
                Open latest card &rarr;
              </Button>
            </Link>
          )}

          {count > 1 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap"
              aria-expanded={expanded}
            >
              {count} cards{" "}
              <ChevronDown className={cn("inline h-3 w-3 transition-transform", expanded && "rotate-180")} />
            </button>
          )}

          <button
            onClick={handleDismiss}
            className="ml-auto text-muted-foreground/60 hover:text-muted-foreground transition-colors p-0.5 sm:ml-0"
            aria-label="Dismiss missing cost warning"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {expanded && count > 1 && (
        <div
          className={cn(
            "mt-[-1px] rounded-b-lg border border-t-0 px-4 py-3",
            STYLES.bg,
            STYLES.border
          )}
        >
          <div className="flex flex-col gap-2">
            {alert.cards.map((c, i) => (
              <div key={`${c.taskId ?? "gone"}-${i}`} className="flex items-center gap-3 text-xs">
                <span className="w-6 shrink-0 text-right font-semibold tabular-nums text-amber-400">
                  {c.count}
                </span>
                <span className="min-w-0 flex-1 break-words text-muted-foreground">
                  <b className="font-semibold text-foreground">{c.title ?? "Archived or deleted card"}</b>
                  {" · "}
                  <Reason text={c.reasonText} quote={c.reasonQuote} />
                </span>
                {c.taskId && (
                  <Link
                    href={`?taskId=${c.taskId}`}
                    className="shrink-0 text-amber-400 hover:text-amber-300 hover:underline"
                  >
                    Open &rarr;
                  </Link>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
