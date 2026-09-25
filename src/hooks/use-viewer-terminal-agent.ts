"use client";

// Codex support (docs/codex-terminal-requirements.md FR-4a/US-8, implementation
// slice 2) — mirrors use-viewer-terminal-model.ts EXACTLY: a module-level cache
// fetched once per session and shared across every mounted consumer (the
// chooser's picker, the Ready panel, the per-task launch dialog), rather than
// one fetch per mount.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  getTerminalAgent,
  updateTerminalAgent,
  getTerminalAgentToastSeen,
  markTerminalAgentToastSeen,
} from "@/actions/profile";
import { normalizeAgent, type LaunchAgent } from "@/lib/terminal/agent-launch";
import { AGENT_LABEL } from "@/lib/terminal/agent-copy";

// `undefined` = not yet fetched. Unlike the model override (which can be
// legitimately null), the remembered agent always resolves to a concrete
// value server-side (default 'claude') — so once fetched this is never null.
let cachedAgent: LaunchAgent | undefined;
let inFlight: Promise<LaunchAgent> | null = null;
const listeners = new Set<(agent: LaunchAgent) => void>();

function fetchOnce(): Promise<LaunchAgent> {
  if (!inFlight) {
    inFlight = getTerminalAgent()
      .then((agent) => {
        cachedAgent = agent;
        return agent;
      })
      .catch(() => {
        cachedAgent = "claude";
        return "claude" as LaunchAgent;
      });
  }
  return inFlight;
}

/**
 * Update every already-mounted consumer's cache immediately after a
 * successful write (picker selection, "Start with Claude Code instead") —
 * mirrors setViewerTerminalModelCache().
 */
export function setViewerTerminalAgentCache(agent: LaunchAgent): void {
  cachedAgent = agent;
  listeners.forEach((listener) => listener(agent));
}

/**
 * The current viewer's remembered terminal agent pick, fetched once and
 * shared across every mounted consumer. Returns undefined while loading —
 * callers should default their picker to "claude" (never show a wrong
 * steady state) until this resolves, then snap to the real value.
 */
export function useViewerTerminalAgent(): LaunchAgent | undefined {
  const [agent, setAgent] = useState<LaunchAgent | undefined>(cachedAgent);

  useEffect(() => {
    let cancelled = false;
    const listener = (a: LaunchAgent) => {
      if (!cancelled) setAgent(a);
    };
    listeners.add(listener);

    if (cachedAgent === undefined) {
      fetchOnce().then((a) => {
        if (!cancelled) setAgent(a);
      });
    }

    return () => {
      cancelled = true;
      listeners.delete(listener);
    };
  }, []);

  return agent;
}

/**
 * Where a remembered-agent write came from (docs/launch-button-remembered-
 * agent-option-a-spec.html §3, precedence rules 3–4):
 *  - "picker"  — a browser chooser "Run it with" or per-task "Start fresh
 *    with" toggle (the default — mirrors every call site that predates this
 *    param). ONLY source that can trigger the one-time Undo toast.
 *  - "footer"  — the launch button menu's "Switch to …" link. Never toasts.
 *  - "undo"    — the toast's own Undo action reverting a picker write.
 *    Never toasts (rule: "no second toast").
 */
export type PersistAgentSource = "picker" | "footer" | "undo";

/**
 * Persist a new remembered pick and update the shared cache — the one write
 * path every picker (chooser, Ready panel, task dialog), the menu footer's
 * "Switch to …" link, and every "Start with Claude Code instead" fallback
 * should call through, so a write from any surface is reflected everywhere
 * else instantly. Best-effort: an error is thrown to the caller (toast it),
 * but the cache is only updated on success — never optimistically, since a
 * failed write must not lie about what's actually remembered server-side.
 *
 * The one-time "your launch button now starts X" Undo toast lives HERE, not
 * duplicated in every picker's component, so every current and future
 * picker gets it automatically just by calling this function with the
 * default source. It fires only when: the source is "picker" (not "footer"
 * or "undo"), the write actually changed the value (a same-value write is a
 * no-op for the toast even though it still round-trips the server call),
 * and the account hasn't seen it yet (users.terminal_agent_toast_seen_at is
 * NULL — checked server-side so it's correct across browsers/devices).
 * Fully best-effort and non-blocking: any failure checking or setting the
 * seen flag just skips the toast silently — a picker write must never be
 * blocked or delayed by it (callers already fire-and-forget this promise).
 */
export async function persistViewerTerminalAgent(
  agent: LaunchAgent,
  options: { source?: PersistAgentSource } = {}
): Promise<LaunchAgent> {
  const source = options.source ?? "picker";
  const previous = cachedAgent;
  const saved = await updateTerminalAgent(normalizeAgent(agent));
  setViewerTerminalAgentCache(saved);

  if (source === "picker" && previous !== undefined && previous !== saved) {
    void maybeShowAgentSwitchToast(previous, saved);
  }

  return saved;
}

async function maybeShowAgentSwitchToast(previous: LaunchAgent, next: LaunchAgent): Promise<void> {
  try {
    const alreadySeen = await getTerminalAgentToastSeen();
    if (alreadySeen) return;
    // Set BEFORE (well, alongside) showing it — "set as soon as the toast is
    // shown, regardless of whether Undo is clicked" (spec §3).
    await markTerminalAgentToastSeen();
    toast(`Your launch button now starts ${AGENT_LABEL[next]}. Change it any time from the button's menu.`, {
      duration: 8000,
      action: {
        label: "Undo",
        onClick: () => {
          void persistViewerTerminalAgent(previous, { source: "undo" }).catch(() => {});
        },
      },
    });
  } catch {
    // Best-effort — never re-throw into a fire-and-forget picker write.
  }
}
