"use client";

import { toast } from "sonner";
import { generateCreateClarifyingQuestions } from "@/actions/ai";
import { EnhanceDialogShell } from "./enhance-dialog-shell";

interface SimpleBotProfile {
  id: string;
  full_name: string | null;
  role: string | null;
  system_prompt: string | null;
  is_active: boolean;
}

interface CreateEnhanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  kitType?: string;
  bots: SimpleBotProfile[];
  onApply: (enhanced: string) => void;
  onCreditUsed?: () => void;
}

const CREATE_DEFAULT_PROMPT =
  "Improve this idea description. Add more detail, user stories, technical scope, and a clear product vision. Keep the original voice and intent.";

/**
 * Thin wrapper around EnhanceDialogShell for the create-flow (draft idea, no DB row yet).
 * Wires the shell to the create-flow server action and API route, plus the kit-context chip.
 */
export function CreateEnhanceDialog({
  open,
  onOpenChange,
  title,
  description,
  kitType,
  bots,
  onApply,
  onCreditUsed,
}: CreateEnhanceDialogProps) {
  // SimpleBotProfile uses `full_name` where the shell expects `name`. Quick map.
  const shellBots = bots.map((b) => ({
    id: b.id,
    name: b.full_name ?? "Unnamed",
    role: b.role,
    system_prompt: b.system_prompt,
    is_active: b.is_active,
  }));

  return (
    <EnhanceDialogShell
      open={open}
      onOpenChange={onOpenChange}
      bots={shellBots}
      currentDescription={description}
      defaultPrompt={CREATE_DEFAULT_PROMPT}
      kitContextLabel={kitType}
      onCreditUsed={onCreditUsed}
      generateQuestions={async ({ prompt, personaPrompt }) => {
        const { questions } = await generateCreateClarifyingQuestions({
          title,
          description,
          kitType,
          prompt,
          personaPrompt,
        });
        return questions;
      }}
      enhanceStreamUrl="/api/ai/enhance-create"
      buildStreamBody={({ prompt, personaPrompt, answers, previousEnhanced, refinementFeedback }) => ({
        title,
        description,
        kitType,
        prompt,
        personaPrompt,
        answers,
        previousEnhanced,
        refinementFeedback,
      })}
      applyResult={async (enhanced) => {
        onApply(enhanced);
        toast.success("Description enhanced with AI");
      }}
    />
  );
}
