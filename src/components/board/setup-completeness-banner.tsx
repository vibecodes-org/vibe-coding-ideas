"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { X, ChevronDown, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { IdeaHealth, IdeaHealthGap, GapType } from "@/lib/idea-health";

interface SetupCompletenessBannerProps {
  health: IdeaHealth;
  ideaId: string;
  isReadOnly?: boolean;
  className?: string;
}

const GAP_ICONS: Record<GapType | "kit", string> = {
  "no-agents": "\u{1F916}",
  "agents-not-allocated": "\u{1F916}",
  "no-workflows": "\u26A1",
  "no-auto-rules": "\u{1F517}",
  "unmatched-roles": "\u26A0\uFE0F",
  "no-labels": "\u{1F3F7}\uFE0F",
  kit: "\u{1F4E6}",
};

type BannerVariant = "rose" | "amber" | "violet" | "blue" | "default";

const GAP_VARIANTS: Record<GapType, BannerVariant> = {
  "no-agents": "rose",
  "agents-not-allocated": "rose",
  "no-workflows": "amber",
  "no-auto-rules": "violet",
  "unmatched-roles": "amber",
  "no-labels": "default",
};

const VARIANT_STYLES: Record<
  BannerVariant,
  { bg: string; border: string; iconBg: string; btnClass: string }
> = {
  rose: {
    bg: "bg-rose-500/[0.04]",
    border: "border-rose-500/15",
    iconBg: "bg-rose-500/10",
    btnClass:
      "bg-rose-500/10 border-rose-500/30 text-rose-400 hover:bg-rose-500/20",
  },
  amber: {
    bg: "bg-amber-500/[0.04]",
    border: "border-amber-500/15",
    iconBg: "bg-amber-500/10",
    btnClass:
      "bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20",
  },
  violet: {
    bg: "bg-violet-500/[0.04]",
    border: "border-violet-500/15",
    iconBg: "bg-violet-500/10",
    btnClass:
      "bg-violet-500/10 border-violet-500/30 text-violet-400 hover:bg-violet-500/20",
  },
  blue: {
    bg: "bg-blue-500/[0.04]",
    border: "border-blue-500/15",
    iconBg: "bg-blue-500/10",
    btnClass: "bg-primary text-primary-foreground hover:bg-primary/90",
  },
  default: {
    bg: "bg-muted/30",
    border: "border-border",
    iconBg: "bg-muted",
    btnClass:
      "bg-muted border-border text-muted-foreground hover:bg-muted/80",
  },
};

// All possible setup steps in order — used to derive completed items in the checklist
const ALL_STEP_LABELS: { type: GapType | null; label: string }[] = [
  { type: null, label: "Create board tasks" },
  { type: "no-agents", label: "Create AI agents" },
  { type: "agents-not-allocated", label: "Add agents to this idea" },
  { type: "no-workflows", label: "Set up workflow templates" },
  { type: "no-auto-rules", label: "Create auto-rule triggers" },
  { type: "unmatched-roles", label: "Assign agents to workflow roles" },
  { type: "no-labels", label: "Add labels to trigger workflows" },
];

// Checklist action text — tab-specific labels matching the mockup
const CHECKLIST_ACTION_TEXT: Record<GapType, string> = {
  "no-agents": "Browse agents \u2192",
  "agents-not-allocated": "Agents tab \u2192",
  "no-workflows": "Workflows tab \u2192",
  "no-auto-rules": "Workflows tab \u2192",
  "unmatched-roles": "Agents tab \u2192",
  "no-labels": "Workflows tab \u2192",
};

function getDismissKey(ideaId: string) {
  return `setup-banner-dismissed-${ideaId}`;
}

function getStoredDismissCount(ideaId: string): number {
  if (typeof window === "undefined") return 0;
  const val = sessionStorage.getItem(getDismissKey(ideaId));
  return val ? parseInt(val, 10) : 0;
}

