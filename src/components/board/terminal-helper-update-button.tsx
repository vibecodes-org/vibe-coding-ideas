"use client";

// In-app terminal — the shared "Update now" button for helper-update nudges
// (card cbe60db5, rework 4). Extracted so every nudge that offers the same
// action renders the exact same affordance — Nick's field test on the
// chooser's nudge: "why didn't you just copy the button rather than add a
// new type of ux?" The My sessions panel (terminal-my-sessions-panel.tsx)
// and the session chooser (terminal-session-chooser.tsx) both render this,
// so they can't drift apart again.

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  UPDATE_CONFIRM_ACCEPT_LABEL,
  UPDATE_CONFIRM_CANCEL_LABEL,
  UPDATE_CONFIRM_HEADING,
  UPDATE_QUIESCE_TIMEOUT_COPY,
  UPDATE_READY_COPY,
  updateConfirmBody,
  type UpdateFlowPhase,
} from "@/lib/terminal/helper-update-flow";

interface HelperUpdateButtonProps {
  /** My sessions panel: starts the in-app confirm/quiesce/download flow. */
  onClick?: () => void;
  /** Chooser (and any caller without the panel's update-flow state): a
   *  plain link straight to the download, rendered via the Button's
   *  `asChild` so the markup stays an `<a>` under the hood. */
  href?: string;
  className?: string;
}

export function HelperUpdateButton({ onClick, href, className }: HelperUpdateButtonProps) {
  const buttonClassName = cn("flex-none bg-sky-500 text-sky-950 hover:bg-sky-400", className);
  if (href) {
    return (
      <Button asChild size="xs" className={buttonClassName}>
        <a href={href}>Update now</a>
      </Button>
    );
  }
  return (
    <Button size="xs" className={buttonClassName} onClick={onClick}>
      Update now
    </Button>
  );
}

/**
 * The inline notices of the shared quiesce-then-download flow
 * (helper-update-flow.ts): confirm → "Closing the helper…" → ready /
 * taking-a-moment. Nick, 2026-08-25: the session banner's bare "Download"
 * link skipped this flow entirely, so with a session running the DMG
 * downloaded but the still-running helper could never be replaced. Every
 * download affordance now renders the same button + these notices.
 */
export function HelperUpdateFlowNotice({
  phase,
  confirmSessionCount,
  onConfirm,
  onCancel,
}: {
  phase: UpdateFlowPhase;
  confirmSessionCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (phase === "confirming") {
    return (
      <div className="border-b border-l-2 border-l-sky-500 bg-sky-500/5 px-3.5 py-2.5" data-testid="helper-update-confirm">
        <div className="text-[12.5px] font-bold text-sky-300">{UPDATE_CONFIRM_HEADING}</div>
        <div className="text-[11px] text-zinc-500">{updateConfirmBody(confirmSessionCount)}</div>
        <div className="mt-2 flex items-center justify-end gap-2">
          <Button variant="ghost" size="xs" onClick={onCancel}>
            {UPDATE_CONFIRM_CANCEL_LABEL}
          </Button>
          <Button size="xs" className="bg-sky-500 text-sky-950 hover:bg-sky-400" onClick={onConfirm}>
            {UPDATE_CONFIRM_ACCEPT_LABEL}
          </Button>
        </div>
      </div>
    );
  }
  if (phase === "quiescing") {
    return (
      <div className="flex items-center gap-2 border-b border-sky-500/30 bg-sky-500/5 px-3.5 py-1.5 text-[11px] text-sky-300">
        <Loader2 className="h-3 w-3 flex-none animate-spin" /> Closing the helper…
      </div>
    );
  }
  if (phase === "ready" || phase === "quiesce-timeout") {
    return (
      <div
        className={cn(
          "border-b px-3.5 py-2 text-[11px]",
          phase === "ready" ? "border-sky-500/30 bg-sky-500/5 text-sky-300" : "border-amber-500/30 bg-amber-500/5 text-amber-300",
        )}
      >
        {phase === "ready" ? UPDATE_READY_COPY : UPDATE_QUIESCE_TIMEOUT_COPY}
      </div>
    );
  }
  return null;
}
