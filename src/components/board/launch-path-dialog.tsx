"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { FolderOpen, FolderPlus, Lock, GitBranch, AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  type LaunchMode,
  type LaunchPathState,
  type RecordedProjectPath,
  composeNewProjectPath,
  validateFolderName,
  looksAbsolutePath,
  isValidAbsolutePath,
  parseRepoFromGithubUrl,
  writeLaunchPath,
  DEFAULT_NEW_PROJECT_PARENT,
} from "@/lib/launch-claude-code";
import { saveManualProjectPath } from "@/actions/launch-path";
import { getMachineIdentity } from "@/lib/terminal/machine-identity";

interface LaunchPathDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ideaId: string;
  ideaGithubUrl: string | null;
  /** Pre-fill from the saved state (path + last-used mode). */
  initial: LaunchPathState | null;
  /** Which mode to open in (overrides the saved mode — e.g. "Start a new project…"). */
  initialMode?: LaunchMode;
  /** When true the primary CTA continues the launch after saving. */
  launchOnSave?: boolean;
  /**
   * Called with the freshly-saved state so the caller can continue the launch.
   * For an existing-mode save, `recordedPath` is the server row that was just
   * written (see `saveManualProjectPath`) so the caller can reflect it
   * immediately without waiting on a fresh server read.
   */
  onSaved: (state: LaunchPathState, recordedPath?: RecordedProjectPath) => void;
}

