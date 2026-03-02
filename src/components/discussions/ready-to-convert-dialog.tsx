"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ClipboardCheck, Bot, LayoutDashboard, MessageSquare } from "lucide-react";
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
}

export function ReadyToConvertDialog({
  discussion,
  ideaId,
  columns,
  teamMembers,
}: ReadyToConvertDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [columnId, setColumnId] = useState(columns[0]?.id ?? "");
  const [assigneeId, setAssigneeId] = useState<string>("unassigned");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const bots = teamMembers.filter((m) => m.is_bot);
  const humans = teamMembers.filter((m) => !m.is_bot);
  const selectedColumn = columns.find((c) => c.id === columnId);
  const selectedAssignee =
    assigneeId !== "unassigned"
      ? teamMembers.find((m) => m.id === assigneeId)
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
        assigneeId === "unassigned" ? null : assigneeId
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
            <Label htmlFor="assignee">Assignee (optional)</Label>
            <Select value={assigneeId} onValueChange={setAssigneeId}>
              <SelectTrigger>
                <SelectValue placeholder="Unassigned" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {humans.map((member) => (
                  <SelectItem key={member.id} value={member.id}>
                    {member.full_name ?? member.email}
                  </SelectItem>
                ))}
                {bots.length > 0 && (
                  <>
                    <div className="px-2 py-1.5 text-[10px] font-medium text-muted-foreground">
                      Agents
                    </div>
                    {bots.map((bot) => (
                      <SelectItem key={bot.id} value={bot.id}>
                        <span className="inline-flex items-center gap-1">
                          <Bot className="h-3 w-3" />
                          {bot.full_name ?? bot.email}
                        </span>
                      </SelectItem>
                    ))}
                  </>
                )}
              </SelectContent>
            </Select>
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
              {selectedAssignee && (
                <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  {selectedAssignee.is_bot ? (
                    <Bot className="h-3 w-3" />
                  ) : null}
                  <span>{selectedAssignee.full_name ?? selectedAssignee.email}</span>
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
