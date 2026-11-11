"use client";

// In-app terminal — the setup screens (card 63a60792, stage 1; approved mock
// docs/terminal-agent-setup-mock.html). Rendered in place of the generic ended
// content when a session ended because the agent isn't installed, or because a
// setup session (install / sign in) finished. Anatomy and classes follow the
// existing ended panel: icon, title, one line, a main emerald button, outline
// buttons, small grey underlined links. The only new element is the checklist
// (decision D3). Every word comes from src/lib/terminal/setup-copy.ts.

import { AlertCircle, CheckCircle2, Copy, Download, ExternalLink, Terminal as TerminalIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { AGENT_INSTALL_COMMANDS, AGENT_INSTALL_GUIDE_URLS, type SetupAgent } from "@/lib/terminal/agent-install";
import type { SetupScreen } from "@/lib/terminal/agent-setup";
import { setupScreenCopy, type SetupButtonId, type SetupStep } from "@/lib/terminal/setup-copy";
import { HelperUpdateButton } from "./terminal-helper-update-button";

export interface TerminalAgentSetupPanelProps {
  screen: SetupScreen;
  agent: SetupAgent;
  /** Install / sign in / start / etc. The panel handles copy-to-clipboard itself. */
  onAction: (id: Exclude<SetupButtonId, "copy-command" | "guide">) => void;
  /** Hidden when the dock can't show the chooser. */
  canBrowseSessions: boolean;
  className?: string;
}

/** Copy a command to the clipboard and say so; never silent on failure. */
async function copyCommand(command: string) {
  try {
    await navigator.clipboard.writeText(command);
    toast.success("Copied");
  } catch (err) {
    logger.warn("Setup command copy failed", { error: err instanceof Error ? err.message : String(err) });
    toast.error("Couldn't copy. Select the command and copy it yourself.");
  }
}

function stepLabel(step: SetupStep): string {
  const state = step.state === "done" ? "done" : step.state === "now" ? "current" : "not yet";
  return `Step ${step.n} of 3, ${step.title}, ${state}`;
}

const ICONS = {
  download: <Download className="h-7 w-7 text-zinc-400" aria-hidden="true" />,
  ok: <CheckCircle2 className="h-7 w-7 text-emerald-400" aria-hidden="true" />,
  alert: <AlertCircle className="h-7 w-7 text-zinc-400" aria-hidden="true" />,
} as const;

export function TerminalAgentSetupPanel({ screen, agent, onAction, canBrowseSessions, className }: TerminalAgentSetupPanelProps) {
  const copy = setupScreenCopy(screen, agent);
  const guideUrl = AGENT_INSTALL_GUIDE_URLS[agent];
  const fireStep = (id: SetupButtonId) => {
    if (id === "copy-command" || id === "guide") return;
    onAction(id);
  };

  return (
    <div
      className={cn("flex w-full flex-col items-center gap-3", className)}
      data-testid="agent-setup-panel"
      data-screen={screen}
    >
      {ICONS[copy.icon]}
      <h3 className="text-base font-semibold leading-snug text-zinc-300">{copy.title}</h3>
      {copy.body && <p className="max-w-md text-[13px] text-zinc-400">{copy.body}</p>}

      {copy.steps.length > 0 && (
        <ol className="flex w-full max-w-[26rem] flex-col gap-2.5 text-left" data-testid="agent-setup-steps">
          {copy.steps.map((step) => (
            <li key={step.n} className="flex items-start gap-2.5" aria-label={stepLabel(step)}>
              <span
                aria-hidden="true"
                className={cn(
                  "mt-px inline-flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full border text-xs font-bold",
                  step.state === "done" && "border-emerald-500/50 bg-emerald-500/15 text-emerald-400",
                  step.state === "now" && "border-emerald-500 text-emerald-400",
                  step.state === "later" && "border-zinc-600 text-zinc-400",
                )}
              >
                {step.state === "done" ? "✓" : step.n}
              </span>
              <div className="min-w-0">
                <div
                  className={cn(
                    "text-[13.5px] font-semibold leading-snug",
                    step.state === "now" ? "text-zinc-100" : step.state === "done" ? "text-zinc-400" : "text-zinc-500",
                  )}
                >
                  {step.title}
                </div>
                <div
                  className={cn(
                    "text-xs leading-snug",
                    step.state === "now" ? "text-zinc-400" : step.state === "done" ? "text-zinc-500" : "text-zinc-600",
                  )}
                >
                  {step.detail}
                </div>
                {step.action && (
                  <Button
                    size="sm"
                    className="mt-2 h-8 bg-emerald-500 px-3 text-[13px] text-emerald-950 hover:bg-emerald-400"
                    onClick={() => fireStep(step.action!.id)}
                  >
                    <TerminalIcon className="h-4 w-4" /> {step.action.label}
                  </Button>
                )}
                {step.command && (
                  <div className="mt-1.5 text-[11px] text-zinc-500">
                    Runs on your Mac:{" "}
                    <code className="break-all rounded border border-zinc-700 bg-zinc-800/80 px-1 font-mono text-[11px] text-zinc-200">
                      {step.command}
                    </code>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}

      {copy.copyBox && (
        <div className="flex w-full max-w-md flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-900/70 px-3 py-2.5 text-left">
          <div className="text-xs text-zinc-400">{copy.copyBox.lead}</div>
          <div className="flex items-center justify-between gap-2">
            <code className="break-all rounded border border-zinc-700 bg-zinc-800/80 px-1.5 py-[3px] font-mono text-[11.5px] text-zinc-200">
              {copy.copyBox.command}
            </code>
            <Button
              variant="outline"
              size="xs"
              className="flex-none border-zinc-700 bg-zinc-800/60 text-zinc-200 hover:bg-zinc-700"
              onClick={() => void copyCommand(copy.copyBox!.command)}
            >
              <Copy className="h-3 w-3" /> Copy
            </Button>
          </div>
          <div className="text-xs text-zinc-400">{copy.copyBox.after}</div>
        </div>
      )}

      {copy.buttons.length > 0 && (
        <div className="flex flex-wrap justify-center gap-2.5">
          {copy.buttons.map((b) => {
            const run = () => (b.id === "copy-command" ? void copyCommand(AGENT_INSTALL_COMMANDS[agent]) : fireStep(b.id));
            if (b.tone === "update") {
              return <HelperUpdateButton key={b.id} onClick={run} className="h-9 px-4 text-sm font-semibold" />;
            }
            return b.tone === "primary" ? (
              <Button key={b.id} className="bg-emerald-500 text-emerald-950 hover:bg-emerald-400" onClick={run}>
                <TerminalIcon className="h-4 w-4" /> {b.label}
              </Button>
            ) : (
              <Button
                key={b.id}
                variant="outline"
                className="border-zinc-700 bg-zinc-800/60 text-zinc-200 hover:bg-zinc-700"
                onClick={run}
              >
                {b.id === "start-again" && <TerminalIcon className="h-4 w-4" />}
                {b.id === "copy-command" && <Copy className="h-4 w-4" />}
                {b.label}
              </Button>
            );
          })}
        </div>
      )}

      {copy.links.length > 0 && (
        <div className="flex flex-wrap justify-center gap-x-3.5 gap-y-1">
          {copy.links.map((l) => {
            if (l.id === "sessions" && !canBrowseSessions) return null;
            if (l.id === "guide") {
              return (
                <a
                  key={l.id}
                  href={guideUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[12px] font-medium text-zinc-300 underline decoration-zinc-600 underline-offset-2 hover:text-zinc-100"
                >
                  {l.label} <ExternalLink className="h-[11px] w-[11px]" aria-hidden="true" />
                </a>
              );
            }
            return (
              <button
                key={l.id}
                type="button"
                className="text-[11px] text-zinc-500 underline hover:text-zinc-300"
                onClick={() => fireStep(l.id)}
              >
                {l.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