export function LaunchPathDialog({
  open,
  onOpenChange,
  ideaId,
  ideaGithubUrl,
  initial,
  initialMode,
  launchOnSave = false,
  onSaved,
}: LaunchPathDialogProps) {
  const [mode, setMode] = useState<LaunchMode>(initialMode ?? initial?.mode ?? "existing");
  const [path, setPath] = useState(initial?.mode === "existing" ? (initial?.path ?? "") : "");
  const [parent, setParent] = useState(initial?.parent ?? DEFAULT_NEW_PROJECT_PARENT);
  const [name, setName] = useState(initial?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  // Existing-mode Save now round-trips to the server (idea_project_paths) —
  // see saveManualProjectPath. Guards a double-submit and disables the CTA
  // while the write is in flight.
  const [saving, setSaving] = useState(false);

  const pathRef = useRef<HTMLInputElement>(null);
  const parentRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const repo = parseRepoFromGithubUrl(ideaGithubUrl);

  // Reset fields each time the dialog opens (pick up the latest saved state + mode).
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setMode(initialMode ?? initial?.mode ?? "existing");
      setPath(initial?.mode === "existing" ? (initial?.path ?? "") : "");
      setParent(initial?.parent ?? DEFAULT_NEW_PROJECT_PARENT);
      setName(initial?.name ?? "");
      setError(null);
    }
  }

  const willCreate = parent.trim() && name.trim() ? composeNewProjectPath(parent, name) : "";

  function handleSwitchToExisting() {
    if (willCreate) setPath(willCreate);
    setMode("existing");
    setError(null);
  }

  async function handleSave() {
    if (mode === "existing") {
      const trimmed = path.trim();
      if (!trimmed) {
        setError("Enter the absolute path to your project folder.");
        pathRef.current?.focus();
        return;
      }
      // Block (not just warn) on non-expanded paths: ~, $HOME and relative paths
      // don't expand in the launch deep link's cwd, so they'd silently fail.
      if (!isValidAbsolutePath(trimmed)) {
        setError(
          "Enter a fully-expanded absolute path — ~ and $HOME aren't supported. Run pwd in the folder to get it.",
        );
        pathRef.current?.focus();
        return;
      }
      // Existing-mode folders are now recorded server-side (idea_project_paths)
      // instead of localStorage — this is what makes the pin persist across
      // browsers, and what retires the two-independent-stores bug the pin used
      // to cause (see resolveEffectiveLaunchTarget). Pass this browser's real
      // machine hostname (if a terminal session has ever announced one) so the
      // row lands under it rather than the MANUAL_PIN_HOSTNAME fallback — see
      // saveManualProjectPath's doc.
      const state: LaunchPathState = { mode: "existing", path: trimmed };
      setSaving(true);
      const result = await saveManualProjectPath(ideaId, trimmed, getMachineIdentity());
      setSaving(false);
      if (!result.ok) {
        toast.error("Couldn't save the project folder — try again");
        return;
      }
      finish(state, result.recorded);
      return;
    }

    // Create-new mode — no server-side folder exists yet to record, so this
    // still lives in localStorage (the one job the browser store keeps).
    const parentTrimmed = parent.trim();
    if (!parentTrimmed) {
      setError("Enter where to create the project (a parent folder).");
      parentRef.current?.focus();
      return;
    }
    const nameCheck = validateFolderName(name);
    if (!nameCheck.valid) {
      setError(nameCheck.message ?? "Name the new folder.");
      nameRef.current?.focus();
      return;
    }
    const composed = composeNewProjectPath(parentTrimmed, name);
    const state: LaunchPathState = {
      mode: "new",
      path: composed,
      parent: parentTrimmed,
      name: name.trim(),
    };
    writeLaunchPath(ideaId, state);
    finish(state);
  }

  function finish(state: LaunchPathState, recordedPath?: RecordedProjectPath) {
    onSaved(state, recordedPath);
    onOpenChange(false);
  }

  // Existing-mode path must be a fully-expanded absolute path (Save is blocked
  // otherwise) — `~`/`$HOME`/relative don't expand in the launch cwd. The parent
  // folder for a NEW project is only warned on (the agent expands it on create).
  const existingNotAbsolute = mode === "existing" && path.trim() !== "" && !isValidAbsolutePath(path);
  const parentNotAbsolute = mode === "new" && parent.trim() !== "" && !looksAbsolutePath(parent);

  const saveLabel = saving
    ? "Saving…"
    : mode === "new"
      ? launchOnSave
        ? "Create & launch"
        : "Create"
      : launchOnSave
        ? "Save & launch"
        : "Save";

  // Auto-focus the most relevant field on open (the name for new projects).
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      (mode === "new" ? nameRef.current : pathRef.current)?.focus();
    });
  }, [open, mode]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === "new" ? "Start a new project" : "Set the project folder"}</DialogTitle>
          <DialogDescription>
            {mode === "new"
              ? "Claude Code creates the folder on this machine when it launches."
              : "Point Claude Code at an existing folder on this machine. Only needed when this idea has no GitHub repo to open automatically."}
          </DialogDescription>
        </DialogHeader>

        {/* Mode toggle — radiogroup styled as a segmented control */}
        <RadioGroup
          value={mode}
          onValueChange={(v) => {
            setMode(v as LaunchMode);
            setError(null);
          }}
          aria-label="Project mode"
          className="grid grid-cols-2 gap-1 rounded-lg border bg-muted p-1"
        >
          <label
            className={`flex cursor-pointer items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-medium transition-colors ${
              mode === "existing" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
            }`}
          >
            <RadioGroupItem value="existing" className="sr-only" />
            <FolderOpen className="h-3.5 w-3.5" />
            Use existing folder
          </label>
          <label
            className={`flex cursor-pointer items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-medium transition-colors ${
              mode === "new" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
            }`}
          >
            <RadioGroupItem value="new" className="sr-only" />
            <FolderPlus className="h-3.5 w-3.5" />
            Create new project
          </label>
        </RadioGroup>

        {mode === "existing" ? (
          <div className="space-y-2">
            <Label htmlFor="launch-path">Absolute path on your computer</Label>
            <Input
              id="launch-path"
              ref={pathRef}
              value={path}
              onChange={(e) => {
                setPath(e.target.value);
                setError(null);
              }}
              placeholder="/Users/you/projects/my-idea"
              className="font-mono text-sm"
              aria-describedby="launch-path-help"
              aria-invalid={existingNotAbsolute || undefined}
            />
            <p id="launch-path-help" className="text-xs text-muted-foreground">
              Tip: in your terminal, <code className="font-mono">cd</code> to the folder and run{" "}
              <code className="font-mono">pwd</code> — that prints the exact path to paste here.
            </p>
            {existingNotAbsolute && (
              <p className="flex items-start gap-1.5 text-xs text-amber-400">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Enter a fully-expanded absolute path (starting with / or a drive letter). ~ and $HOME
                aren&apos;t supported — run <code className="font-mono">pwd</code> in the folder to get it.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="launch-name">New folder name</Label>
              <Input
                id="launch-name"
                ref={nameRef}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setError(null);
                }}
                placeholder="my-idea"
                className="font-mono text-sm"
                aria-describedby="launch-name-help"
              />
              <p id="launch-name-help" className="text-xs text-muted-foreground">
                Letters, numbers, - and _. No slashes or spaces.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="launch-parent">Create it inside</Label>
              <Input
                id="launch-parent"
                ref={parentRef}
                value={parent}
                onChange={(e) => {
                  setParent(e.target.value);
                  setError(null);
                }}
                placeholder={DEFAULT_NEW_PROJECT_PARENT}
                className="font-mono text-sm"
                aria-describedby="launch-parent-help"
                aria-invalid={parentNotAbsolute || undefined}
              />
              <p id="launch-parent-help" className="text-xs text-muted-foreground">
                Where to create it — <code className="font-mono">~</code> is your home folder. The default works for
                most people.
              </p>
              {parentNotAbsolute && (
                <p className="flex items-start gap-1.5 text-xs text-amber-400">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  That doesn&apos;t look like an absolute path. Paths usually start with /, ~ or a drive letter.
                </p>
              )}
            </div>

            {/* Live "Will create" preview */}
            <div className="rounded-md border border-dashed p-3">
              <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Will create</p>
              <code className="block break-all font-mono text-xs" aria-live="polite">
                {willCreate || "—"}
              </code>
            </div>

            {/* Repo status row */}
            <div className="flex items-start gap-2 text-xs">
              <GitBranch
                className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${repo ? "text-emerald-400" : "text-muted-foreground"}`}
              />
              <span className="text-muted-foreground">
                {repo ? (
                  <>
                    Repo detected — Claude Code will <code className="font-mono">git clone</code> {repo} into the new
                    folder.
                  </>
                ) : (
                  <>
                    No repo on this idea — Claude Code will run <code className="font-mono">git init</code> instead.
                  </>
                )}
              </span>
            </div>

            <button
              type="button"
              onClick={handleSwitchToExisting}
              className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Already have a folder for this? Use existing instead →
            </button>
          </div>
        )}

        {/* Privacy badge */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5">
            <Lock className="h-3 w-3" />
            Private to you
          </span>
          <span>
            {mode === "existing"
              ? "Saved to your account — follows you between browsers, never shown to other collaborators."
              : "Stored on this device only — never shown to other collaborators."}
          </span>
        </div>

        {error && (
          <p className="flex items-start gap-1.5 text-xs text-amber-400" role="alert">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saveLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
