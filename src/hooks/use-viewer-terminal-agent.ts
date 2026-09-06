"use client";

// Codex support (docs/codex-terminal-requirements.md FR-4a/US-8, implementation
// slice 2) — mirrors use-viewer-terminal-model.ts EXACTLY: a module-level cache
// fetched once per session and shared across every mounted consumer (the
// chooser's picker, the Ready panel, the per-task launch dialog), rather than
// one fetch per mount.

import { useEffect, useState } from "react";
import { getTerminalAgent, updateTerminalAgent } from "@/actions/profile";
import { normalizeAgent, type LaunchAgent } from "@/lib/terminal/agent-launch";

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
 * Persist a new remembered pick and update the shared cache — the one write
 * path every picker (chooser, Ready panel, task dialog) and every "Start
 * with Claude Code instead" fallback should call through, so a write from
 * any surface is reflected everywhere else instantly. Best-effort: an error
 * is thrown to the caller (toast it), but the cache is only updated on
 * success — never optimistically, since a failed write must not lie about
 * what's actually remembered server-side.
 */
export async function persistViewerTerminalAgent(agent: LaunchAgent): Promise<LaunchAgent> {
  const saved = await updateTerminalAgent(normalizeAgent(agent));
  setViewerTerminalAgentCache(saved);
  return saved;
}
