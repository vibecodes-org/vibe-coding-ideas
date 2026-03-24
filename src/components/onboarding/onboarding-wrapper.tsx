"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { OnboardingDialog } from "./onboarding-dialog";
import type { KitWithSteps } from "@/actions/kits";

interface OnboardingWrapperProps {
  userFullName: string | null;
  userAvatarUrl: string | null;
  userGithubUsername: string | null;
  kits: KitWithSteps[];
}

export function OnboardingWrapper({
  userFullName,
  userAvatarUrl,
  userGithubUsername,
  kits,
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
    />
  );
}
