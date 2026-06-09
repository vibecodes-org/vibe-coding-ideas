"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  applyEnhancedDescription,
  generateClarifyingQuestions,
} from "@/actions/ai";
import { EnhanceDialogShell } from "./enhance-dialog-shell";
import type { BotProfile } from "@/types";

interface EnhanceIdeaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ideaId: string;
  ideaTitle: string;
  currentDescription: string;
  bots: BotProfile[];
  /** Applied kit name — renders the "Tailoring for X" chip when present. */
  kitName?: string | null;
  onCreditUsed?: () => void;
}

/**
 * Thin wrapper around EnhanceDialogShell for the existing-idea flow.
 * Wires the shell to the ideaId-scoped server action and API route.
 */
export function EnhanceIdeaDialog({
  open,
  onOpenChange,
  ideaId,
  currentDescription,
  bots,
  kitName,
  onCreditUsed,
}: EnhanceIdeaDialogProps) {
  const router = useRouter();

  return (
    <EnhanceDialogShell
      open={open}
      onOpenChange={onOpenChange}
      bots={bots}
      currentDescription={currentDescription}
      kitContextLabel={kitName ?? undefined}
      onCreditUsed={onCreditUsed}
      generateQuestions={async ({ prompt, personaPrompt }) => {
        const { questions } = await generateClarifyingQuestions(
          ideaId,
          prompt,
          personaPrompt
        );
        return questions;
      }}
      enhanceStreamUrl="/api/ai/enhance"
      buildStreamBody={({ prompt, personaPrompt, answers, previousEnhanced, refinementFeedback }) => ({
        ideaId,
        prompt,
        personaPrompt,
        answers,
        previousEnhanced,
        refinementFeedback,
      })}
      applyResult={async (enhanced) => {
        await applyEnhancedDescription(ideaId, enhanced);
        toast.success("Description updated with AI enhancement");
        router.refresh();
      }}
    />
  );
}
