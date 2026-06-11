"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { OnboardingDialog } from "./onboarding-dialog";
import type { KitWithSteps } from "@/actions/kits";

interface SimpleBotProfile {
  id: string;
  full_name: string | null;
  role: string | null;
  system_prompt: string | null;
  is_active: boolean;
}

interface OnboardingWrapperProps {
  userFullName: string | null;
  userAvatarUrl: string | null;
  userGithubUsername: string | null;
  kits: KitWithSteps[];
  canUseAi: boolean;
  hasByokKey: boolean;
  starterCredits: number;
  bots: SimpleBotProfile[];
}

export function OnboardingWrapper({
  userFullName,
  userAvatarUrl,
  userGithubUsername,
  kits,
  canUseAi,
  hasByokKey,
  starterCredits,
  bots,
}: OnboardingWrapperProps) {
  const [open, setOpen] = useState(true);
  const router = useRouter();

  const handleComplete = () => {
    setOpen(false);
    router.refresh();
  };

  if (!open) return null;

  return (
    <OnboardingDialog
      open={open}
      onComplete={handleComplete}
      userFullName={userFullName}
      userAvatarUrl={userAvatarUrl}
      userGithubUsername={userGithubUsername}
      kits={kits}
      canUseAi={canUseAi}
      hasByokKey={hasByokKey}
      starterCredits={starterCredits}
      bots={bots}
    />
  );
}
