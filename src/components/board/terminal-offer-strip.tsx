"use client";

// The bar under a session's terminal that appears when a card's whole workflow
// has finished (card 7c728159). It sits below the terminal, never over it, so
// the input line stays visible, and it never takes keyboard focus. What it
// says and which buttons it shows come from offer-copy.ts.

import { useRef } from "react";
import { Terminal as TerminalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { offerStripCopy, type OfferStripInput } from "@/lib/terminal/offer-copy";

export interface TerminalOfferStripProps extends OfferStripInput {
  onNotNow: () => void;
  onStart: () => void;
  onDismiss: () => void;
  onClose: () => void;
}

export function TerminalOfferStrip({ onNotNow, onStart, onDismiss, onClose, ...input }: TerminalOfferStripProps) {
  const copy = offerStripCopy(input);
  // A second click while the first is still being handled starts nothing.
  const startedRef = useRef(false);
  const handleStart = () => {
    if (startedRef.current) return;
    startedRef.current = true;
    onStart();
  };

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="offer-strip"
      data-variant={copy.variant}
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-zinc-800 bg-[#141417] px-3.5 py-2.5"
    >
      <div className="min-w-0 flex-[1_1_280px] text-[12.5px] text-zinc-300">
        <span className="block">
          {copy.title}
          {copy.cardTitle && <> <span className="font-semibold text-zinc-100">{copy.cardTitle}</span></>}
        </span>
        <span className="block text-[11.5px] text-zinc-500">{copy.detail}</span>
      </div>
      <div className="ml-auto flex gap-2">
        {copy.actions.includes("notNow") && (
          <Button variant="ghost" size="xs" className="text-zinc-400 hover:text-zinc-100" onClick={onNotNow}>
            Not now
          </Button>
        )}
        {copy.actions.includes("dismiss") && (
          <Button variant="ghost" size="xs" className="text-zinc-400 hover:text-zinc-100" onClick={onDismiss}>
            Dismiss
          </Button>
        )}
        {copy.actions.includes("close") && (
          <Button
            variant="outline"
            size="xs"
            className="border-zinc-700 bg-zinc-800/60 text-zinc-200 hover:bg-zinc-700"
            onClick={onClose}
          >
            Close this session
          </Button>
        )}
        {copy.actions.includes("start") && (
          <Button size="xs" className="bg-emerald-500 text-emerald-950 hover:bg-emerald-400" onClick={handleStart}>
            <TerminalIcon className="h-3 w-3" /> Start in a new tab
          </Button>
        )}
      </div>
    </div>
  );
}
