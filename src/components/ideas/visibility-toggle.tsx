"use client";

import { useState } from "react";
import { Lock, Globe } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { updateIdeaFields } from "@/actions/ideas";

interface VisibilityToggleProps {
  ideaId: string;
  visibility: "public" | "private";
  isAuthor: boolean;
}

export function VisibilityToggle({
  ideaId,
  visibility: initialVisibility,
  isAuthor,
}: VisibilityToggleProps) {
  const [visibility, setVisibility] = useState(initialVisibility);

  async function handleToggle() {
    if (!isAuthor) return;
    const next = visibility === "public" ? "private" : "public";
    setVisibility(next);
    try {
      await updateIdeaFields(ideaId, { visibility: next });
    } catch {
      toast.error("Failed to update visibility");
      setVisibility(visibility);
    }
  }

  if (!isAuthor && visibility === "public") return null;

  return (
    <Badge
      variant="outline"
      className={`gap-1 shrink-0 ${isAuthor ? "cursor-pointer hover:bg-accent transition-colors" : ""}`}
      onClick={isAuthor ? handleToggle : undefined}
    >
      {visibility === "private" ? (
        <>
          <Lock className="h-3 w-3" />
          Private
        </>
      ) : (
        <>
          <Globe className="h-3 w-3" />
          Public
        </>
      )}
    </Badge>
  );
}