export function SetupCompletenessBanner({
  health,
  ideaId,
  isReadOnly,
  className,
}: SetupCompletenessBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Check sessionStorage on mount + reappear if gap count increased
  useEffect(() => {
    const storedCount = getStoredDismissCount(ideaId);
    if (storedCount > 0 && health.missing.length <= storedCount) {
      setDismissed(true);
    } else {
      setDismissed(false);
    }
  }, [ideaId, health.missing.length]);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    setExpanded(false);
    if (typeof window !== "undefined") {
      sessionStorage.setItem(
        getDismissKey(ideaId),
        String(health.missing.length)
      );
    }
  }, [ideaId, health.missing.length]);

  // Don't render if complete, dismissed, empty, or read-only
  if (
    health.status === "complete" ||
    health.status === "empty" ||
    dismissed ||
    isReadOnly
  ) {
    return null;
  }

  const gaps = health.missing;
  if (gaps.length === 0) return null;

  const topGap = gaps[0];
  const useKitBanner = health.showKitShortcut;
  const variant: BannerVariant = useKitBanner
    ? "blue"
    : GAP_VARIANTS[topGap.type];
  const styles = VARIANT_STYLES[variant];
  const icon = useKitBanner ? GAP_ICONS.kit : GAP_ICONS[topGap.type];

  return (
    <div className={cn("shrink-0", className)}>
      {/* Main banner */}
      <div
        className={cn(
          "flex items-center gap-3 rounded-lg border px-4 py-3",
          styles.bg,
          styles.border
        )}
        role="status"
        aria-label="Setup completeness"
      >
        {/* Progress dots */}
        <div className="flex gap-1.5 shrink-0" aria-hidden="true">
          {[...Array(4)].map((_, i) => {
            const completedCount = 4 - gaps.length;
            return (
              <div
                key={i}
                className={cn(
                  "h-2 w-2 rounded-full",
                  i < completedCount
                    ? "bg-emerald-500"
                    : i === completedCount
                      ? "ring-2 ring-amber-400 bg-transparent"
                      : "bg-border"
                )}
              />
            );
          })}
        </div>

        {/* Icon */}
        <div
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm",
            styles.iconBg
          )}
        >
          {icon}
        </div>

        {/* Body */}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">
            {useKitBanner
              ? "Your board has tasks but no agents or workflows to run them"
              : topGap.title}
          </div>
          <div className="text-xs text-muted-foreground">
            {useKitBanner
              ? "Apply a project kit to set up agents, workflows, and triggers in one step \u2014 or set each up individually."
              : topGap.description}
          </div>
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-2">
          {useKitBanner ? (
            <Link href="?tab=workflows">
              <Button
                size="sm"
                className={cn("h-7 text-xs", styles.btnClass)}
              >
                Apply a Kit
              </Button>
            </Link>
          ) : (
            <Link href={topGap.action.href}>
              <Button
                size="sm"
                variant="outline"
                className={cn("h-7 text-xs", styles.btnClass)}
              >
                {topGap.action.label} &rarr;
              </Button>
            </Link>
          )}

          {gaps.length > 1 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap"
              aria-expanded={expanded}
            >
              {gaps.length} setup steps{" "}
              <ChevronDown
                className={cn(
                  "inline h-3 w-3 transition-transform",
                  expanded && "rotate-180"
                )}
              />
            </button>
          )}

          <button
            onClick={handleDismiss}
            className="text-muted-foreground/60 hover:text-muted-foreground transition-colors p-0.5"
            aria-label="Dismiss setup banner"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Expanded checklist */}
      {expanded && gaps.length > 1 && (
        <div
          className={cn(
            "mt-[-1px] rounded-b-lg border border-t-0 px-4 py-3",
            styles.bg,
            styles.border
          )}
        >
          <div className="flex flex-col gap-2">
            {/* Show completed items first — derive from what's NOT in the gaps list */}
            {ALL_STEP_LABELS
              .filter((step) => !gaps.some((g) => g.type === step.type))
              .map((step) => (
                <div key={step.type ?? step.label} className="flex items-center gap-3 text-xs">
                  <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500">
                    <Check className="h-3 w-3" />
                  </div>
                  <span className="text-muted-foreground line-through">
                    {step.label}
                  </span>
                </div>
              ))}
            {/* Show remaining gaps */}
            {gaps.map((gap, i) => {
              const completedCount = ALL_STEP_LABELS.filter(
                (step) => !gaps.some((g) => g.type === step.type)
              ).length;
              return (
                <div key={gap.type} className="flex items-center gap-3 text-xs">
                  <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground text-[10px] font-bold">
                    {completedCount + i + 1}
                  </div>
                  <span className="flex-1 text-muted-foreground">
                    {gap.title}
                  </span>
                  <Link
                    href={gap.action.href}
                    className="text-violet-400 hover:text-violet-300 transition-colors"
                  >
                    {CHECKLIST_ACTION_TEXT[gap.type]}
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
