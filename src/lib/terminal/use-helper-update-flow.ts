"use client";

// In-app terminal — the effectful half of the "stand-down-first" update flow
// (card cc74a067, design §3 flows A/D). `helper-update-flow.ts` owns the pure
// phase reducer + copy; this hook owns the actual network calls at each
// transition (end any live sessions, send the `quiesce` command, poll
// `/api/terminal/helper/status` until the helper disconnects or
// QUIESCE_TIMEOUT_MS elapses, then download) so every "Update now" button
// drives the EXACT same sequence instead of one re-implementing (or
// skipping) it.
//
// Extracted from `terminal-my-sessions-panel.tsx` (the only safe
// implementation) so `terminal-session-chooser.tsx`'s "Update now" — which
// used to be a bare `<a href>` straight to the download, no quiesce at all —
// can share it too. Nick's binding instruction: "both buttons need to stop
// the old version first."
//
// Either outcome of quiescing (settled or timed out) starts the download
// regardless (design: the whole point is drag-to-Applications always
// succeeds because nothing is running by then) — see the "ready" /
// "quiesce-timeout" effect below.

import { useCallback, useEffect, useState } from "react";
import {
  INITIAL_UPDATE_FLOW_STATE,
  QUIESCE_TIMEOUT_MS,
  updateFlowReducer,
  type UpdateFlowPhase,
  type UpdateFlowState,
} from "./helper-update-flow";
import { TERMINAL_HELPER_DOWNLOAD_URL } from "./platform";
import type { HelperStatus } from "./helper-row";

export interface UseHelperUpdateFlowOptions {
  /** The caller's current live-session count (across all of the user's
   *  ideas) — read whenever "Update now" is clicked, to decide confirm-first
   *  vs straight-to-quiescing (see `updateFlowReducer`'s `update-clicked`),
   *  and again once quiescing starts, to decide whether there's anything to
   *  end first. */
  sessionCount: number;
  /** Fires once, right as quiescing begins (before ending sessions / sending
   *  the quiesce command). The My sessions panel uses this to mark the
   *  resulting disconnect as deliberate so it isn't mis-recorded as an
   *  "idle-quit" (see helper-relaunch-signal.ts) — optional, since callers
   *  without that bookkeeping (the chooser) have nothing to do here. */
  onQuiesceStart?: () => void;
  /** Fires once quiescing has settled (or timed out), right before the
   *  download navigation — callers use this to refresh their own
   *  session-list / helper-status view so it reflects the now-quiesced
   *  helper. */
  onSettled?: () => void;
}

export interface UseHelperUpdateFlowResult {
  phase: UpdateFlowPhase;
  /** Only meaningful while `phase === "confirming"` — the live-session count
   *  that will end if the user confirms. */
  confirmSessionCount: number;
  /** "Update now" was clicked. */
  start: () => void;
  /** The inline confirm's "End sessions & update". */
  confirm: () => void;
  /** The inline confirm's "Not now". */
  cancel: () => void;
  /** Clears a lingering "ready"/"quiesce-timeout" notice — a no-op from any
   *  other phase. For callers whose own state (and this hook's) outlives a
   *  single open/close cycle of the surface that shows it (the My sessions
   *  panel's popover), so a stale notice doesn't linger forever once
   *  reopened. */
  resetIfSettled: () => void;
}

/**
 * Drives the shared quiesce-then-download flow described above. Both
 * `TerminalMySessionsPanel` and `TerminalSessionChooser` call this from
 * their "Update now" button so the old helper is always stood down before
 * the new DMG downloads.
 */
export function useHelperUpdateFlow({
  sessionCount,
  onQuiesceStart,
  onSettled,
}: UseHelperUpdateFlowOptions): UseHelperUpdateFlowResult {
  const [state, setState] = useState<UpdateFlowState>(INITIAL_UPDATE_FLOW_STATE);

  const start = useCallback(() => {
    setState((s) => updateFlowReducer(s, { type: "update-clicked", sessionCount }));
  }, [sessionCount]);
  const confirm = useCallback(() => {
    setState((s) => updateFlowReducer(s, { type: "confirmed" }));
  }, []);
  const cancel = useCallback(() => {
    setState((s) => updateFlowReducer(s, { type: "cancelled" }));
  }, []);
  const resetIfSettled = useCallback(() => {
    setState((s) => (s.phase === "ready" || s.phase === "quiesce-timeout" ? INITIAL_UPDATE_FLOW_STATE : s));
  }, []);

  // Drive the "quiescing" phase: end any live sessions first (only reached
  // via "confirming" when sessions existed), send the quiesce command, then
  // poll helper status until it reports not-connected or QUIESCE_TIMEOUT_MS
  // elapses (design §3 flow A's fallback notice) — the download starts
  // regardless (§3 flow A caption), just with a different notice.
  useEffect(() => {
    if (state.phase !== "quiescing") return;
    let cancelled = false;
    onQuiesceStart?.();
    const hadSessions = sessionCount > 0;
    (async () => {
      if (hadSessions) {
        try {
          await fetch("/api/terminal/session/end", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ all: true }),
          });
        } catch {
          /* best effort — the quiesce command below still proceeds */
        }
      }
      try {
        await fetch("/api/terminal/helper/command", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cmd: "quiesce" }),
        });
      } catch {
        /* best effort — the poll below still resolves via timeout */
      }

      const deadline = Date.now() + QUIESCE_TIMEOUT_MS;
      while (!cancelled) {
        let settled = false;
        try {
          const res = await fetch("/api/terminal/helper/status");
          if (res.ok) {
            const status = (await res.json()) as HelperStatus;
            settled = status.connected === false;
          }
        } catch {
          /* transient — keep polling until the deadline */
        }
        if (cancelled) return;
        if (settled) {
          setState((s) => updateFlowReducer(s, { type: "quiesce-settled" }));
          return;
        }
        if (Date.now() >= deadline) {
          setState((s) => updateFlowReducer(s, { type: "quiesce-timed-out" }));
          return;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, sessionCount]);

  // Either outcome of quiescing starts the download (design: the whole point
  // is drag-to-Applications always succeeds because nothing is running by
  // now) and lets the caller refresh whatever it shows for the now-quiesced
  // helper.
  useEffect(() => {
    if (state.phase !== "ready" && state.phase !== "quiesce-timeout") return;
    window.location.assign(TERMINAL_HELPER_DOWNLOAD_URL);
    onSettled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]);

  return {
    phase: state.phase,
    confirmSessionCount: state.phase === "confirming" ? state.sessionCount : 0,
    start,
    confirm,
    cancel,
    resetIfSettled,
  };
}
