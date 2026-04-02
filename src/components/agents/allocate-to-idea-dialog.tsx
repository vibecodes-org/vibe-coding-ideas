"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { allocateAllAgents } from "@/actions/idea-agents";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export interface UserIdea {
  id: string;
  title: string;
  agent_count?: number;
  task_count?: number;
  workflow_count?: number;
}

interface AllocateToIdeaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  botIds: string[];
  ideas: UserIdea[];
  teamName?: string;
}

export function AllocateToIdeaDialog({
  open,
  onOpenChange,
  botIds,
  ideas,
  teamName,
}: AllocateToIdeaDialogProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allocating, setAllocating] = useState(false);

  function toggleIdea(ideaId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(ideaId)) {
        next.delete(ideaId);
      } else {
        next.add(ideaId);
      }
      return next;
    });
  }

  async function handleAllocate() {
    if (selected.size === 0) return;
    setAllocating(true);
    try {
      for (const ideaId of selected) {
        await allocateAllAgents(ideaId, botIds);
      }
      toast.success(
        `Agents allocated to ${selected.size} idea${selected.size !== 1 ? "s" : ""}`
      );
      onOpenChange(false);
      setSelected(new Set());
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to allocate agents"
      );
    } finally {
      setAllocating(false);
    }
  }

  function handleSkip() {
    onOpenChange(false);
    setSelected(new Set());
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Allocate agents to your ideas</DialogTitle>
          <DialogDescription>
            {botIds.length} agent{botIds.length !== 1 ? "s were" : " was"} cloned
            {teamName ? ` from ${teamName}` : ""}. Select which ideas they
            should work on.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 py-2">
          {ideas.map((idea) => (
            <button
              key={idea.id}
              type="button"
              onClick={() => toggleIdea(idea.id)}
              className={cn(
                "flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                selected.has(idea.id)
                  ? "border-violet-500 bg-violet-500/[0.06]"
                  : "border-border hover:border-border/80 hover:bg-muted/30"
              )}
            >
              <Checkbox
                checked={selected.has(idea.id)}
                onCheckedChange={() => toggleIdea(idea.id)}
                className="shrink-0"
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{idea.title}</div>
                <div className="text-xs text-muted-foreground">
                  {[
                    idea.agent_count !== undefined &&
                      `${idea.agent_count} agent${idea.agent_count !== 1 ? "s" : ""}`,
                    idea.task_count !== undefined &&
                      `${idea.task_count} task${idea.task_count !== 1 ? "s" : ""}`,
                    idea.workflow_count !== undefined
                      ? idea.workflow_count > 0
                        ? `${idea.workflow_count} workflow${idea.workflow_count !== 1 ? "s" : ""}`
                        : "No workflows"
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" \u00B7 ")}
                </div>
              </div>
            </button>
          ))}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleSkip} disabled={allocating}>
            Skip for now
          </Button>
          <Button
            onClick={handleAllocate}
            disabled={selected.size === 0 || allocating}
          >
            {allocating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Allocating...
              </>
            ) : (
              `Allocate to ${selected.size || ""} idea${selected.size !== 1 ? "s" : ""}`.replace(
                "to  idea",
                "to ideas"
              )
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
