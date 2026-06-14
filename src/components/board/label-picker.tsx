"use client";

import { useState, useRef, useEffect } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Check, X } from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

  // Per-label pending optimistic intent: labelId -> the assigned state we're
  // trying to persist. Doubles as the in-flight guard (drop rapid re-clicks on a
  // label mid-flight) AND lets the prop-resync below keep an unsettled toggle.
  const pendingRef = useRef<Map<string, boolean>>(new Map());
  // Set true by a dialog button so the dialog's dismiss path (Escape/outside
  // click) doesn't double-handle or wrongly revert after a real choice.
  const resolvingRef = useRef(false);

  // Sync with props when they change (after Realtime refresh). The board view
  // delivers Realtime echoes PIECEMEAL while you're still clicking, so we merge
  // any in-flight optimistic toggles on top of the incoming server set — without
  // this, an unrelated echo resets localLabelIds and the just-clicked checkbox
  // flickers off then back on (the "flaky on the board" bug).
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
    const merged = new Set(taskLabels.map((l) => l.id));
    for (const [id, assigned] of pendingRef.current) {
      if (assigned) merged.add(id);
      else merged.delete(id);
    }
    setLocalLabelIds(merged);
    setLastTaskLabelsKey(currentKey);
  }

  // Mirror the current assigned set to the parent (optimistic toggles + Realtime
  // resync), so it always reflects the true set — not just user-initiated toggles.
  useEffect(() => {
    onLabelsChange?.([...localLabelIds]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localLabelIds]);

  // Optimistic UI ONLY — functional + concurrency-safe (rapid toggles of
  // different labels won't clobber each other). Server work lives in `persist`.
  function applyOptimistic(labelId: string, assigned: boolean) {
    setLocalLabelIds((prev) => {
      const next = new Set(prev);
      if (assigned) next.add(labelId);
      else next.delete(labelId);
      return next;
    });
  }

  // Persist a toggle to the server; revert the optimistic UI on failure.
  async function persist(labelId: string, wasAssigned: boolean, removeWorkflow: boolean) {
    try {
      if (wasAssigned) {
        await removeLabelFromTask(taskId, labelId, ideaId, removeWorkflow);
      } else {
        await addLabelToTask(taskId, labelId, ideaId);
      }
      if (currentUserId) {
        const label = localBoardLabels.find((l) => l.id === labelId);
        logTaskActivity(taskId, ideaId, currentUserId, wasAssigned ? "label_removed" : "label_added", {
          label_name: label?.name ?? "Unknown",
        });
      }
    } catch {
      toast.error("Failed to update label");
      applyOptimistic(labelId, wasAssigned); // revert to the pre-toggle state
    }
  }

  async function handleToggleLabel(labelId: string) {
    if (pendingRef.current.has(labelId)) return; // drop rapid re-clicks (in flight)
    const wasAssigned = localLabelIds.has(labelId);
    // Record optimistic intent so a piecemeal Realtime resync keeps this toggle.
    pendingRef.current.set(labelId, !wasAssigned);

    if (!wasAssigned) {
      applyOptimistic(labelId, true); // instant check
      try {
        await persist(labelId, false, false);
      } finally {
        pendingRef.current.delete(labelId);
      }
      return;
    }

    // Uncheck: move the UI immediately, THEN check for an attached workflow.
    // The check is a server round-trip and must NOT block the visual toggle
    // (this was the "slow to uncheck" bug).
    applyOptimistic(labelId, false);
    let hasActiveWorkflow = false;
    let templateName: string | undefined;
    try {
      const check = await checkLabelAutoRuleWorkflow(taskId, labelId, ideaId);
      hasActiveWorkflow = check.hasActiveWorkflow;
      templateName = check.templateName;
    } catch {
      // Check failed — fall through to a plain removal.
    }

    if (hasActiveWorkflow) {
      // Label is already removed from the UI; the dialog only decides whether to
      // ALSO remove the workflow (or to Cancel, which re-adds the label). Keep
      // the pending intent until a dialog handler settles it.
      setConfirmRemove({ labelId, templateName });
      return; // server removal deferred to the dialog handlers
    }

    try {
      await persist(labelId, true, false);
    } finally {
      pendingRef.current.delete(labelId);
    }
  }

  // "Remove workflow" — label already removed from UI; persist removal + workflow.
  function handleConfirmRemoveWorkflow() {
    if (!confirmRemove) return;
    const { labelId } = confirmRemove;
    resolvingRef.current = true;
    void persist(labelId, true, true).finally(() => pendingRef.current.delete(labelId));
  }

  // "Keep workflow" — label already removed from UI; persist removal only.
  function handleCancelRemoveWorkflow() {
    if (!confirmRemove) return;
    const { labelId } = confirmRemove;
    resolvingRef.current = true;
    void persist(labelId, true, false).finally(() => pendingRef.current.delete(labelId));
  }

  // "Cancel"/dismiss — the label was optimistically removed but never persisted;
  // re-add it (revert) and clear the pending intent.
  function handleAbortRemove() {
    if (!confirmRemove) return;
    applyOptimistic(confirmRemove.labelId, true);
    pendingRef.current.delete(confirmRemove.labelId);
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
          const checked = localLabelIds.has(label.id);
          return (
            // The ROW owns the toggle (single fire). Mirrors the New Task dialog:
            // a Radix Checkbox here double-fired / looped (React #185) when this
            // picker renders inside the modal task-detail Dialog.
            <div
              key={label.id}
              role="checkbox"
              tabIndex={0}
              aria-checked={checked}
              className="group flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 hover:bg-muted/50"
              onClick={() => handleToggleLabel(label.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleToggleLabel(label.id);
                }
              }}
            >
              {/* Plain check indicator — NOT a Radix Checkbox (see comment above). */}
              <span
                aria-hidden
                className={cn(
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border",
                  checked ? "border-primary bg-primary text-primary-foreground" : "border-input"
                )}
              >
                {checked && <Check className="h-3 w-3" />}
              </span>
              <span className={`h-3 w-3 shrink-0 rounded-sm ${config.swatchColor}`} />
              <span className="flex-1 text-xs font-medium">{label.name}</span>
              <button
                type="button"
                className="cursor-pointer text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  startEdit(label);
                }}
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

      <AlertDialog
        open={!!confirmRemove}
        onOpenChange={(open) => {
          if (open) return;
          // Closed. If no button handled it (e.g. Escape), treat as Cancel → revert.
          if (!resolvingRef.current) handleAbortRemove();
          resolvingRef.current = false;
          setConfirmRemove(null);
        }}
      >
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
            <AlertDialogCancel
              onClick={() => {
                resolvingRef.current = true;
                handleAbortRemove();
              }}
            >
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
