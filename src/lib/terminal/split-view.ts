// In-app terminal — split view PURE logic (task df7a0134,
// docs/design-terminal-split-view.html). Builds on the Requirements/UX
// Design/Design Review workflow steps: an opt-in 2-pane horizontal split of
// the dock body, tabs remaining the default. Every DECISION this feature
// needs that can be expressed as a pure function over plain data lives here
// — mirroring how terminal-tabs.ts keeps label/dedupe/status-glyph decisions
// out of terminal-dock.tsx. Covers:
//
//   - pane eligibility (a popped-out session can never claim a pane — shipped
//     invariant) and pane ASSIGNMENT (active tab + most-recently-active other
//     eligible session; a 3rd tab click replaces the UNFOCUSED pane and takes
//     focus — design §7 Q1)
//   - width-floor fallback with hysteresis (design §7 Q3: 480px/pane, split
//     needs a dock body ≥961px, restores at ≥981px) and an explicit mobile-
//     viewport gate (Design Review required change 3 — AC14 must not rely only
//     on the width floor being incidentally true on a phone)
//   - the drag-to-dock gesture's zone/threshold decisions (design §6): an 8px
//     activation distance, and — per the Design Review's required change 1 —
//     NO tab reordering: a drag that begins and ends within the tab strip
//     cancels, except a PANED tab's drag-to-strip, which keeps its designed
//     "leave split" meaning
//   - the focus-move keyboard chord (design §5.4: Ctrl+Shift+←/→, absolute)
//   - persistence of the split-on/off preference (dock-height.ts's
//     never-throw, localStorage contract)
//   - accessible-name / live-region announcement strings (design §8)
//
// Font metrics the 480px floor is derived from live in
// src/components/board/use-terminal-session.ts (Design Review required
// change 4 — the design doc's own citation was wrong).

// ── pane assignment ─────────────────────────────────────────────────────────

export type PaneSide = "left" | "right";

export interface PaneAssignment {
  left: string | null;
  right: string | null;
}

/** A session as far as pane eligibility is concerned. */
export interface EligibleCandidate {
  key: string;
  /** Popped-out sessions never claim a pane (shipped invariant) — excluded. */
  poppedOut: boolean;
}

/** Keys eligible for a pane, in their given (tab-strip) order. Ended sessions stay eligible — only pop-out excludes. */
export function eligiblePaneKeys(sessions: EligibleCandidate[]): string[] {
  return sessions.filter((s) => !s.poppedOut).map((s) => s.key);
}

/**
 * Pick a replacement session for an empty pane slot: most-recently-active
 * eligible key first (excluding whatever's already in the OTHER slot),
 * falling back to the first eligible key in strip order. `recency` is
 * most-recent-first. Returns `null` when nothing is left to offer.
 */
function pickReplacement(eligibleKeys: string[], recency: string[], exclude: string | null): string | null {
  const recentPick = recency.find((k) => k !== exclude && eligibleKeys.includes(k));
  if (recentPick) return recentPick;
  return eligibleKeys.find((k) => k !== exclude) ?? null;
}

/**
 * The assignment split view enters WITH (toggle-on, or a fresh docking drag
 * from tabbed mode): left = the active tab (if still eligible), right = the
 * most-recently-active OTHER eligible session (design §7 Q1 / §5.1).
 */
export function enterSplitAssignment(activeKey: string, eligibleKeys: string[], recency: string[]): PaneAssignment {
  const left = eligibleKeys.includes(activeKey) ? activeKey : pickReplacement(eligibleKeys, recency, null);
  const right = pickReplacement(eligibleKeys, recency, left);
  return { left, right };
}

/**
 * Keep an existing assignment valid as `sessions`/pop-out state change (a
 * pane's session popped out, closed, or a 3rd eligible session appeared to
 * backfill an empty slot) — design §5.5/§5.6/AC16: split auto-resumes when a
 * 2nd eligible session becomes available again, without the user acting.
 * Never reassigns a slot that's still valid, so it never steals focus from a
 * pane that's still showing the same session.
 */
export function reconcileSplitAssignment(
  current: PaneAssignment,
  eligibleKeys: string[],
  recency: string[],
): PaneAssignment {
  let left = current.left && eligibleKeys.includes(current.left) ? current.left : null;
  let right = current.right && eligibleKeys.includes(current.right) && current.right !== left ? current.right : null;
  if (!left) left = pickReplacement(eligibleKeys, recency, right);
  if (!right) right = pickReplacement(eligibleKeys, recency, left);
  return { left, right };
}

/**
 * A tab click while split (design §5.2). Clicking the focused pane's own tab
 * is a no-op; clicking the unfocused pane's tab just moves focus to it;
 * clicking a 3rd session's tab replaces the UNFOCUSED pane's content and
 * takes focus there — a tab click has always meant "attend to this one",
 * and the unfocused slot is the only one that can change without yanking
 * the pane the user is actively typing into.
 */
