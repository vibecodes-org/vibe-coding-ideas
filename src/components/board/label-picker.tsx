"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Check, X } from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { LABEL_COLORS } from "@/lib/constants";
import { getLabelColorConfig } from "@/lib/utils";
import { logTaskActivity } from "@/lib/activity";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  addLabelToTask,
  removeLabelFromTask,
  checkLabelAutoRuleWorkflow,
  createBoardLabel,
  updateBoardLabel,
  deleteBoardLabel,
} from "@/actions/board";
import type { BoardLabel } from "@/types";

interface LabelPickerProps {
  boardLabels: BoardLabel[];
  taskLabels: BoardLabel[];
  taskId: string;
  ideaId: string;
  currentUserId?: string;
  children: React.ReactNode;
  inDialog?: boolean;
  onLabelsChange?: (labelIds: string[]) => void;
}

export function LabelPicker({
  boardLabels,
  taskLabels,
  taskId,
  ideaId,
  currentUserId,
  children,
  inDialog = false,
  onLabelsChange,
}: LabelPickerProps) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("blue");
  const [saving, setSaving] = useState(false);

  // Local copy of board labels for optimistic updates after edit/create/delete
  const [localBoardLabels, setLocalBoardLabels] = useState(boardLabels);
  const [lastBoardLabelsKey, setLastBoardLabelsKey] = useState(() =>
    boardLabels.map((l) => `${l.id}:${l.color}:${l.name}`).sort().join(",")
  );
  const currentBoardLabelsKey = boardLabels.map((l) => `${l.id}:${l.color}:${l.name}`).sort().join(",");
  if (currentBoardLabelsKey !== lastBoardLabelsKey) {
    setLocalBoardLabels(boardLabels);
    setLastBoardLabelsKey(currentBoardLabelsKey);
  }

  // Workflow removal confirmation state
  const [confirmRemove, setConfirmRemove] = useState<{
    labelId: string;
    templateName?: string;
  } | null>(null);

  // Optimistic local state for assigned label IDs
  const [localLabelIds, setLocalLabelIds] = useState<Set<string>>(() => new Set(taskLabels.map((l) => l.id)));

  // Sync with props when they change (after Realtime refresh)
  const [lastTaskLabelsKey, setLastTaskLabelsKey] = useState(() =>
    taskLabels
      .map((l) => l.id)
      .sort()
      .join(",")
  );
  const currentKey = taskLabels
    .map((l) => l.id)
    .sort()
    .join(",");
  if (currentKey !== lastTaskLabelsKey) {
    setLocalLabelIds(new Set(taskLabels.map((l) => l.id)));
    setLastTaskLabelsKey(currentKey);
  }

  async function handleToggleLabel(labelId: string) {
    const isCurrentlyAssigned = localLabelIds.has(labelId);

    // When removing a label, check if it has an auto-rule with an active workflow
    if (isCurrentlyAssigned) {
      try {
        const check = await checkLabelAutoRuleWorkflow(taskId, labelId, ideaId);
        if (check.hasActiveWorkflow) {
          setConfirmRemove({ labelId, templateName: check.templateName });
          return;
        }
      } catch {
        // If check fails, proceed without confirmation
      }
    }

    await executeToggleLabel(labelId, isCurrentlyAssigned, false);
  }

  async function executeToggleLabel(labelId: string, isCurrentlyAssigned: boolean, removeWorkflow: boolean) {
    // Optimistic update
    const nextIds = new Set(localLabelIds);
    if (isCurrentlyAssigned) {
      nextIds.delete(labelId);
    } else {
      nextIds.add(labelId);
    }
    setLocalLabelIds(nextIds);
    onLabelsChange?.([...nextIds]);

    try {
      if (isCurrentlyAssigned) {
        await removeLabelFromTask(taskId, labelId, ideaId, removeWorkflow);
      } else {
        await addLabelToTask(taskId, labelId, ideaId);
      }
      if (currentUserId) {
        const label = localBoardLabels.find((l) => l.id === labelId);
        logTaskActivity(taskId, ideaId, currentUserId, isCurrentlyAssigned ? "label_removed" : "label_added", {
          label_name: label?.name ?? "Unknown",
        });
      }
    } catch {
      toast.error("Failed to update label");
      const rolledBack = new Set(localLabelIds);
      if (isCurrentlyAssigned) {
        rolledBack.add(labelId);
      } else {
        rolledBack.delete(labelId);
      }
      setLocalLabelIds(rolledBack);
      onLabelsChange?.([...rolledBack]);
    }
  }

  function handleConfirmRemoveWorkflow() {
    if (!confirmRemove) return;
    executeToggleLabel(confirmRemove.labelId, true, true);
    setConfirmRemove(null);
  }

  function handleCancelRemoveWorkflow() {
    if (!confirmRemove) return;
    // Remove label without removing workflow
    executeToggleLabel(confirmRemove.labelId, true, false);
    setConfirmRemove(null);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;

    setSaving(true);
    try {
      await createBoardLabel(ideaId, newName.trim(), newColor);
      setNewName("");
      setNewColor("blue");
      setCreating(false);
    } catch {
      toast.error("Failed to create label");
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(labelId: string) {
    if (!newName.trim()) return;

    setSaving(true);
    try {
      await updateBoardLabel(labelId, ideaId, {
        name: newName.trim(),
        color: newColor,
      });
      // Optimistically update local labels so color/name change is reflected immediately
      setLocalBoardLabels((prev) =>
        prev.map((l) => (l.id === labelId ? { ...l, name: newName.trim(), color: newColor } : l))
      );
      setEditingId(null);
      setNewName("");
      setNewColor("blue");
    } catch {
      toast.error("Failed to update label");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(labelId: string) {
    setSaving(true);
    try {
      await deleteBoardLabel(labelId, ideaId);
      setLocalBoardLabels((prev) => prev.filter((l) => l.id !== labelId));
      setEditingId(null);
    } catch {
      toast.error("Failed to delete label");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(label: BoardLabel) {
    setEditingId(label.id);
    setNewName(label.name);
    setNewColor(label.color);
    setCreating(false);
  }

  function startCreate() {
    setCreating(true);
    setEditingId(null);
    setNewName("");
    setNewColor("blue");
  }

  const pickerContent = (
    <div onClick={(e) => e.stopPropagation()}>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">Labels</p>
        <button
          className="cursor-pointer rounded-sm p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={() => setOpen(false)}
          type="button"
          aria-label="Close"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Existing labels */}
      <div className="max-h-[200px] space-y-1 overflow-y-auto">
        {localBoardLabels.map((label) => {
          if (editingId === label.id) {
            return (
              <div key={label.id} className="space-y-2 rounded-md border p-2">
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="h-7 text-xs"
                  placeholder="Label name"
                />
                <div className="flex flex-wrap gap-1">
                  {LABEL_COLORS.map((c) => (
                    <button
                      key={c.value}
                      className={`h-5 w-5 rounded-sm ${c.swatchColor} ${
                        newColor === c.value ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : ""
                      }`}
                      onClick={() => setNewColor(c.value)}
                      type="button"
                    />
                  ))}
                </div>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    className="h-6 flex-1 text-xs"
                    onClick={() => handleUpdate(label.id)}
                    disabled={saving || !newName.trim()}
                  >
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-6 text-xs"
                    onClick={() => handleDelete(label.id)}
                    disabled={saving}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setEditingId(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            );
          }

          const config = getLabelColorConfig(label.color);
          return (
            <div key={label.id} className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-muted/50">
              <Checkbox checked={localLabelIds.has(label.id)} onCheckedChange={() => handleToggleLabel(label.id)} />
              <span className={`h-3 w-3 shrink-0 rounded-sm ${config.swatchColor}`} />
              <span className="flex-1 text-xs font-medium">{label.name}</span>
              <button
                className="cursor-pointer text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100"
                onClick={() => startEdit(label)}
              >
                <Pencil className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Create new label */}
      {creating ? (
        <form onSubmit={handleCreate} className="mt-2 space-y-2 rounded-md border p-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="h-7 text-xs"
            placeholder="Label name"
            autoFocus
          />
          <div className="flex flex-wrap gap-1">
            {LABEL_COLORS.map((c) => (
              <button
                key={c.value}
                className={`h-5 w-5 rounded-sm ${c.swatchColor} ${
                  newColor === c.value ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : ""
                }`}
                onClick={() => setNewColor(c.value)}
                type="button"
              />
            ))}
          </div>
          <div className="flex gap-1">
            <Button type="submit" size="sm" className="h-6 flex-1 text-xs" disabled={saving || !newName.trim()}>
              <Check className="mr-1 h-3 w-3" />
              Create
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setCreating(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 w-full justify-start gap-1.5 text-xs text-muted-foreground"
          onClick={startCreate}
        >
          <Plus className="h-3 w-3" />
          Create a label
        </Button>
      )}
    </div>
  );

  // When inside a Dialog, render without Portal to avoid focus trap conflicts
  const popoverContentClass =
    "z-50 w-64 rounded-md border bg-popover p-2 text-popover-foreground shadow-md outline-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95";

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{children}</PopoverTrigger>
        {inDialog ? (
          <PopoverPrimitive.Content
            align="start"
            sideOffset={4}
            className={popoverContentClass}
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            {pickerContent}
          </PopoverPrimitive.Content>
        ) : (
          <PopoverContent className="w-64 p-2" align="start">
            {pickerContent}
          </PopoverContent>
        )}
      </Popover>

      <AlertDialog open={!!confirmRemove} onOpenChange={(open) => !open && setConfirmRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove label with active workflow?</AlertDialogTitle>
            <AlertDialogDescription>
              This label has a workflow trigger that applied the{" "}
              <span className="font-medium text-foreground">
                {confirmRemove?.templateName ?? "workflow"}
              </span>{" "}
              workflow to this task. Do you also want to remove the active workflow?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmRemove(null)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleCancelRemoveWorkflow}>
              Keep workflow
            </AlertDialogAction>
            <AlertDialogAction
              variant="destructive"
              onClick={handleConfirmRemoveWorkflow}
            >
              Remove workflow
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
