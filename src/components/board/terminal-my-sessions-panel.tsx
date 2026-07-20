"use client";

// In-app terminal — the global "My sessions" panel (multi-session stage 3,
// design §9). A popover (not a modal — it must never block the board) opened
// from the dock's "My sessions" button. Lists EVERY active session across ALL
// of the user's ideas, newest first, each with an End button (no confirm —
// design §9a: "per-session End uses no confirm, single/visible/reversible").
// The footer's "End all sessions" is the panic button and DOES confirm
// inline (binding note) before calling the same end route with `{ all: true }`.
//
// Fetch-on-open + refresh-after-action (no realtime, per the stage brief).

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { usePostHog } from "posthog-js/react";
import { Loader2, Power, Terminal as TerminalIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { slugifyIdeaTitle } from "@/lib/launch-claude-code";
import { formatSessionAge, formatSessionIdentity } from "@/lib/terminal/session-registry";
import { deriveTabLabel } from "./terminal-tabs";

interface ListedSession {
  sid: string;
  ideaId: string;
  ideaTitle: string | null;
  taskId: string | null;
  taskTitle: string | null;
  machineLabel: string | null;
  cwd: string | null;
  createdAt: string;
}

type LoadState = "idle" | "loading" | "ready" | "error";

interface TerminalMySessionsPanelProps {
  /** Fires whenever the panel's session count is known/changes, so the dock's badge stays in sync. */
  onCountChange?: (count: number) => void;
  /** Imperative open control — the cap-refusal toast's action opens this panel (design §7b). */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

export function TerminalMySessionsPanel({
  onCountChange,
  open,
  onOpenChange,
  children,
}: TerminalMySessionsPanelProps) {
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [sessions, setSessions] = useState<ListedSession[]>([]);
  const [endingSid, setEndingSid] = useState<string | null>(null);
  const [confirmingEndAll, setConfirmingEndAll] = useState(false);
  const [endingAll, setEndingAll] = useState(false);
  const posthog = usePostHog();

  const load = useCallback(async () => {
    setLoadState((s) => (s === "idle" ? "loading" : s));
    try {
      const res = await fetch("/api/terminal/session/list");
      if (!res.ok) throw new Error(`Failed to load sessions (${res.status})`);
      const body = (await res.json()) as { sessions: ListedSession[] };
      setSessions(body.sessions);
      onCountChange?.(body.sessions.length);
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }, [onCountChange]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const endOne = useCallback(
    async (sid: string) => {
      setEndingSid(sid);
      try {
        await fetch("/api/terminal/session/end", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sid }),
        });
      } catch {
        toast.error("Couldn't end that session — try again.");
      } finally {
        setEndingSid(null);
        void load();
      }
    },
    [load],
  );

  const endAll = useCallback(async () => {
    setEndingAll(true);
    posthog?.capture("terminal_end_all_used", { count: sessions.length });
    try {
      await fetch("/api/terminal/session/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
    } catch {
      toast.error("Couldn't end all sessions — try again.");
    } finally {
      setEndingAll(false);
      setConfirmingEndAll(false);
      void load();
    }
  }, [load, posthog, sessions.length]);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0" aria-label="My terminal sessions">
        <div className="flex items-center gap-2 border-b border-zinc-800 px-3.5 py-2.5 text-[13px] font-bold text-zinc-200">
          My sessions
          <span className="ml-auto text-[11.5px] font-normal text-zinc-500">runs on your machines</span>
        </div>

        {loadState === "loading" && (
          <div className="flex items-center justify-center gap-2 px-4 py-8 text-[12.5px] text-zinc-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
          </div>
        )}

        {loadState === "error" && (
          <div className="flex flex-col items-center gap-2 px-4 py-6 text-center text-[12.5px] text-zinc-400">
            Couldn&apos;t load your sessions.
            <Button variant="outline" size="xs" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        )}

        {loadState === "ready" && sessions.length === 0 && (
          <div className="flex flex-col items-center gap-1 px-4 py-8 text-center">
            <TerminalIcon className="h-5 w-5 text-zinc-600" />
            <p className="text-[13px] font-semibold text-zinc-300">No terminals running.</p>
            <p className="max-w-[240px] text-[12px] text-zinc-500">
              Launch one from an idea board — Launch Claude Code → In the browser.
            </p>
          </div>
        )}

        {loadState === "ready" && sessions.length > 0 && (
          <ul className="max-h-80 overflow-y-auto">
            {sessions.map((s) => {
              const ideaSlug = slugifyIdeaTitle(s.ideaTitle ?? "");
              const label = deriveTabLabel({
                taskTitle: s.taskTitle,
                ideaSlug,
                sessionId: s.sid,
              });
              const identity = formatSessionIdentity({
                machineLabel: s.machineLabel,
                cwd: s.cwd,
                sid: s.sid,
              });
              const ending = endingSid === s.sid;
              return (
                <li key={s.sid} className="flex items-center gap-2.5 border-t border-zinc-800 px-3.5 py-2.5 first:border-t-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 truncate text-[13px] font-semibold text-zinc-100">
                      <span className="truncate">{label}</span>
                      {s.ideaTitle && (
                        <span className="flex-none truncate text-[11.5px] font-normal text-zinc-500">
                          {s.ideaTitle}
                        </span>
                      )}
                    </div>
                    <div className="truncate font-mono text-[11px] text-zinc-500">{identity}</div>
                  </div>
                  <span className="flex-none text-[11.5px] text-zinc-500">{formatSessionAge(s.createdAt)}</span>
                  <Button
                    variant="outline"
                    size="xs"
                    className="flex-none border-rose-500/45 bg-transparent text-rose-400 hover:bg-rose-500/10"
                    disabled={ending}
                    onClick={() => void endOne(s.sid)}
                    aria-label={`End session: ${label}`}
                  >
                    {ending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Power className="h-3 w-3" />} End
                  </Button>
                </li>
              );
            })}
          </ul>
        )}

        {loadState === "ready" && sessions.length > 0 && (
          <div
            className={cn(
              "flex items-center gap-2.5 border-t border-zinc-800 px-3.5 py-2.5",
              confirmingEndAll && "border-l-2 border-l-rose-500 bg-rose-500/5",
            )}
          >
            {confirmingEndAll ? (
              <>
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-bold text-rose-400">End all {sessions.length} sessions?</div>
                  <div className="text-[11px] text-zinc-500">
                    Claude stops on your machine in every one. Unpushed worktree changes stay on disk.
                  </div>
                </div>
                <Button variant="ghost" size="xs" onClick={() => setConfirmingEndAll(false)} disabled={endingAll}>
                  Cancel
                </Button>
                <Button
                  size="xs"
                  className="flex-none bg-rose-500 text-rose-950 hover:bg-rose-400"
                  onClick={() => void endAll()}
                  disabled={endingAll}
                >
                  {endingAll ? <Loader2 className="h-3 w-3 animate-spin" /> : <Power className="h-3 w-3" />} End all
                </Button>
              </>
            ) : (
              <>
                <span className="text-[11.5px] text-zinc-500">{sessions.length} sessions</span>
                <Button
                  variant="outline"
                  size="xs"
                  className="ml-auto flex-none border-rose-500/45 bg-transparent text-rose-400 hover:bg-rose-500/10"
                  onClick={() => setConfirmingEndAll(true)}
                >
                  <Power className="h-3 w-3" /> End all sessions
                </Button>
              </>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
