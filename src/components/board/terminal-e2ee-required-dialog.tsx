"use client";

// Terminal P2 (E2EE) design §3 — the DIALOG variant of the Phase B
// fail-closed state, for a surface that's already a dialog (a task's launch-
// choice flow) rather than the in-dock panel StateOverlay renders for the
// connect-time case in terminal-session-view.tsx. Same copy, same actions —
// only the container differs (design's explicit "identical copy and
// actions").
//
// Dismissable EVERY way, per the hard-learned "never trap the user" rule
// (see CLAUDE.md's In-App Terminal section): the shared `Dialog`/`DialogContent`
// primitives (Radix under the hood) already close on Escape, outside-click,
// AND the built-in X — nothing here suppresses any of the three. Closing
// always means "Not now": no session is minted before this dialog's own
// "Update now" is clicked, so backing out costs nothing and leaves nothing
// behind, exactly like `terminal-task-launch-choice.tsx`'s own doc comment
// for the same rule.

import { Shield } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { E2EE_COPY } from "@/lib/terminal/e2ee-copy";
import { HelperUpdateButton } from "./terminal-helper-update-button";
import { Button } from "@/components/ui/button";

export interface TerminalE2eeRequiredDialogProps {
  open: boolean;
  /** Update now → the shared HelperUpdateButton confirm/quiesce/download flow. */
  onUpdate: () => void;
  /** Not now / X / Escape / outside-click — all four call this. No session was ever minted, so this is a pure close. */
  onCancel: () => void;
}

export function TerminalE2eeRequiredDialog({ open, onUpdate, onCancel }: TerminalE2eeRequiredDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent
        className="max-w-sm gap-0 border-zinc-700 bg-[#141417] p-0 text-zinc-200"
        data-testid="terminal-e2ee-required-dialog"
      >
        <div className="min-w-0 px-5 pt-5 pr-9 pb-3">
          <DialogTitle className="flex items-center gap-2 text-[14px] font-semibold text-zinc-100">
            <Shield className="h-4 w-4 text-sky-400" aria-hidden="true" /> {E2EE_COPY.required.title}
          </DialogTitle>
          <DialogDescription className="mt-2 text-[12.5px] leading-relaxed text-zinc-400">
            {E2EE_COPY.required.body}
          </DialogDescription>
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 border-t border-zinc-800 px-5 py-3">
          <Button variant="ghost" size="xs" className="text-zinc-400 hover:text-zinc-100" onClick={onCancel}>
            Not now
          </Button>
          <HelperUpdateButton onClick={onUpdate} />
        </div>
        <p className="border-t border-zinc-800 px-5 py-2.5 text-[11px] text-zinc-500">{E2EE_COPY.required.fine}</p>
      </DialogContent>
    </Dialog>
  );
}
