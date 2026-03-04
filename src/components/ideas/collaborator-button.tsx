"use client";

import { useState, useTransition } from "react";
import { UserPlus, UserMinus, Clock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { requestCollaboration, withdrawRequest, leaveCollaboration } from "@/actions/collaborators";

interface CollaboratorButtonProps {
  ideaId: string;
  isCollaborator: boolean;
  isAuthor: boolean;
  pendingRequestId?: string | null;
}

export function CollaboratorButton({ ideaId, isCollaborator, isAuthor, pendingRequestId }: CollaboratorButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [optimisticState, setOptimisticState] = useState<"idle" | "requested" | "withdrawn">("idle");

  if (isAuthor) return null;

  if (isCollaborator) {
    return (
      <Button
        variant="outline"
        onClick={() => {
          startTransition(async () => {
            try {
              await leaveCollaboration(ideaId);
            } catch {
              toast.error("Failed to leave project");
            }
          });
        }}
        disabled={isPending}
        size="sm"
        className="gap-2"
      >
        <UserMinus className="h-4 w-4" />
        Leave Project
      </Button>
    );
  }

  const showRequested = optimisticState === "requested" || (pendingRequestId && optimisticState !== "withdrawn");

  if (showRequested) {
    return (
      <Button
        variant="outline"
        onClick={() => {
          startTransition(async () => {
            try {
              await withdrawRequest(ideaId);
              setOptimisticState("withdrawn");
              toast.success("Request withdrawn");
            } catch {
              toast.error("Failed to withdraw request");
            }
          });
        }}
        disabled={isPending}
        size="sm"
        className="gap-2 text-muted-foreground"
      >
        <Clock className="h-4 w-4" />
        Requested
      </Button>
    );
  }

  return (
    <Button
      variant="default"
      onClick={() => {
        startTransition(async () => {
          try {
            await requestCollaboration(ideaId);
            setOptimisticState("requested");
            toast.success("Collaboration request sent");
          } catch {
            setOptimisticState("idle");
            toast.error("Failed to send request");
          }
        });
      }}
      disabled={isPending}
      size="sm"
      className="gap-2"
    >
      <UserPlus className="h-4 w-4" />
      I want to build this
    </Button>
  );
}
