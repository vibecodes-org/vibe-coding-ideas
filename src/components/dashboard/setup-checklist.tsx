"use client";

import { useState, useSyncExternalStore, useCallback } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Check, ChevronDown, ChevronUp, Copy, X, Plus, Sparkles, Rocket, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { MCP_COMMAND } from "@/lib/constants";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useLaunchClaudeCode } from "@/lib/use-launch-claude-code";
import {
  computeSetupSteps,
  countDoneSteps,
  isSetupComplete,
  type SetupStep,
  type SetupStepId,
  type SetupSignals,
} from "@/lib/setup-checklist";

/** Persist a manual dismiss so the user can hide the checklist before completion. */
const DISMISS_KEY = "setup-checklist-dismissed";
const DISMISS_EVENT = "setup-checklist-dismiss-change";

/**
 * Read the persisted dismiss flag via useSyncExternalStore — avoids
 * setState-in-effect and hydration mismatch (server snapshot is always false,
 * client reads localStorage after hydration).
 */
function subscribeDismiss(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(DISMISS_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(DISMISS_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

function getDismissSnapshot(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "true";
  } catch {
    return false;
  }
}

/** The user's primary idea, used to deep-link board + Launch CTAs. */
export interface FirstIdea {
  id: string;
  title: string;
  /** Idea github_url (raw), used for the Launch deep link's repo step. */
  github_url?: string | null;
}

export interface SetupChecklistProps {
  hasIdea: boolean;
  hasBoardWithTasks: boolean;
  hasMcpConnection: boolean;
  hasTaskMoved: boolean;
  /** First idea, used to deep-link the "Generate a board" + Launch CTAs. */
  firstIdea: FirstIdea | null;
}

/**
 * Per-step CTA metadata for the incomplete LINK steps. The "mcp" step is handled
 * separately (Launch-first via <McpStepCta>) because it needs the launch hook.
 */
type StepCta =
  | { kind: "link"; label: string; href: string; icon: typeof Plus }
  | null;

function ctaForStep(step: SetupStep, firstIdea: FirstIdea | null): StepCta {
  if (step.done) return null;
  switch (step.id) {
    case "idea":
      return { kind: "link", label: "Create idea", href: "/ideas/new", icon: Plus };
    case "board":
      return firstIdea
        ? {
            kind: "link",
            label: "Generate board",
            href: `/ideas/${firstIdea.id}/board`,
            icon: Sparkles,
          }
        : null; // gated — "Create an idea" must come first
    default:
      return null;
  }
}

/**
 * The "Connect Claude Code" step CTA — Launch-first. On desktop the primary
 * action launches Claude Code from the user's primary idea (auto-connects MCP +
 * picks up the board); the manual `claude mcp add` command is demoted to a small
 * "Manual setup" popover. On mobile (no terminal) it shows a desktop-only note +
 * the manual command. Falls back to a guide link when the user has no idea yet
 * (that step naturally comes after "Create an idea").
 */
function McpStepCta({ firstIdea }: { firstIdea: FirstIdea | null }) {
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const { launch, copyCommand } = useLaunchClaudeCode({
    ideaId: firstIdea?.id ?? "",
    ideaTitle: firstIdea?.title ?? "your project",
    ideaGithubUrl: firstIdea?.github_url ?? null,
  });

  const handleCopyMcp = async () => {
    try {
      await navigator.clipboard.writeText(MCP_COMMAND);
      toast.success("MCP command copied — run it in your terminal");
    } catch {
      toast.error("Failed to copy — please copy manually");
    }
  };

  const manualSetup = (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 shrink-0 gap-1.5 px-2 text-xs text-muted-foreground"
        >
          <Terminal className="h-3 w-3" />
          Manual
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <p className="text-xs font-semibold text-foreground">Manual setup</p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Run this once in your terminal — it connects VibeCodes for all your
          projects.
        </p>
        <div className="mt-2 overflow-x-auto rounded-md bg-black/80 px-2.5 py-2 font-mono text-[11px] leading-relaxed">
          <span className="text-emerald-400">$</span>{" "}
          <span className="break-all text-foreground">{MCP_COMMAND}</span>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={handleCopyMcp}
          className="mt-2 h-7 w-full gap-1.5 text-xs"
        >
          <Copy className="h-3 w-3" />
          Copy command
        </Button>
      </PopoverContent>
    </Popover>
  );

  // No idea yet → gated. "Create an idea" + "Generate a board" come first, so
  // this step shows no CTA (avoids three identical "Create idea" buttons).
  if (!firstIdea) {
    return null;
  }

  // Mobile: no terminal on a phone — note + manual command only.
  if (!isDesktop) {
    return (
      <div className="flex shrink-0 items-center gap-1.5">
        <span className="hidden text-[11px] text-muted-foreground xs:inline">
          Desktop only
        </span>
        {manualSetup}
      </div>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button
        size="sm"
        onClick={launch}
        className="h-7 shrink-0 gap-1.5 bg-emerald-500 px-2.5 text-xs text-zinc-950 hover:bg-emerald-400"
      >
        <Rocket className="h-3 w-3" />
        Launch Claude Code
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => void copyCommand()}
        aria-label="Copy launch command"
        title="Copy launch command"
        className="h-7 w-7 shrink-0 px-0 text-muted-foreground"
      >
        <Copy className="h-3 w-3" />
      </Button>
      {manualSetup}
    </div>
  );
}

const STEP_HINTS: Partial<Record<SetupStepId, string>> = {
  "first-task": "auto-ticks when a task moves",
};

export function SetupChecklist({
  hasIdea,
  hasBoardWithTasks,
  hasMcpConnection,
  hasTaskMoved,
  firstIdea,
}: SetupChecklistProps) {
  const [collapsed, setCollapsed] = useState(false);
  // false on the server and during the first client render (no hydration
  // mismatch); reflects localStorage once hydrated.
  const dismissed = useSyncExternalStore(
    subscribeDismiss,
    getDismissSnapshot,
    () => false
  );

  const signals: SetupSignals = {
    hasIdea,
    hasBoardWithTasks,
    hasMcpConnection,
    hasTaskMoved,
  };
  const steps = computeSetupSteps(signals);
  const doneCount = countDoneSteps(steps);
  const complete = isSetupComplete(steps);
  const percent = Math.round((doneCount / steps.length) * 100);

  const handleDismiss = useCallback(() => {
    try {
      localStorage.setItem(DISMISS_KEY, "true");
    } catch {
      // localStorage unavailable
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(DISMISS_EVENT));
    }
  }, []);

  // Auto-hide: never render once every step is complete (the activated user
  // gets a clean dashboard), or once the user has manually dismissed it.
  // `dismissed` is false during SSR/first render, so there's no layout shift
  // for the common (not-yet-dismissed) case.
  if (complete || dismissed) return null;

  return (
    <section
      aria-label="Getting set up"
      className="mb-6 rounded-xl border border-violet-500/30 bg-violet-500/[0.05] p-4 sm:p-5"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold sm:text-base">Getting set up</h2>
          <span className="rounded-md bg-violet-500/15 px-2 py-0.5 text-xs font-semibold text-violet-400">
            {doneCount} of {steps.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand setup checklist" : "Collapse setup checklist"}
            className="rounded-md p-1 text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
          >
            {collapsed ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronUp className="h-4 w-4" />
            )}
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Dismiss setup checklist"
            className="rounded-md p-1 text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Progress bar — always visible, also serves as the collapsed summary */}
      <div
        className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={doneCount}
        aria-valuemin={0}
        aria-valuemax={steps.length}
        aria-label={`${doneCount} of ${steps.length} setup steps complete`}
      >
        <div
          className="h-full rounded-full bg-violet-500 transition-all duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>

      {/* Step list */}
      {!collapsed && (
        <>
          <ul className="mt-3 space-y-1.5">
            {steps.map((step) => {
              const cta = ctaForStep(step, firstIdea);
              const hint = STEP_HINTS[step.id];
              return (
                <li
                  key={step.id}
                  className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5"
                >
                  <span
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 text-[10px] font-bold",
                      step.done
                        ? "border-emerald-500 bg-emerald-500/10 text-emerald-400"
                        : "border-border bg-muted/50 text-muted-foreground"
                    )}
                    aria-hidden="true"
                  >
                    {step.done ? <Check className="h-3 w-3" /> : null}
                  </span>
                  <span
                    className={cn(
                      "min-w-0 flex-1 text-sm",
                      step.done
                        ? "text-muted-foreground line-through decoration-muted-foreground/40"
                        : "font-medium text-foreground"
                    )}
                  >
                    {step.label}
                    <span className="sr-only">{step.done ? " (done)" : " (not done)"}</span>
                  </span>
                  {hint && !step.done && (
                    <span className="hidden text-xs text-muted-foreground sm:inline">
                      {hint}
                    </span>
                  )}
                  {step.id === "mcp" && !step.done && (
                    <McpStepCta firstIdea={firstIdea} />
                  )}
                  {cta?.kind === "link" && (
                    <Button asChild size="sm" variant="outline" className="h-7 shrink-0 gap-1.5 px-2.5 text-xs">
                      <Link href={cta.href}>
                        <cta.icon className="h-3 w-3" />
                        {cta.label}
                      </Link>
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Rocket className="h-3 w-3 text-violet-400" />
            This card disappears automatically once everything&apos;s done.
          </p>
        </>
      )}
    </section>
  );
}
