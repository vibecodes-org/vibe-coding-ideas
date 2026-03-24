"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Cable, X, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const MCP_COMMAND = "claude mcp add vibecodes https://vibecodes.co.uk/api/mcp";
const SESSION_DISMISS_KEY = "mcp-banner-dismissed";

interface McpConnectionBannerProps {
  agentCount: number;
  taskCount: number;
  compact?: boolean;
  className?: string;
  /** Whether the banner can be dismissed. Default true. Set false on first-run dashboard. */
  dismissable?: boolean;
}

export function McpConnectionBanner({
  agentCount,
  taskCount,
  compact = false,
  className,
  dismissable = true,
}: McpConnectionBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mounted, setMounted] = useState(false);

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
          "flex items-center gap-3 rounded-lg border border-amber-500/25 bg-amber-500/[0.12] px-4 py-2.5",
          className
        )}
        role="status"
      >
        <Cable className="h-4 w-4 shrink-0 text-amber-400" />
        <p className="flex-1 text-sm text-muted-foreground">
          Your agents need{" "}
          <span className="font-medium text-foreground">Claude Code</span> to
          work on tasks.{" "}
          <button
            onClick={handleCopy}
            className="font-medium text-amber-400 hover:text-amber-300"
          >
            {copied ? "Copied!" : "Copy MCP command"}
          </button>
          {" · "}
          <Link
            href="/guide/mcp-integration"
            className="font-medium text-amber-400 hover:text-amber-300"
          >
            Learn more &rarr;
          </Link>
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
        "rounded-xl border border-amber-500/25 bg-amber-500/[0.12] p-4",
        className
      )}
      role="status"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        {/* Icon */}
        <Cable className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />

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

          {/* Terminal block */}
          <div className="mt-3 overflow-x-auto rounded-lg bg-black/80 px-3 py-2 font-mono text-xs leading-relaxed">
            <span className="text-emerald-400">$</span>{" "}
            <span className="text-foreground">{MCP_COMMAND}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex shrink-0 flex-row gap-2 sm:flex-col">
          <button
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 transition-colors hover:bg-amber-400"
          >
            {copied ? (
              <Check className="h-3 w-3" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
            {copied ? "Copied!" : "Copy command"}
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
