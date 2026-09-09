// In-app terminal — the Helper row's "stand-down-first" update flow (card
// cc74a067, design §3 flows A/D and §5c). Pure state machine: given the
// current phase and an event, what's the next phase — decoupled from the
// actual end-all/quiesce/download network calls, which the Helper row
// component drives (each network step just dispatches the matching event).
//
// The flow (design §1 decision 4, "Update quiescence"):
//   no live sessions  -> quiesce immediately, then download
//   live sessions     -> inline confirm ("End sessions & update") -> end-all
//                        -> quiesce -> download
// Either path converges on "quiescing" before the download ever starts, so
// the update never races a still-running helper (the whole point: drag-to-
// Applications must always succeed, no Finder "in use" dialog).

export type UpdateFlowPhase =
  | "idle"
  | "confirming"
  | "quiescing"
  | "ready"
  | "quiesce-timeout"
  | "helper-unreachable";

export type UpdateFlowState =
  | { phase: "idle" }
  | { phase: "confirming"; sessionCount: number }
  | { phase: "quiescing" }
  | { phase: "ready" }
  | { phase: "quiesce-timeout" }
  | { phase: "helper-unreachable" };

export type UpdateFlowEvent =
  | { type: "update-clicked"; sessionCount: number }
  | { type: "confirmed" }
  | { type: "cancelled" }
  | { type: "quiesce-settled" }
  | { type: "quiesce-timed-out" }
  | { type: "quiesce-undelivered" }
  | { type: "reset" };

export const INITIAL_UPDATE_FLOW_STATE: UpdateFlowState = { phase: "idle" };

/** How long to wait for the helper to confirm quiesced before falling back to
 *  the timeout copy (design §3 flow A caption: "within ~10 s"). The download
 *  still starts either way — this only swaps which notice is shown. */
export const QUIESCE_TIMEOUT_MS = 10_000;

/**
 * Advance the update flow. Pure — no I/O. The caller (the Helper row) is
 * responsible for actually calling end-all / the quiesce command / the
 * download route at the phase transitions that require it (idle->quiescing
 * with no confirm needed, confirming->quiescing after end-all, quiescing->
 * ready/quiesce-timeout once the quiesce settles or times out).
 */
export function updateFlowReducer(state: UpdateFlowState, event: UpdateFlowEvent): UpdateFlowState {
  switch (event.type) {
    case "update-clicked":
      // No sessions -> skip the confirm entirely and go straight to quiescing
      // (design flow D: "No sessions are running, so there is no confirmation
      // step"). Sessions live -> the inline confirm first (flow A).
      return event.sessionCount > 0
        ? { phase: "confirming", sessionCount: event.sessionCount }
        : { phase: "quiescing" };
    case "confirmed":
      return state.phase === "confirming" ? { phase: "quiescing" } : state;
    case "cancelled":
      return state.phase === "confirming" ? { phase: "idle" } : state;
    case "quiesce-settled":
      return state.phase === "quiescing" ? { phase: "ready" } : state;
    case "quiesce-timed-out":
      return state.phase === "quiescing" ? { phase: "quiesce-timeout" } : state;
    case "quiesce-undelivered":
      // The relay had no live helper connection to hand the quiesce command
      // to (`delivered:false`). That is NOT "the helper has quit" — Nick,
      // 6 Sep 2026 (card 3280f13c): the helper was alive on the Mac with its
      // control connection down, the flow said "the helper has closed", and
      // Finder refused the drag as "in use". Say so honestly instead.
      return state.phase === "quiescing" ? { phase: "helper-unreachable" } : state;
    case "reset":
      return INITIAL_UPDATE_FLOW_STATE;
    default:
      return state;
  }
}

// ── exact copy strings (design §5) ────────────────────────────────────────────

export const UPDATE_CONFIRM_HEADING = "Update the helper?";
export function updateConfirmBody(sessionCount: number): string {
  return `Your ${sessionCount} running session${sessionCount === 1 ? "" : "s"} will end first — Claude stops on your machine, and your files stay where they are. You can start fresh sessions as soon as the update finishes.`;
}
export const UPDATE_CONFIRM_CANCEL_LABEL = "Not now";
export const UPDATE_CONFIRM_ACCEPT_LABEL = "End sessions & update";

export const UPDATE_READY_COPY =
  "Ready to update — the helper has closed. Drag the new VibeCodes app into Applications to finish.";
export const UPDATE_QUIESCE_TIMEOUT_COPY =
  'The helper is taking a moment to close. If the install says the app is "in use", wait a few seconds and try again.';
export const UPDATE_HELPER_UNREACHABLE_COPY =
  'Couldn\'t reach the helper to close it — it may already be closed. If the install says the app is "in use", quit VibeCodes from the menu bar or Activity Monitor, then drag again.';

/** The phases the flow ends in: the download has started and one of the
 *  three notices above is showing. */
export function isUpdateFlowSettled(phase: UpdateFlowPhase): boolean {
  return phase === "ready" || phase === "quiesce-timeout" || phase === "helper-unreachable";
}

/** The notice for a settled phase. Only "ready" is good news (sky tone); the
 *  other two are warnings (amber) because the helper may still be running. */
export function settledNoticeCopy(phase: UpdateFlowPhase): string {
  if (phase === "ready") return UPDATE_READY_COPY;
  if (phase === "helper-unreachable") return UPDATE_HELPER_UNREACHABLE_COPY;
  return UPDATE_QUIESCE_TIMEOUT_COPY;
}
