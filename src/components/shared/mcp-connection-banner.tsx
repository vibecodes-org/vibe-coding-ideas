"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Cable, X, Copy, Check, Rocket, Terminal } from "lucide-react";
import { toast } from "sonner";
import { MCP_COMMAND, MCP_SUGGESTED_PROMPT } from "@/lib/constants";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useLaunchClaudeCode } from "@/lib/use-launch-claude-code";
import { cn } from "@/lib/utils";

const SESSION_DISMISS_KEY = "mcp-banner-dismissed";

interface McpConnectionBannerProps {
  agentCount: number;
  taskCount: number;
  compact?: boolean;
  className?: string;
  /** Whether the banner can be dismissed. Default true. Set false on first-run dashboard. */
  dismissable?: boolean;
  /**
   * The idea this banner is for. When provided (and on desktop), the banner
   * leads with a "Launch Claude Code" deep link that auto-connects MCP and picks
   * up the board. Omitted on the dashboard (no single idea) → manual command only.
   */
  ideaId?: string;
  ideaTitle?: string;
  ideaGithubUrl?: string | null;
}

export function McpConnectionBanner({
  agentCount,
  taskCount,
  compact = false,
  className,
  dismissable = true,
  ideaId,
  ideaTitle,
  ideaGithubUrl,
}: McpConnectionBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mounted, setMounted] = useState(false);
  const isDesktop = useMediaQuery("(min-width: 768px)");

  // Launch is gated on having an idea to build the deep link from + desktop.
  const canLaunch = isDesktop && !!ideaId;
  const { launch, copyCommand } = useLaunchClaudeCode({
    ideaId: ideaId ?? "",
    ideaTitle: ideaTitle ?? "your project",
    ideaGithubUrl: ideaGithubUrl ?? null,
  });

  useEffect(() => {
    try {
      if (sessionStorage.getItem(SESSION_DISMISS_KEY) === "true") {
        setDismissed(true);
      }
    } catch {
      // sessionStorage unavailable
    }
    setMounted(true);
  }, []);

  if (!mounted || dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(SESSION_DISMISS_KEY, "true");
    } catch {
      // sessionStorage unavailable
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(MCP_COMMAND);
      setCopied(true);
      toast.success("MCP command copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy — please copy manually");
    }
  };

  // Compact variant for board pages
  if (compact) {
    return (
      <div
        className={cn(
          "flex items-center gap-3 rounded-lg border border-cyan-500/25 bg-cyan-500/[0.06] px-4 py-2.5",
          className
        )}
        role="status"
      >
        <Cable className="h-4 w-4 shrink-0 text-cyan-400" />
        <p className="flex-1 text-sm text-muted-foreground">
          Your agents need{" "}
          <span className="font-medium text-foreground">Claude Code</span> to
          work on tasks.{" "}
          {canLaunch ? (
            <button
              onClick={launch}
              className="font-medium text-emerald-400 hover:text-emerald-300"
            >
              Launch Claude Code &rarr;
            </button>
          ) : (
            <button
              onClick={handleCopy}
              className="font-medium text-cyan-400 hover:text-cyan-300"
            >
              {copied ? "Copied!" : "Copy MCP command"}
            </button>
          )}
          {" · "}
          {canLaunch ? (
            <button
              onClick={() => void copyCommand()}
              className="font-medium text-cyan-400 hover:text-cyan-300"
            >
              Copy command
            </button>
          ) : (
            <Link
              href="/guide/mcp-integration"
              className="font-medium text-cyan-400 hover:text-cyan-300"
            >
              Learn more &rarr;
            </Link>
          )}
          {" · "}
          <span className="text-muted-foreground">
            Then try: <em className="text-violet-400">&quot;{MCP_SUGGESTED_PROMPT}&quot;</em>
          </span>
        </p>
        {dismissable && (
          <button
            onClick={handleDismiss}
            className="shrink-0 rounded-md p-1 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-muted-foreground"
            aria-label="Dismiss MCP connection banner"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    );
  }

  // Full variant for dashboard
  const description =
    agentCount > 0 && taskCount > 0
      ? `You have ${agentCount} agent${agentCount !== 1 ? "s" : ""} and ${taskCount} task${taskCount !== 1 ? "s" : ""} ready to go, but agents need Claude Code (MCP) to work.`
      : agentCount > 0
        ? `You have ${agentCount} agent${agentCount !== 1 ? "s" : ""} ready to go, but they need Claude Code (MCP) to work.`
        : `You have ${taskCount} task${taskCount !== 1 ? "s" : ""} on your board. Connect Claude Code (MCP) so agents can work on them.`;

  return (
    <div
      className={cn(
        "rounded-xl border border-cyan-500/25 bg-cyan-500/[0.06] p-4",
        className
      )}
      role="status"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        {/* Icon */}
        <Cable className="mt-0.5 h-5 w-5 shrink-0 text-cyan-400" />

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">
              Your agents are waiting — connect Claude Code
            </h3>
            {dismissable && (
              <button
                onClick={handleDismiss}
                className="shrink-0 rounded-md p-1 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-muted-foreground sm:hidden"
                aria-label="Dismiss MCP connection banner"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>

          {/* Manual command — the fallback for non-Claude-Code / web users.
              Labelled as "manual setup" when Launch is the primary action. */}
          {canLaunch && (
            <p className="mt-3 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
              <Terminal className="h-3 w-3" />
              Manual setup — connects VibeCodes for all your projects:
            </p>
          )}
          <div
            className={cn(
              "overflow-x-auto rounded-lg bg-black/80 px-3 py-2 font-mono text-xs leading-relaxed",
              canLaunch ? "mt-1.5" : "mt-3"
            )}
          >
            <span className="text-emerald-400">$</span>{" "}
            <span className="text-foreground">{MCP_COMMAND}</span>
          </div>
          {/* Suggested first prompt */}
          <div className="mt-2.5 rounded-lg border border-violet-500/25 bg-violet-500/10 px-3 py-2 text-xs text-violet-300">
            <span className="font-semibold text-violet-400">Once connected: </span>
            run{" "}
            <code className="rounded bg-violet-500/15 px-1 py-0.5 text-[11px] text-foreground">claude</code>
            {" "}and ask{" "}
            <code className="rounded bg-violet-500/15 px-1 py-0.5 text-[11px] text-foreground">
              &quot;{MCP_SUGGESTED_PROMPT}&quot;
            </code>
          </div>
        </div>

        {/* Actions */}
        <div className="flex shrink-0 flex-row gap-2 sm:flex-col">
          {canLaunch && (
            <button
              onClick={launch}
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 transition-colors hover:bg-emerald-400"
            >
              <Rocket className="h-3 w-3" />
              Launch Claude Code
            </button>
          )}
          <button
            onClick={canLaunch ? () => void copyCommand() : handleCopy}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
              canLaunch
                ? "border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                : "bg-amber-500 text-zinc-950 hover:bg-amber-400"
            )}
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {canLaunch ? "Copy command" : copied ? "Copied!" : "Copy command"}
          </button>
          <Link
            href="/guide/mcp-integration"
            className="inline-flex items-center justify-center rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Learn more
          </Link>
          {dismissable && (
            <button
              onClick={handleDismiss}
              className="hidden shrink-0 rounded-md p-1 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-muted-foreground sm:block"
              aria-label="Dismiss MCP connection banner"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
