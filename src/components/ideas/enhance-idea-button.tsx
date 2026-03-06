"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { BotProfile } from "@/types";

const EnhanceIdeaDialog = dynamic(() => import("./enhance-idea-dialog").then((m) => m.EnhanceIdeaDialog), { ssr: false });

interface EnhanceIdeaButtonProps {
  ideaId: string;
  ideaTitle: string;
  currentDescription: string;
  bots: BotProfile[];
  variant?: "button" | "dropdown";
  disabled?: boolean;
  hasByokKey?: boolean;
  starterCredits?: number;
}

export function EnhanceIdeaButton({
  ideaId,
  ideaTitle,
  currentDescription,
  bots,
  variant = "button",
  disabled = false,
  hasByokKey = false,
  starterCredits = 0,
}: EnhanceIdeaButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [creditsRemaining, setCreditsRemaining] = useState(starterCredits);

  const handleCreditUsed = useCallback(() => {
    setCreditsRemaining((prev) => Math.max(0, prev - 1));
  }, []);

  const handleOpenChange = useCallback((value: boolean) => {
    setOpen(value);
    if (!value) {
      // Sync server state when dialog closes so the page reflects actual credits
      router.refresh();
    }
  }, [router]);

  const tooltipText = disabled
    ? "You've used all 10 free AI credits — add your API key in profile settings for unlimited use"
    : hasByokKey
      ? "Using your API key — unlimited"
      : `${creditsRemaining} free credit${creditsRemaining !== 1 ? "s" : ""} remaining`;

  if (variant === "dropdown") {
    return (
      <>
        <button
          className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent ${disabled ? "opacity-50" : ""}`}
          onClick={() => !disabled && setOpen(true)}
        >
          <Sparkles className="h-4 w-4" />
          Enhance with AI
          {!hasByokKey && creditsRemaining > 0 && (
            <span className="ml-auto rounded-full bg-primary px-1.5 text-[10px] leading-none text-primary-foreground">
              {creditsRemaining}
            </span>
          )}
        </button>
        <EnhanceIdeaDialog
          open={open}
          onOpenChange={handleOpenChange}
          ideaId={ideaId}
          ideaTitle={ideaTitle}
          currentDescription={currentDescription}
          bots={bots}
          onCreditUsed={handleCreditUsed}
        />
      </>
    );
  }

  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={disabled ? 0 : undefined}>
              <Button
                variant="outline"
                size="sm"
                className={`h-8 gap-1.5 text-xs ${disabled ? "pointer-events-none opacity-50" : ""}`}
                onClick={() => !disabled && setOpen(true)}
              >
                <Sparkles className="h-3.5 w-3.5" />
                Enhance with AI
                {!hasByokKey && creditsRemaining > 0 && (
                  <span className="rounded-full bg-primary px-1.5 text-[10px] leading-none text-primary-foreground">
                    {creditsRemaining}
                  </span>
                )}
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {tooltipText}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <EnhanceIdeaDialog
        open={open}
        onOpenChange={handleOpenChange}
        ideaId={ideaId}
        ideaTitle={ideaTitle}
        currentDescription={currentDescription}
        bots={bots}
        onCreditUsed={handleCreditUsed}
      />
    </>
  );
}
