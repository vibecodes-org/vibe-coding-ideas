"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ClipboardCheck, Bot, LayoutDashboard, MessageSquare, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { markReadyToConvert } from "@/actions/discussions";
import type { IdeaDiscussion, BoardColumn, User } from "@/types";

interface ReadyToConvertDialogProps {
  discussion: IdeaDiscussion;
  ideaId: string;
  columns: BoardColumn[];
  teamMembers: User[];
  defaultOrchestratorBot?: User | null;
}

export function ReadyToConvertDialog({
  discussion,
  ideaId,
  columns,
  teamMembers,
  defaultOrchestratorBot = null,
}: ReadyToConvertDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [columnId, setColumnId] = useState(columns[0]?.id ?? "");
  const [agentId, setAgentId] = useState<string>(defaultOrchestratorBot?.id ?? "none");
  const [autonomyLevel, setAutonomyLevel] = useState("2");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const teamBots = teamMembers.filter((m) => m.is_bot);
  const bots = defaultOrchestratorBot && !teamBots.some((b) => b.id === defaultOrchestratorBot.id)
    ? [defaultOrchestratorBot, ...teamBots]
    : teamBots;
  const selectedColumn = columns.find((c) => c.id === columnId);
  const selectedAgent =
    agentId !== "none"
      ? bots.find((m) => m.id === agentId)
      : null;

  async function handleSubmit() {
    if (!columnId) {
      toast.error("Please select a target column");
      return;
    }

    setIsSubmitting(true);
    try {
      await markReadyToConvert(
        discussion.id,
        ideaId,
        columnId,
        agentId === "none" ? null : agentId,
        parseInt(autonomyLevel, 10)
      );
      toast.success("Discussion queued for conversion");
      setOpen(false);
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update";
      if (message.includes("NEXT_REDIRECT")) throw err;
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
        >
          <ClipboardCheck className="h-3.5 w-3.5" />
          Ready to Convert
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:!max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Queue for Agent Conversion</DialogTitle>
          <DialogDescription>
            Mark this discussion for an agent to convert into a board task. The
            task will link back to the original thread.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="targetColumn">Target Column</Label>
            <Select value={columnId} onValueChange={setColumnId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a column" />
              </SelectTrigger>
              <SelectContent>
                {columns.map((col) => (
                  <SelectItem key={col.id} value={col.id}>
                    {col.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="orchestrationAgent">Orchestration Agent (optional)</Label>
            <Select value={agentId} onValueChange={setAgentId}>
              <SelectTrigger>
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {bots.map((bot) => (
                  <SelectItem key={bot.id} value={bot.id}>
                    <span className="inline-flex items-center gap-1">
                      <Bot className="h-3 w-3" />
                      {bot.full_name ?? bot.email}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="autonomyLevel">
              <span className="inline-flex items-center gap-1">
                <Shield className="h-3.5 w-3.5" />
                Human Oversight Level
              </span>
            </Label>
            <Select value={autonomyLevel} onValueChange={setAutonomyLevel}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Full Oversight — review after every step</SelectItem>
                <SelectItem value="2">Key Checkpoints — review after deliverables &amp; quality gates</SelectItem>
                <SelectItem value="3">Review on Completion — single sign-off at end</SelectItem>
                <SelectItem value="4">Fully Autonomous — no human steps</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Controls how many human validation checkpoints the agent adds to the workflow.
            </p>
          </div>

          {/* Preview */}
          <div className="space-y-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Preview
            </span>
            <div className="rounded-md border bg-background p-3">
              <div className="flex items-center gap-2">
                <LayoutDashboard className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">
                  {discussion.title}
                </span>
                {selectedColumn && (
                  <span className="ml-auto rounded bg-accent px-2 py-0.5 text-[10px] text-muted-foreground">
                    {selectedColumn.title}
                  </span>
                )}
              </div>
              {selectedAgent && (
                <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Bot className="h-3 w-3" />
                  <span>{selectedAgent.full_name ?? selectedAgent.email}</span>
                </div>
              )}
              <div className="mt-2 flex items-center gap-2 rounded bg-blue-500/[0.06] px-3 py-2 text-xs text-muted-foreground">
                <MessageSquare className="h-3.5 w-3.5 text-blue-400" />
                <span>
                  Linked from:{" "}
                  <span className="text-blue-400">{discussion.title}</span>
                </span>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || !columnId}
            className="gap-2"
          >
            <ClipboardCheck className="h-4 w-4" />
            {isSubmitting ? "Saving..." : "Queue for Conversion"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
