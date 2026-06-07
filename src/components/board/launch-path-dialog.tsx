"use client";

import { useEffect, useRef, useState } from "react";
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
  composeNewProjectPath,
  validateFolderName,
  looksAbsolutePath,
  parseRepoFromGithubUrl,
  writeLaunchPath,
} from "@/lib/launch-claude-code";

// File System Access API — only the folder NAME is exposed, never the absolute path.
interface DirectoryHandle {
  name: string;
}
type ShowDirectoryPicker = () => Promise<DirectoryHandle>;
function getDirectoryPicker(): ShowDirectoryPicker | null {
  if (typeof window === "undefined") return null;
  const fn = (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker;
  return typeof fn === "function" ? (fn as ShowDirectoryPicker) : null;
}

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
  /** Called with the freshly-saved state so the caller can continue the launch. */
  onSaved: (state: LaunchPathState) => void;
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
  const [parent, setParent] = useState(initial?.parent ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [error, setError] = useState<string | null>(null);

  const pathRef = useRef<HTMLInputElement>(null);
  const parentRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const picker = getDirectoryPicker();
  const repo = parseRepoFromGithubUrl(ideaGithubUrl);

  // Reset fields each time the dialog opens (pick up the latest saved state + mode).
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setMode(initialMode ?? initial?.mode ?? "existing");
      setPath(initial?.mode === "existing" ? (initial?.path ?? "") : "");
      setParent(initial?.parent ?? "");
      setName(initial?.name ?? "");
      setError(null);
    }
  }

  const willCreate = parent.trim() && name.trim() ? composeNewProjectPath(parent, name) : "";

  async function handleBrowse(target: "existing" | "parent") {
    if (!picker) return;
    try {
      const handle = await picker();
      // The browser only gives us the folder NAME (security). Pre-fill the name,
      // place the caret at the start so the user can type the absolute prefix.
      const input = target === "existing" ? pathRef.current : parentRef.current;
      if (target === "existing") {
        setPath((prev) => (prev.trim() ? prev : handle.name));
      } else {
        setParent((prev) => (prev.trim() ? prev : handle.name));
      }
      requestAnimationFrame(() => {
        input?.focus();
        input?.setSelectionRange(0, 0);
      });
    } catch {
      // User dismissed the native picker — no-op (the text field stays the source of truth).
    }
  }

  function handleSwitchToExisting() {
    // Pre-fill existing mode with the composed path the user was about to create.
    if (willCreate) setPath(willCreate);
    setMode("existing");
    setError(null);
  }

  function handleSave() {
    if (mode === "existing") {
      const trimmed = path.trim();
      if (!trimmed) {
        setError("Enter the absolute path to your project folder.");
        pathRef.current?.focus();
        return;
      }
      const state: LaunchPathState = { mode: "existing", path: trimmed };
      writeLaunchPath(ideaId, state);
      finish(state);
      return;
    }

    // Create-new mode
    const parentTrimmed = parent.trim();
    if (!parentTrimmed) {
      setError("Enter the parent folder (absolute path).");
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

  function finish(state: LaunchPathState) {
    onSaved(state);
    onOpenChange(false);
  }

  // Light-touch absolute-path warnings (warn, don't block).
  const existingNotAbsolute = mode === "existing" && path.trim() !== "" && !looksAbsolutePath(path);
  const parentNotAbsolute = mode === "new" && parent.trim() !== "" && !looksAbsolutePath(parent);

  const saveLabel =
    mode === "new"
      ? launchOnSave
        ? "Create & launch"
        : "Create"
      : launchOnSave
        ? "Save & launch"
        : "Save";

  // Auto-focus the first field on open.
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      (mode === "new" ? parentRef.current : pathRef.current)?.focus();
    });
  }, [open, mode]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === "new" ? "Start a new project" : "Local project folder"}</DialogTitle>
          <DialogDescription>
            {mode === "new"
              ? "Claude Code will create the folder on this machine when it launches."
              : "Where this idea's code lives on this machine."}
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
            <div className="flex items-stretch gap-2">
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
              {picker && (
                <Button type="button" variant="outline" onClick={() => handleBrowse("existing")}>
                  <FolderOpen className="h-4 w-4" />
                  Browse…
                </Button>
              )}
            </div>
            <p id="launch-path-help" className="text-xs text-muted-foreground">
              {picker
                ? "Pick your folder, then confirm the full path — your browser can't read the full path for security."
                : "Type or paste the absolute path (run pwd in your terminal to copy it)."}
            </p>
            {existingNotAbsolute && (
              <p className="flex items-start gap-1.5 text-xs text-amber-400">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                That doesn&apos;t look like an absolute path. Paths usually start with /, ~ or a drive letter.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="launch-parent">Parent folder (absolute path)</Label>
              <div className="flex items-stretch gap-2">
                <Input
                  id="launch-parent"
                  ref={parentRef}
                  value={parent}
                  onChange={(e) => {
                    setParent(e.target.value);
                    setError(null);
                  }}
                  placeholder="/Users/you/projects"
                  className="font-mono text-sm"
                  aria-describedby="launch-parent-help"
                  aria-invalid={parentNotAbsolute || undefined}
                />
                {picker && (
                  <Button type="button" variant="outline" onClick={() => handleBrowse("parent")}>
                    <FolderOpen className="h-4 w-4" />
                    Browse…
                  </Button>
                )}
              </div>
              <p id="launch-parent-help" className="text-xs text-muted-foreground">
                {picker
                  ? "Pick the folder it goes inside, then confirm the full path — your browser can't read the full path for security."
                  : "Type or paste the absolute parent path."}
              </p>
              {parentNotAbsolute && (
                <p className="flex items-start gap-1.5 text-xs text-amber-400">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  That doesn&apos;t look like an absolute path. Paths usually start with /, ~ or a drive letter.
                </p>
              )}
            </div>

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
              Looks like this may already exist? Use existing instead →
            </button>
          </div>
        )}

        {/* Privacy badge */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5">
            <Lock className="h-3 w-3" />
            Private to you
          </span>
          <span>Stored on this device only — never shown to other collaborators.</span>
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
          <Button onClick={handleSave}>{saveLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
