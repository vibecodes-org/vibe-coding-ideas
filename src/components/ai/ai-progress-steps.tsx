"use client";

import { useState, useEffect, useRef } from "react";
import { Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ProgressStep {
  title: string;
  description?: string;
}

interface AiProgressStepsProps {
  steps: ProgressStep[];
  /** Thresholds in seconds for advancing to next step (e.g. [10, 30] for 3 steps). Ignored when activeStep is set. */
  advanceAt: number[];
  active: boolean;
  /** Externally controlled active step index. Overrides time-based advancement when provided. */
  activeStep?: number;
  onCancel?: () => void;
}

export function AiProgressSteps({
  steps,
  advanceAt,
  active,
  activeStep,
  onCancel,
}: AiProgressStepsProps) {
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (active) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset elapsed + start ticking when the run becomes active
      setElapsed(0);
      timerRef.current = setInterval(() => {
        setElapsed((s) => s + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [active]);

  // Determine active step index — use external override if provided, else time-based
  let activeIndex: number;
  if (activeStep != null) {
    activeIndex = Math.min(activeStep, steps.length - 1);
  } else {
    activeIndex = 0;
    for (let i = 0; i < advanceAt.length; i++) {
      if (elapsed >= advanceAt[i]) {
        activeIndex = i + 1;
      }
    }
    // Clamp to last step
    if (activeIndex >= steps.length) activeIndex = steps.length - 1;
  }

  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  const timeStr = `${minutes}:${seconds.toString().padStart(2, "0")}`;

  if (!active) return null;

  return (
    <div className="w-[320px] rounded-xl border border-primary/20 bg-card p-5 shadow-[0_8px_32px_rgba(0,0,0,0.4)] ring-1 ring-primary/10">
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs font-medium text-muted-foreground">
          Step {activeIndex + 1} of {steps.length}
        </span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {timeStr}
        </span>
      </div>

      <div className="space-y-3">
        {steps.map((step, i) => {
          const isDone = i < activeIndex;
          const isActive = i === activeIndex;
          const isPending = i > activeIndex;

          return (
            <div key={i} className="flex items-start gap-3">
              {/* Step indicator */}
              <div className="flex flex-col items-center">
                <div
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                    isDone
                      ? "border-primary bg-primary text-primary-foreground"
                      : isActive
                        ? "border-primary bg-transparent"
                        : "border-muted-foreground/30 bg-transparent"
                  }`}
                >
                  {isDone && <Check className="h-3.5 w-3.5" />}
                  {isActive && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                  )}
                </div>
                {/* Connector line */}
                {i < steps.length - 1 && (
                  <div
                    className={`mt-1 h-4 w-0.5 ${
                      isDone ? "bg-primary" : "bg-muted-foreground/20"
                    }`}
                  />
                )}
              </div>

              {/* Step content */}
              <div className={`pt-0.5 ${isPending ? "opacity-40" : ""}`}>
                <p
                  className={`text-sm leading-tight ${
                    isActive ? "font-medium" : isDone ? "text-muted-foreground" : ""
                  }`}
                >
                  {step.title}
                </p>
                {step.description && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {step.description}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {elapsed >= 15 && (
        <p className="mt-3 text-center text-xs text-muted-foreground">
          This may take a few minutes
        </p>
      )}

      {onCancel && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
          className="mt-3 w-full gap-1.5 text-muted-foreground"
        >
          <X className="h-3.5 w-3.5" />
          Cancel
        </Button>
      )}
    </div>
  );
}
