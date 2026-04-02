"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cloneAgent } from "@/actions/bots";
import { toast } from "sonner";
import type { UserIdea } from "./allocate-to-idea-dialog";

interface CloneAgentButtonProps {
  botId: string;
  botName: string;
  botRole?: string;
  userIdeas?: UserIdea[];
}

export function CloneAgentButton({ botId, botName, botRole, userIdeas = [] }: CloneAgentButtonProps) {
  const [cloning, setCloning] = useState(false);
  const [cloned, setCloned] = useState(false);

  async function handleClone() {
    if (cloned) return;
    setCloning(true);
    try {
      await cloneAgent(botId);
      setCloned(true);
      if (userIdeas.length > 0) {
        toast.success(`Added "${botName}" to your agents`, {
          description: botRole ? `${botRole} cloned from community.` : undefined,
          action: {
            label: "Allocate to idea",
            onClick: () => window.location.assign("/agents"),
          },
        });
      } else {
        toast.success(`Added "${botName}" to your agents`, {
          description: "Create an idea to put them to work.",
          action: {
            label: "Create an idea",
            onClick: () => window.location.assign("/ideas/new"),
          },
        });
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to clone agent"
      );
    } finally {
      setCloning(false);
    }
  }

  if (cloned) {
    return (
      <button
        disabled
        className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 px-2.5 py-1 text-xs font-medium text-emerald-500"
      >
        &#x2714; Added
      </button>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-7 text-xs"
      onClick={handleClone}
      disabled={cloning}
    >
      {cloning ? "Adding..." : "+ Add"}
    </Button>
  );
}