export function applyTabClickToSplit(
  current: PaneAssignment,
  focusedSide: PaneSide,
  clickedKey: string,
): { assignment: PaneAssignment; focusedSide: PaneSide } {
  if (current.left === clickedKey) return { assignment: current, focusedSide: "left" };
  if (current.right === clickedKey) return { assignment: current, focusedSide: "right" };
  const targetSide: PaneSide = focusedSide === "left" ? "right" : "left";
  const assignment: PaneAssignment =
    targetSide === "left" ? { ...current, left: clickedKey } : { ...current, right: clickedKey };
  return { assignment, focusedSide: targetSide };
}

/**
 * A drag-to-dock drop on an explicit half (design §6.3). Unlike a tab click,
 * the user chose the side directly, so this may replace EITHER pane —
 * including the focused one. `fallbackOtherKey` seeds the other side when
 * entering split fresh from tabbed mode (the MRA other eligible session).
 */
export function applyDropToSplit(
  current: PaneAssignment,
  side: PaneSide,
  droppedKey: string,
  fallbackOtherKey: string | null,
): { assignment: PaneAssignment; focusedSide: PaneSide } {
  const other: PaneSide = side === "left" ? "right" : "left";
  const otherCurrent = current[other] && current[other] !== droppedKey ? current[other] : null;
  const filledOther = otherCurrent ?? (fallbackOtherKey !== droppedKey ? fallbackOtherKey : null);
  const assignment: PaneAssignment =
    side === "left" ? { left: droppedKey, right: filledOther } : { left: filledOther, right: droppedKey };
  return { assignment, focusedSide: side };
}

// ── width floor (design §7 Q3 / §5.8) ───────────────────────────────────────

/** 60 columns at the shipped 12.5px mono metrics (use-terminal-session.ts) + padding/border. */
export const MIN_PANE_WIDTH_PX = 480;
/** Two panes + a 1px divider — below this, tabs render instead. */
export const SPLIT_FALLBACK_BODY_PX = 961;
/** 20px hysteresis band so a window hovering at the boundary doesn't flap. */
export const SPLIT_RESTORE_BODY_PX = 981;

/**
 * Next "below floor" state given a freshly-measured dock body width, with
 * hysteresis: once below, only restore at the higher `SPLIT_RESTORE_BODY_PX`
 * threshold. An unmeasured/invalid width (0, NaN — not yet laid out) leaves
 * the prior state untouched rather than flapping to a guess.
 */
export function resolveWidthFloor(bodyWidthPx: number, wasBelowFloor: boolean): boolean {
  if (!Number.isFinite(bodyWidthPx) || bodyWidthPx <= 0) return wasBelowFloor;
  return wasBelowFloor ? bodyWidthPx < SPLIT_RESTORE_BODY_PX : bodyWidthPx < SPLIT_FALLBACK_BODY_PX;
}

// ── mobile gate (Design Review required change 3 / AC14) ──────────────────

/**
 * Tailwind's `md` breakpoint (768px) is the project's own mobile/desktop
 * line elsewhere in this feature (tab strip host/session-id text, etc.) —
 * reused here so "mobile" means the same thing everywhere. The 961px width
 * floor above would almost always cover this anyway on a real phone, but
 * Design Review's required change 3 asks for an EXPLICIT, name-checkable
 * rule rather than a coincidence of the two numbers.
 */
export const MOBILE_VIEWPORT_MAX_PX = 767;

export function isMobileViewport(viewportWidthPx: number): boolean {
  return Number.isFinite(viewportWidthPx) && viewportWidthPx > 0 && viewportWidthPx <= MOBILE_VIEWPORT_MAX_PX;
}

/** Whether split view may actually render right now, folding every gate together. */
export function isSplitRenderable(input: {
  preferred: boolean;
  eligibleCount: number;
  belowWidthFloor: boolean;
  mobileViewport: boolean;
}): boolean {
  return input.preferred && input.eligibleCount >= 2 && !input.belowWidthFloor && !input.mobileViewport;
}

// ── persistence (dock-height.ts's never-throw, clamp-on-read contract) ────

export const SPLIT_VIEW_PREFERENCE_KEY = "vc:term:split-view";

function defaultStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The stored preference, or `false` when nothing valid was written (or storage throws) — tabs is always the safe default. */
export function readSplitViewPreference(storage: Storage | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(SPLIT_VIEW_PREFERENCE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Best-effort write — a failed write (quota, privacy mode) just means the next load defaults to tabs, never a crash. */
export function writeSplitViewPreference(enabled: boolean, storage: Storage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    if (enabled) storage.setItem(SPLIT_VIEW_PREFERENCE_KEY, "1");
    else storage.removeItem(SPLIT_VIEW_PREFERENCE_KEY);
  } catch {
    /* best-effort only */
  }
}

// ── keyboard chord (design §5.4) ───────────────────────────────────────────

/**
 * Ctrl+Shift+←/→ — absolute (names the destination pane, not a toggle), so
 * it's idempotent and never needs debouncing against itself. Every closer
 * chord collides with the browser, macOS, readline, tmux or Claude Code's own
 * keys per the Design Review's collision audit; this one is clear on all of
 * them. Callers intercept it via xterm's `attachCustomKeyEventHandler`
 * (returning `false` so it never reaches the PTY) AND a dock-level keydown
 * for when DOM focus sits on pane chrome rather than the xterm itself.
 */
export function matchFocusMoveChord(e: {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}): PaneSide | null {
  if (!e.ctrlKey || !e.shiftKey || e.altKey || e.metaKey) return null;
  if (e.key === "ArrowLeft" || e.key === "Left") return "left";
  if (e.key === "ArrowRight" || e.key === "Right") return "right";
  return null;
}

// ── drag-to-dock gesture geometry (design §6, Design Review required change 1) ──

/** dnd-kit's own MouseSensor activation constraint mirrors this — kept here too so the pure decision is testable without dnd-kit. */
export const DRAG_ACTIVATION_DISTANCE_PX = 8;
/** How far below the strip's bottom edge the pointer must go before the drag counts as "in the dock body" — avoids flicker right at the boundary. */
export const STRIP_GRACE_MARGIN_PX = 8;

export type DropZone = "strip" | "left" | "right" | "none";

/**
 * Which zone the pointer is currently over, from raw geometry — no DOM
 * reads, so it's testable with plain numbers. `pointerY <= stripBottom +
 * grace` is "still over the tab strip" (design §6.1's "gesture undecided
 * until it crosses down"); outside the dock body's horizontal bounds is
 * "none" (release-outside cancels, same as Escape).
 */
export function classifyDropZone(input: {
  pointerX: number;
  pointerY: number;
  stripBottom: number;
  bodyLeft: number;
  bodyWidth: number;
}): DropZone {
  if (input.pointerY <= input.stripBottom + STRIP_GRACE_MARGIN_PX) return "strip";
  if (input.bodyWidth <= 0) return "none";
  const relativeX = input.pointerX - input.bodyLeft;
  if (relativeX < 0 || relativeX > input.bodyWidth) return "none";
  return relativeX < input.bodyWidth / 2 ? "left" : "right";
}

export type DragDropOutcome = { kind: "cancel" } | { kind: "leave-split" } | { kind: "dock"; side: PaneSide };

/**
 * Design Review required change 1: tab REORDERING is cut — a drag that
 * begins and ends within the strip changes nothing, full stop, UNLESS the
 * dragged tab was already paned, in which case releasing it back on the
 * strip keeps its designed "leave split" meaning (the return path, §6.3).
 * Releasing outside the dock entirely also cancels (`"none"`, same as
 * pressing Escape mid-drag).
 */
export function resolveDragOutcome(zone: DropZone, isDraggedTabPaned: boolean): DragDropOutcome {
  if (zone === "none") return { kind: "cancel" };
  if (zone === "strip") return isDraggedTabPaned ? { kind: "leave-split" } : { kind: "cancel" };
  return { kind: "dock", side: zone };
}

// ── accessible names + live-region announcements (design §8) ───────────────

/** The words half of the focus-clarity signal — never colour alone (Requirements §4 / Design Review §2). */
export function paneFocusWord(focused: boolean): string {
  return focused ? "Typing here" : "Watching";
}

/** A pane's full accessible name — resolves so the a11y tree can never report two "typing" panes (it derives from one caller-supplied `focused` flag). */
export function paneAccessibleName(label: string, focused: boolean): string {
  return `${label} — ${focused ? "typing here" : "watching"}`;
}

export function formatFocusMoveAnnouncement(label: string): string {
  return `Typing now goes to ${label}`;
}

export function formatSplitOnAnnouncement(leftLabel: string, rightLabel: string, focusedLabel: string): string {
  return `Split view on. ${leftLabel} left, ${rightLabel} right. Typing goes to ${focusedLabel}.`;
}

export function formatSplitOffAnnouncement(remainingLabel: string): string {
  return `Split view off. Showing ${remainingLabel}.`;
}

export function formatWidthFloorAnnouncement(kind: "fallback" | "restored"): string {
  return kind === "fallback"
    ? "Window too narrow for split view — showing tabs. Split returns when wider."
    : "Split view restored.";
}

export function formatDockAnnouncement(label: string, side: PaneSide): string {
  return `Split view on. ${label} docked ${side}. Typing goes to ${label}.`;
}

export function formatLeaveSplitAnnouncement(label: string): string {
  return `Split view off. Showing ${label}.`;
}
