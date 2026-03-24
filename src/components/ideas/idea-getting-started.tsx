"use client";

import { useState, useEffect } from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface IdeaGettingStartedProps {
  ideaId: string;
  hasDescription: boolean;
  agentCount: number;
  boardTaskCount: number;
}

const SESSION_KEY_PREFIX = "idea-getting-started-dismissed-";

export function IdeaGettingStarted({
  ideaId,
  hasDescription,
  agentCount,
  boardTaskCount,
}: IdeaGettingStartedProps) {
  const [dismissed, setDismissed] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(`${SESSION_KEY_PREFIX}${ideaId}`) === "true") {
        setDismissed(true);
      }
    } catch {
      // sessionStorage unavailable
    }
    setMounted(true);
  }, [ideaId]);

  // Don't show if board has tasks (no longer "getting started")
  if (boardTaskCount > 0) return null;
  if (!mounted || dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(`${SESSION_KEY_PREFIX}${ideaId}`, "true");
    } catch {
      // sessionStorage unavailable
    }
  };

  const steps = [
    {
      label: "Describe your idea",
      done: hasDescription,
      desc: hasDescription ? "Done" : "Add a description",
    },
    {
      label: "Add AI agents",
      done: agentCount > 0,
      desc: agentCount > 0 ? `${agentCount} agent${agentCount !== 1 ? "s" : ""}` : "0 agents",
    },
    {
      label: "Generate your board",
      done: false, // If we got here, boardTaskCount === 0
      desc: hasDescription && agentCount > 0 ? "Ready to go!" : "0 tasks",
    },
  ];

  // Find current step (first not done)
  const currentIndex = steps.findIndex((s) => !s.done);

  return (
    <div className="rounded-xl border border-violet-500/20 bg-violet-500/[0.04] p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">
          Get started with your idea
        </h3>
        <button
          onClick={handleDismiss}
          className="rounded-md p-1 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-muted-foreground"
          aria-label="Dismiss getting started"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex items-start">
        {steps.map((step, i) => (
          <div key={step.label} className="contents">
            {/* Step */}
            <div className="flex flex-1 flex-col items-center text-center">
              <div
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-bold",
                  step.done
                    ? "border-emerald-500 bg-emerald-500/10 text-emerald-400"
                    : i === currentIndex
                      ? "border-violet-500 bg-violet-500/10 text-violet-400"
                      : "border-border bg-muted/50 text-muted-foreground"
                )}
              >
                {step.done ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  i + 1
                )}
              </div>
              <span className="mt-1.5 text-xs font-semibold text-foreground">
                {step.label}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {step.desc}
              </span>
            </div>
            {/* Connector */}
            {i < steps.length - 1 && (
              <div
                className={cn(
                  "mt-3.5 h-0.5 w-8 shrink-0 sm:w-10",
                  step.done ? "bg-emerald-500" : "bg-border"
                )}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
