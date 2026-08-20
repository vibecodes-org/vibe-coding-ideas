"use client";

// In-app terminal — the shared inline rename control (card 3bf262ac,
// docs/design-terminal-session-naming.html §3b/§3c, §4). Powers the My
// Sessions row and the session chooser's row (both live and Recent/ended) —
// the row footprint and edit-mode contents-swap are identical on both
// surfaces per the design. The dock tab strip has its OWN hand-rolled
// version (terminal-dock.tsx) reusing the tab's shipped "End session?"
// contents-swap instead of this component — a fixed-width tab has no room
// for this component's visible "Name" label, and the tab strip's
// integration with the tab-key navigation/close-confirm state doesn't map
// cleanly onto a standalone component. Both implementations follow the same
// spec: Enter saves, Escape cancels, blur saves, blank clears to the
// auto-name, and the rename input never exchanges keystrokes with anything
// else on the page (design §6's hard PTY-isolation rule — irrelevant here
// since rows never touch a PTY, but kept for consistency).
//
// Edit-mode spec (design §4):
//   - Prefill: the user's own name if one exists, fully selected. Empty
//     otherwise, with the CURRENT resolved name as the placeholder — so
//     clearing the field previews exactly what returns.
//   - Save: Enter, the check button, or blur (Notion/Linear convention —
//     losing typed work on blur is the worse failure).
//   - Cancel: Escape or the cross button — discards, no network call.
//   - The editor closes IMMEDIATELY on save attempt (optimistic; "no spinner
//     on the label" — design §4 Busy state). The caller (`onSave`) owns the
//     actual persistence, the optimistic apply to whatever list it renders
//     from, and reverting + toasting on failure — this component never
//     awaits the result.
//   - A no-change save (including "still blank") is a silent close, no
//     `onSave` call at all.

import { useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DISPLAY_NAME_COUNTER_THRESHOLD,
  DISPLAY_NAME_MAX_CODE_POINTS,
  clampToCodePoints,
  codePointLength,
} from "@/lib/terminal/display-name";

export interface SessionRenameFieldProps {
  /** The session's CURRENT resolved name (user name, else task title, else the auto fallback) — shown as the pencil's accessible name and as the editor's placeholder. */
  resolvedName: string;
  /** The user's own name, if any — prefilled/selected on entry. Null/undefined means "no user name yet"; the field starts empty. */
  userName?: string | null;
  /**
   * Fires once, synchronously with the save attempt, with the NEW value to
   * persist (`null` means "clear back to the auto-name"). Never called for a
   * no-op save. The caller is responsible for the network call, optimistic
   * UI, and failure handling (revert + toast with retry) — this component
   * has already closed its editor by the time this fires.
   */
  onSave: (next: string | null) => void;
  /** Extra classes on the resting pencil button (e.g. to match a surface's icon-button sizing). */
  className?: string;
  /**
   * Fires whenever edit mode opens/closes — a row surface uses this to hide
   * its OTHER actions (Reconnect/End, Resume) while editing (design: "one
   * job at a time"). Optional; omit for a surface that has no sibling
   * actions to hide (or in tests that only care about the field itself).
   */
  onEditingChange?: (editing: boolean) => void;
}

export function SessionRenameField({ resolvedName, userName, onSave, className, onEditingChange }: SessionRenameFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editing) return;
    const el = inputRef.current;
    el?.focus();
    el?.select();
  }, [editing]);

  const setEditingAndNotify = (next: boolean) => {
    setEditing(next);
    onEditingChange?.(next);
  };

  const openEditor = () => {
    setDraft(userName?.trim() ?? "");
    setEditingAndNotify(true);
  };

  const cancel = () => setEditingAndNotify(false);

  const commit = () => {
    const trimmed = draft.trim();
    const current = userName?.trim() ?? "";
    setEditingAndNotify(false);
    if (trimmed === current) return; // no real change — silent close, no network call
    onSave(trimmed ? trimmed : null);
  };

  if (!editing) {
    return (
      <button
        type="button"
        className={cn(
          "flex h-6 w-6 flex-none items-center justify-center rounded text-zinc-500 hover:bg-zinc-700 hover:text-zinc-200",
          className,
        )}
        aria-label={`Rename session: ${resolvedName}`}
        onClick={openEditor}
      >
        <Pencil className="h-3 w-3" />
      </button>
    );
  }

  const length = codePointLength(draft);

  return (
    <div className="flex flex-1 items-center gap-2" data-testid="session-rename-editor">
      <span className="flex-none text-[11px] font-semibold text-zinc-500">Name</span>
      <input
        ref={inputRef}
        type="text"
        dir="auto"
        value={draft}
        placeholder={resolvedName}
        aria-label="Session name"
        onChange={(e) => setDraft(clampToCodePoints(e.target.value, DISPLAY_NAME_MAX_CODE_POINTS))}
        onKeyDown={(e) => {
          // Never let a rename keystroke reach anything else on the page
          // (design §6) — most relevant for Enter, which must never be
          // interpreted by an ancestor as "activate the row's primary
          // button" the way it would for a plain click target.
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        onKeyUp={(e) => e.stopPropagation()}
        onBlur={commit}
        className="min-w-0 flex-1 rounded border border-sky-500 bg-zinc-900 px-2 py-1 text-[13px] text-zinc-100 outline-none ring-2 ring-sky-500/20"
      />
      {length >= DISPLAY_NAME_COUNTER_THRESHOLD && (
        <span className="flex-none font-mono text-[10px] text-amber-400" aria-hidden="true">
          {length}/{DISPLAY_NAME_MAX_CODE_POINTS}
        </span>
      )}
      {/* mousedown+preventDefault on both buttons: without it, the click's
          own focus change fires blur (which already saves/would-be-cancel)
          BEFORE the click handler runs, so Cancel would save-then-discard
          instead of just discarding. */}
      <button
        type="button"
        aria-label="Save name"
        onMouseDown={(e) => e.preventDefault()}
        onClick={commit}
        className="flex h-5 w-5 flex-none items-center justify-center rounded text-emerald-400 hover:bg-emerald-500/15"
      >
        ✓
      </button>
      <button
        type="button"
        aria-label="Cancel"
        onMouseDown={(e) => e.preventDefault()}
        onClick={cancel}
        className="flex h-5 w-5 flex-none items-center justify-center rounded text-zinc-400 hover:bg-zinc-700"
      >
        ✕
      </button>
    </div>
  );
}
