// Session-to-session messages (card f0a13bde): when a message may be typed
// into a Claude session, and when it must wait. Pure, so the whole table can
// be tested without a terminal.
//
// The hazard this exists for: Claude asks "run this command? yes/no" in the
// middle of a turn, and a typed Enter or digit would answer it. So the rules
// are, in order:
//   - A message is typed (pasted, then Enter) only when Claude is known to be
//     idle AND the person has no unsent text in that session.
//   - Anything else is held. At the end of Claude's turn the Stop hook hands
//     the held messages over directly (a "block" answer with the text as the
//     reason), so nothing is typed at all. A permission prompt only appears
//     mid-turn, so a held message never meets one.
//   - A held message is dropped after 30 minutes; at most 20 are held.
//
// Phases:
//   unknown  nothing heard from Claude yet (it may be idle at a fresh prompt,
//            but we can't tell). Treated as busy.
//   busy     a turn is running (UserPromptSubmit, a tool call, a tool result).
//   asking   a permission prompt is open. Never typed into.
//   idle     the turn ended (Stop). The "waiting for you" notice (idle_prompt)
//            only turns unknown into idle; it never overrides busy or asking,
//            because it can arrive late, while a prompt or turn is live.
//   typing   a message is being pasted and submitted right now. Every other
//            message waits until that one is finished.

import { PEER_HOLD_MAX_COUNT, PEER_HOLD_MAX_MS } from "../../shared/peer-message.mjs";

/** @typedef {{ phase: "unknown"|"busy"|"asking"|"idle"|"typing", draft: boolean, inbox: Array<{ id: string, text: string, at: number }> }} PeerState */

/** @returns {PeerState} */
export function createPeerState() {
  return { phase: "unknown", draft: false, inbox: [] };
}

/**
 * Would these keystroke bytes leave unsent text in Claude's input box?
 * Escape sequences (arrows, focus, mouse reports) don't count; a lone Ctrl-C
 * or Ctrl-U clears the box.
 * @param {string} bytes
 * @returns {"draft" | "clear" | "none"}
 */
export function classifyInput(bytes) {
  if (typeof bytes !== "string" || bytes.length === 0) return "none";
  const stripped = bytes
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;?<>]*[ -/]*[@-~]/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/\x1bO./g, "");
  // eslint-disable-next-line no-control-regex
  if (/[^\x00-\x1f\x7f]/.test(stripped)) return "draft";
  if (stripped.includes("\x03") || stripped.includes("\x15")) return "clear";
  return "none";
}

function prune(state, now) {
  const dropped = [];
  const kept = [];
  for (const m of state.inbox) {
    if (now - m.at > PEER_HOLD_MAX_MS) dropped.push(m.id);
    else kept.push(m);
  }
  return { state: dropped.length ? { ...state, inbox: kept } : state, dropped };
}

/**
 * Keystrokes from the person's browser.
 * @param {PeerState} state @param {string} bytes
 */
export function onInput(state, bytes) {
  const kind = classifyInput(bytes);
  if (kind === "draft" && !state.draft) return { ...state, draft: true };
  if (kind === "clear" && state.draft) return { ...state, draft: false };
  return state;
}

/**
 * A hook event from Claude.
 * @param {PeerState} state
 * @param {{ name: string, notification?: string, stopHookActive?: boolean }} ev
 * @param {number} now
 * @returns {{ state: PeerState, block: string[] | null, dropped: string[] }} `block`: the held message texts to hand over, or null
 */
export function onHook(state, ev, now) {
  let { state: s, dropped } = prune(state, now);
  switch (ev.name) {
    case "UserPromptSubmit":
      return { state: { ...s, phase: "busy", draft: false }, block: null, dropped };
    case "PreToolUse":
    case "PostToolUse":
      // A tool call after a permission prompt means the prompt was answered.
      return { state: { ...s, phase: "busy" }, block: null, dropped };
    case "PermissionRequest":
      return { state: { ...s, phase: "asking" }, block: null, dropped };
    case "Notification":
      if (ev.notification === "permission_prompt") return { state: { ...s, phase: "asking" }, block: null, dropped };
      if (ev.notification === "idle_prompt") {
        return { state: s.phase === "unknown" ? { ...s, phase: "idle" } : s, block: null, dropped };
      }
      return { state: s, block: null, dropped };
    case "Stop": {
      if (s.inbox.length > 0) {
        // Hand everything over and let Claude carry on; it is busy again.
        return { state: { ...s, phase: "busy", inbox: [] }, block: s.inbox.map((m) => m.text), dropped };
      }
      return { state: { ...s, phase: "idle" }, block: null, dropped };
    }
    default:
      return { state: s, block: null, dropped };
  }
}

/**
 * A verified message has arrived.
 * @param {PeerState} state @param {{ id: string, text: string }} msg @param {number} now
 * @returns {{ state: PeerState, decision: "type-now" | "hold" | "full", dropped: string[] }}
 */
export function onMessage(state, msg, now) {
  const { state: s, dropped } = prune(state, now);
  if (s.phase === "idle" && !s.draft) return { state: { ...s, phase: "typing" }, decision: "type-now", dropped };
  if (s.inbox.length >= PEER_HOLD_MAX_COUNT) return { state: s, decision: "full", dropped };
  return { state: { ...s, inbox: [...s.inbox, { id: msg.id, text: msg.text, at: now }] }, decision: "hold", dropped };
}

/** Timer tick: drop what has waited too long. */
export function onTick(state, now) {
  return prune(state, now);
}

/**
 * Right after pasting: is it still safe to press Enter? Only while this
 * message still owns the "typing" phase: any hook event since (a turn
 * starting, a tool call, a prompt opening, a turn ending) moves the phase on,
 * and the person's own typing sets the draft flag.
 * @param {PeerState} state
 */
export function safeToSubmit(state) {
  return state.phase === "typing" && !state.draft;
}

/**
 * Typing is over. If Enter was pressed and Claude took the message, a hook
 * event has already moved the phase on and nothing changes. Otherwise the
 * phase is still "typing": go back to unknown (held until Claude's next Stop),
 * and if the text was pasted but not submitted it is sitting in the input box,
 * so count it as a draft and type nothing on top of it.
 * @param {PeerState} state @param {{ pasted: boolean, submitted: boolean }} r
 */
export function endTyping(state, r) {
  if (state.phase !== "typing") return r.pasted && !r.submitted ? { ...state, draft: true } : state;
  return { ...state, phase: "unknown", draft: state.draft || (r.pasted && !r.submitted) };
}

/** The reason text a Stop hook hands to Claude for the held messages. */
export function joinHeld(texts) {
  return texts.join("\n\n");
}
