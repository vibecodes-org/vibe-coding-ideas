"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Check,
  ClipboardList,
  X,
  User,
  Lightbulb,
  Bot,
  Cable,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface ChecklistStep {
  key: string;
  label: string;
  done: boolean;
  href: string;
  icon: typeof Check;
  optional?: boolean;
}

interface OnboardingChecklistProps {
  hasProfile: boolean;
  hasIdea: boolean;
  hasAgent: boolean;
  hasMcpConnection: boolean;
}

const DISMISS_KEY = "onboarding-checklist-dismissed";

export function OnboardingChecklist({
  hasProfile,
  hasIdea,
  hasAgent,
  hasMcpConnection,
}: OnboardingChecklistProps) {
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(DISMISS_KEY) === "true") {
        setDismissed(true);
      }
    } catch {
      // localStorage unavailable
    }
    setMounted(true);
  }, []);

  if (!mounted || dismissed) return null;

  const steps: ChecklistStep[] = [
    {
      key: "account",
      label: "Create account",
      done: true,
      href: "/dashboard",
      icon: User,
    },
    {
      key: "profile",
      label: "Complete profile",
      done: hasProfile,
      href: "/profile",
      icon: User,
    },
    {
      key: "idea",
      label: "Create your first idea",
      done: hasIdea,
      href: "/ideas/new",
      icon: Lightbulb,
    },
    {
      key: "agent",
      label: "Set up an AI agent",
      done: hasAgent,
      href: "/agents",
      icon: Bot,
    },
    {
      key: "mcp",
      label: "Connect Claude Code",
      done: hasMcpConnection,
      href: "/guide/mcp-integration",
      icon: Cable,
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const total = steps.length;
  const percent = Math.round((doneCount / total) * 100);
  const remaining = total - doneCount;

  // All done — don't show
  if (doneCount === total) return null;

  const handleDismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "true");
    } catch {
      // localStorage unavailable
    }
  };

  return (
    <div className="fixed right-6 bottom-6 z-50">
      {/* Expandable Panel */}
      <div
        className={cn(
          "absolute right-0 bottom-[62px] w-80 origin-bottom-right rounded-2xl border border-border bg-card shadow-2xl transition-all duration-300",
          expanded
            ? "pointer-events-auto scale-100 opacity-100"
            : "pointer-events-none scale-95 translate-y-2 opacity-0"
        )}
        style={{
          transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 pt-4 pb-3">
          <h3 className="text-sm font-semibold text-foreground">
            Getting started
          </h3>
          <button
            onClick={handleDismiss}
            className="rounded p-1 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-muted-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Progress */}
        <div className="border-b border-border/50 px-4 py-3">
          <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">
              {doneCount} of {total} complete
            </span>
            <span>{percent}%</span>
          </div>
          <Progress value={percent} className="h-1" />
        </div>

        {/* Items */}
        <div className="p-2">
          {steps.map((step) => (
            <Link
              key={step.key}
              href={step.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-muted/50",
                step.done && "opacity-60"
              )}
            >
              <div
                className={cn(
                  "flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-2 transition-all",
                  step.done
                    ? "border-emerald-500 bg-emerald-500/10"
                    : "border-border"
                )}
              >
                {step.done && (
                  <Check className="h-3 w-3 text-emerald-400" />
                )}
              </div>
              <span
                className={cn(
                  "text-[13px] text-foreground",
                  step.done && "line-through text-muted-foreground"
                )}
              >
                {step.label}
              </span>
              {step.optional && (
                <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                  OPTIONAL
                </span>
              )}
            </Link>
          ))}
        </div>
      </div>

      {/* FAB Toggle */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="relative flex h-[52px] w-[52px] items-center justify-center rounded-[14px] border border-border bg-card text-primary shadow-lg transition-all hover:scale-105 hover:border-primary hover:shadow-[0_8px_32px_-8px_rgba(0,0,0,0.5),0_0_0_3px_rgba(139,92,246,0.1)]"
      >
        <ClipboardList className="h-[22px] w-[22px]" />
        {remaining > 0 && (
          <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-card bg-primary text-[11px] font-bold text-primary-foreground">
            {remaining}
          </span>
        )}
      </button>
    </div>
  );
}
