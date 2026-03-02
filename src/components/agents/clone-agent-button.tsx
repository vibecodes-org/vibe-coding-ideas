"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cloneAgent } from "@/actions/bots";
import { toast } from "sonner";

interface CloneAgentButtonProps {
  botId: string;
  botName: string;
}

export function CloneAgentButton({ botId, botName }: CloneAgentButtonProps) {
  const [cloning, setCloning] = useState(false);
  const [cloned, setCloned] = useState(false);

  async function handleClone() {
    if (cloned) return;
    setCloning(true);
    try {
      await cloneAgent(botId);
      setCloned(true);
      toast.success(`Added "${botName}" to your agents`);
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
