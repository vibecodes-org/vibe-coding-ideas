// In-app terminal — multi-session tab-strip PURE logic (multi-session stage 2,
// docs/design-terminal-multi-session-popout.html).
//
// terminal-dock.tsx owns a small `sessions: SessionEntry[]` list (one entry per
// tab, board-scoped per the approved design's §3 recommendation) and mounts one
// `TerminalSessionView` (→ one `useTerminalSession` instance) per entry. This
// module holds every DECISION that list-management needs that can be expressed
// as a pure function over plain data, so it's unit-testable without React, a
// DOM, or a socket — mirroring how connection.ts / first-run-flow.ts keep the
// state-machine and presentation-branching logic pure and separate from the
// component that wires it to the DOM.
//
// Covers:
//   - B3  tab label derivation (task title, else `<idea slug> · <sid-short>`)
//   - B5  per-tab attention glyph/tone + the collapsed-bar worst-first summary
//   - B10 dedupe: a launch for a task that already has a LIVE tab focuses it
//         instead of minting a second session
//   - a11y: when a BACKGROUND tab's state change is worth a polite aria-live
//         announcement (never the active tab, never a no-op re-render)

import type { TerminalStatus } from "@/lib/terminal/connection";
import type { BrowserLaunchPayload } from "@/lib/terminal/launch-mode";
import type { AttachExistingPair } from "./use-terminal-session";
import { resolveSessionName } from "@/lib/terminal/resolve-session-name";

/**
 * One tab = one `useTerminalSession` instance, mounted by a dedicated
 * `TerminalSessionView` child (B2 — hooks can't be called in a loop, so each
 * entry gets its own component instance). `launchSeq` is a monotonic
 * per-entry command counter: the dock bumps it (and sets `launchPayload`)
 * every time a launch should be DELIVERED to this entry — a fresh entry is
 * created with `launchSeq: 1` so its first mount fires immediately; the
 * child's effect re-fires `actions.launchFromBus` whenever `launchSeq`
 * changes. `launchSeq === 0` marks a PRISTINE entry (mounted but never
 * launched) — the sole slot the dock reuses for the very first launch on a
 * board, exactly matching P1's single always-mounted hook.
 */
export interface SessionEntry {
  key: string;
  origin: "toolbar" | "task" | "reconnect" | "resume";
  taskId?: string;
  taskTitle?: string;
  /**
   * The user's own name for this session (card 3bf262ac, "terminal sessions
   * need names that stick") — mirrors `taskId`/`taskTitle` in every way that
   * matters: set at entry-creation time from the launch/resume/reattach
   * payload, updated OPTIMISTICALLY the instant a rename is saved (see
   * terminal-dock.tsx's `renameSession`), and read by every label call site
   * (`deriveTabLabel`) ahead of the task title. Undefined, not null, to
   * match the sibling optional fields above — `resolveSessionName` treats
   * both the same way.
   */
  displayName?: string;
  /**
   * Cross-board resume fix (bug 62e57071): the idea this entry's conversation
   * actually belongs to, resolved once at creation (`payload?.ideaId ??
   * <the dock's own ideaId prop>` — see terminal-dock.tsx's `mintAndDeliver`).
   * Always resolves to a concrete value for anything minted after this fix
   * shipped, so it's the one place terminal-session-view.tsx's ended-panel
   * Resume can read "which board does clicking Resume on THIS tab actually
   * belong to" without re-deriving it — see that file's `handleResume` and
   * terminal-dock.tsx's `handleResumeEndedSession`. Undefined only for a
   * `reconnect`-origin entry (reattach always happens already on the row's
   * own board — see `performReattach` — so there's nothing to disambiguate)
   * or an entry that predates this field.
   */
  ideaId?: string;
  createdAt: number;
  launchSeq: number;
  launchPayload: BrowserLaunchPayload | null;
  /**
   * Session entry chooser (card cbe60db5): set for a Reconnect / instant-
   * continue entry — this tab attaches directly to an ALREADY-MINTED session
   * (no mint, no launch-bus delivery, no install-first gate) via
   * `useTerminalSession`'s own `attachExisting` option (see
   * terminal-session-view.tsx). Always paired with `launchSeq: 0` and
   * `launchPayload: null` (there is nothing to "deliver" — the hook's own
   * attach-once-per-sid effect does the work) — but is NOT a reusable
   * "pristine" slot in the auto-connect sense, so `findPristineSlot` and the
   * dock's `autoConnectWhenExpanded` gate both exclude any entry with this
   * set (see the `hasAttach` field on `PristineCandidate`).
   */
  attach?: AttachExistingPair | null;
  /**
   * Common foundations F2: this is a reconnect/instant-continue entry whose
   * `attach.initialBuffer` came back null (no fresh snapshot to restore) —
   * render the dismissible amber note ("History from before you reconnected
   * isn't shown here…") instead of a silently blank terminal.
   */
  showReconnectedNoHistoryNote?: boolean;
  /**
   * Bug fix (last-tab-close auto-relaunch): `launchSeq === 0` alone used to
   * mean BOTH "genuinely never launched" (page-load pristine slot, still
   * wants the paired auto-connect below) AND "just ended my only tab"
   * (`removeEntry`'s replacement pristine entry — terminal-dock.tsx) — the
   * second case rendered the same idle screen but, being launchSeq 0 too,
   * ALSO satisfied `autoConnectWhenExpanded`, so a paired user who explicitly
   * ended their last session was auto-reconnected into a brand-new one
   * within the same render pass. Set only on that replacement entry so the
   * dock's `autoConnectWhenExpanded` expression can tell the two apart
   * without touching `launchSeq`'s existing "deliver a launch" meaning.
   */
  autoConnectSuppressed?: boolean;
}

// ── shared tone vocabulary (drives both the per-tab glyph and the collapsed
// bar's summary chips — same colours, same meaning, everywhere) ──────────────

export type TabTone = "ok" | "info" | "warn" | "err" | "mut" | "popped";

export interface TabStatusMeta {
  /** Shape-distinct glyph — never colour alone (B5 / design §2 callout 1). */
  glyph: string;
  tone: TabTone;
  /** Lowercase word for the accessible name / aria-live announcement. */
  ariaText: string;
  /** True for states a BACKGROUND tab should visually call attention to. */
  needsAttention: boolean;
}

/**
 * What a tab can DISPLAY, layered on top of the underlying session's real
 * `TerminalStatus` (multi-session stage 4, D2/D3). "popped-out" is NOT a
 * connection-machine state — connection.ts is untouched — it's a dock-tracked
 * fact ("the user popped this tab's session into its own window") that
 * OVERRIDES the tab's glyph/tone regardless of what the underlying socket is
 * currently doing (which, moments after a pop-out, is usually the relay's
 * 4001 "preempted" close — see terminal-dock.tsx's `poppedOutKeys` and
 * src/lib/terminal/popout-channel.ts). Every `TerminalStatus` is already a
 * valid `TabDisplayStatus`, so every existing caller keeps working unchanged.
 */
export type TabDisplayStatus = TerminalStatus | "popped-out";

const STATUS_META: Record<TerminalStatus, TabStatusMeta> = {
  idle: { glyph: "○", tone: "mut", ariaText: "idle", needsAttention: false },
  connecting: { glyph: "◌", tone: "info", ariaText: "connecting", needsAttention: false },
  "waiting-to-pair": { glyph: "◌", tone: "info", ariaText: "waiting to pair", needsAttention: false },
  connected: { glyph: "●", tone: "ok", ariaText: "connected", needsAttention: false },
  disconnected: { glyph: "↻", tone: "warn", ariaText: "reconnecting", needsAttention: true },
  "session-ended": { glyph: "■", tone: "mut", ariaText: "ended", needsAttention: true },
  error: { glyph: "▲", tone: "err", ariaText: "needs attention", needsAttention: true },
};

// Design §5's table: "popped out ... None — deliberate user state" — never an
// attention treatment, it's something the user chose, not something wrong.
const POPPED_OUT_META: TabStatusMeta = {
  glyph: "⧉",
  tone: "popped",
  ariaText: "popped out",
  needsAttention: false,
};

/** Per-tab glyph/tone/aria projection of a tab's display status (B5, design §5 + §10b). */
export function tabStatusMeta(status: TabDisplayStatus): TabStatusMeta {
  if (status === "popped-out") return POPPED_OUT_META;
  return STATUS_META[status] ?? STATUS_META.idle;
}

/**
 * Statuses that mean "nothing is actually running for this tab any more" — a
 * B10 dedupe match must NOT block a fresh launch against a tab in one of
 * these (retrying/relaunching a dead task session is exactly the point of
 * relaunching; only a genuinely LIVE tab should be protected from a duplicate).
 */
const SESSION_OVER: ReadonlySet<TerminalStatus> = new Set(["session-ended", "error"]);

export function isLiveTabStatus(status: TerminalStatus): boolean {
  return !SESSION_OVER.has(status);
}

// ── B3: tab label ────────────────────────────────────────────────────────────
//
// Naming rule unification (card 3bf262ac, docs/design-terminal-session-naming.html
// §1): this used to derive its own fallback (`<idea SLUG> · <sid4>`), a
// DIFFERENT shape from the session chooser's own inline derivation
// (`taskTitle → ideaTitle → sid.slice(0, 8)`) — same session, two different
// labels depending on where you looked. `deriveTabLabel` now delegates
// entirely to `resolveSessionName` (the one naming rule, in
// src/lib/terminal/resolve-session-name.ts), and every surface — this tab
// strip, the chooser's rows, and the My Sessions panel — calls it. The
// fallback shape changed too: the FULL idea title, never the slug (design
// §1's fallback-shape decision) — `ideaSlug` is gone from this interface;
// callers now pass `ideaTitle` directly.

export interface TabLabelInput {
  /** The user's own name for this session, if set — highest precedence (card 3bf262ac). */
  displayName?: string | null;
  /** Set only for a task-scoped launch (LaunchClaudeCodeButton task variants). */
  taskTitle?: string | null;
  /** The idea/board's title — used only to build the fallback shape when there's no user name or task title. */
  ideaTitle?: string | null;
  /** The minted session id, once known (null before mint completes). */
  sessionId: string | null;
}

/**
 * Resolves a tab's label via the one shared naming rule (B3, design §1):
 * user name → task title → `<idea title> · <sid4>` (or `Session · <sid4>`
 * with no idea title). Callers truncate the rendered label with CSS
 * ellipsis and use the full string (or this same string, for board-level
 * tabs) as the tooltip/title attribute.
 */
export function deriveTabLabel(input: TabLabelInput): string {
  return resolveSessionName({
    displayName: input.displayName,
    taskTitle: input.taskTitle,
    ideaTitle: input.ideaTitle,
    sessionId: input.sessionId,
  });
}

// ── first-launch reuse: the pristine slot ───────────────────────────────────

export interface PristineCandidate {
  key: string;
  launchSeq: number;
  /**
   * Session entry chooser (card cbe60db5): true for a Reconnect / instant-
   * continue entry (`SessionEntry.attach` set). Such an entry has
   * `launchSeq === 0` too (nothing was ever "delivered" to it) but is NOT a
   * reusable pristine slot — it's already attached to a specific live
   * session, so a later fresh launch must open a genuinely new tab rather
   * than overwrite it.
   */
  hasAttach?: boolean;
}

/**
 * The dock always keeps at least one `useTerminalSession` instance mounted from
 * page load (matching P1's single always-mounted hook — see the `SessionEntry`
 * doc above). That entry is "pristine" — never yet handed a launch — for exactly
 * as long as it's the ONLY entry, its `launchSeq` is still 0, AND it isn't a
 * chooser-attach entry (`hasAttach`). The very FIRST launch on a board reuses it
 * in place (bump its `launchSeq`, attach the payload) instead of minting a
 * second, redundant idle instance; every launch after that opens a genuinely
 * new tab (B7). Returns the reusable entry's key, or null when there's nothing
 * to reuse (a second+ launch, an already-used entry, or a chooser-attach entry).
 */
export function findPristineSlot(sessions: PristineCandidate[]): string | null {
  if (sessions.length !== 1) return null;
  const [only] = sessions;
  return only.launchSeq === 0 && !only.hasAttach ? only.key : null;
}

// ── ended-tab reclaim: resume takes over its own dead tab in place ─────────
// Card df29b85e (field report 22 Aug 2026): "Resuming an ended terminal
// session correctly mints a NEW session (`claude --resume`), but the dock
// always opens it in a NEW tab, leaving the dead tab behind." Root cause was
// that `mintAndDeliver` only ever had two outcomes — reuse the single
// PRISTINE slot (`findPristineSlot` above, which an ended tab can never be:
// its `launchSeq` is never 0) or append a brand-new `SessionEntry`. This is
// the third outcome: when a resume names the sid of a tab that's sitting
// right here, already ended, take THAT tab over instead of opening a
// sibling next to its own corpse.

export interface ReclaimCandidate {
  key: string;
  status: TerminalStatus;
  /** The session id this tab last reported, or null before one's known. */
  sessionId: string | null;
  /**
   * True for a tab the user has popped into its own window. A popped-out
   * tab's OWN `status` is untrustworthy the moment the pop-out happens (the
   * relay's 4001 "preempted" close usually lands as "error"/"session-ended"
   * even though the session is very much alive, just running in the other
   * window — see terminal-dock.tsx's `poppedOutKeys` and the identical
   * `poppedOutKeys.has(key) || isLiveTabStatus(status)` guard in
   * `requestClose`) — reclaiming it here would tear down a live xterm
   * instance, socket and scrollback out from under the user, so it's
   * excluded regardless of what `status` says.
   */
  poppedOut: boolean;
}

/**
 * Is there a tab here safe for a resume to take over IN PLACE, rather than
 * opening a new one? Only ever reclaims the ONE tab that's the actual
 * originator of this resume — `targetSessionId` must be given (the resuming
 * session's own sid, always known at every call site: the registry row's
 * `sid`, or the ended panel's own `pair.sessionId`) and must match a
 * candidate's `sessionId` exactly. No `targetSessionId` means "don't guess"
 * — always append (same conservative default as `findPristineSlot` returning
 * null for anything but the single obvious case). A `targetSessionId` that
 * matches nothing local (the tab that ended isn't open on THIS board/tab
 * strip right now) also falls through to append — there's nothing to
 * reclaim, not a bug.
 */
export function findReclaimableEndedSlot(
  candidates: ReclaimCandidate[],
  targetSessionId?: string | null,
): string | null {
  if (!targetSessionId) return null;
  const match = candidates.find((c) => c.sessionId === targetSessionId);
  if (!match) return null;
  if (match.poppedOut) return null;
  if (match.status !== "session-ended") return null;
  return match.key;
}

/**
 * Same in-place takeover as `findReclaimableEndedSlot`, but for "Start new
 * session" fired from a specific ended tab's own "View my other sessions"
 * link — there's no session id to match against (it's a brand-new mint, not
 * a resume of a known conversation), so this matches the tab's own `key`
 * instead. `targetKey` is the tab the link was clicked from; missing,
 * already-gone, still-live, or popped-out all fall through to append, same
 * conservative default as the sid-based version above.
 */
export function findReclaimableEndedSlotByKey(
  candidates: ReclaimCandidate[],
  targetKey?: string | null,
): string | null {
  if (!targetKey) return null;
  const match = candidates.find((c) => c.key === targetKey);
  if (!match) return null;
  if (match.poppedOut) return null;
  if (match.status !== "session-ended") return null;
  return match.key;
}

// ── B10: dedupe a task-scoped launch against existing tabs ─────────────────

export interface DedupeCandidate {
  key: string;
  taskId?: string;
  status: TerminalStatus;
}

export type LaunchDedupeDecision = { action: "focus"; key: string } | { action: "open" };

/**
 * A launch (toolbar or task-menu) for a task that already has a LIVE tab must
 * focus that tab instead of minting a second session or delivering the
 * payload (B10). Only a REAL task identity is keyed on — board-level launches
 * (no taskId) always open, and cwd/prompt equivalence is deliberately never
 * treated as a match (two board-level launches for the same idea are allowed
 * to be two independent sessions).
 */
export function decideTaskLaunch(
  sessions: DedupeCandidate[],
  taskId: string | undefined,
): LaunchDedupeDecision {
  if (!taskId) return { action: "open" };
  const existing = sessions.find((s) => s.taskId === taskId && isLiveTabStatus(s.status));
  return existing ? { action: "focus", key: existing.key } : { action: "open" };
}

// ── B5: collapsed-bar worst-first status summary ────────────────────────────

export interface StatusSummaryChip {
  tone: TabTone;
  glyph: string;
  count: number;
  /** e.g. "2 connected" */
  label: string;
}

type SummaryCategory = "error" | "disconnected" | "connecting" | "idle" | "ended" | "popped" | "connected";

// Worst-first (design §6: "the first thing you read is the thing to act on").
// "popped" sits with "connected" at the calm end — a pop-out is a deliberate
// choice, never something to flag (same reasoning as POPPED_OUT_META above).
const CATEGORY_ORDER: SummaryCategory[] = [
  "error",
  "disconnected",
  "connecting",
  "idle",
  "ended",
  "popped",
  "connected",
];

const CATEGORY_META: Record<SummaryCategory, { tone: TabTone; glyph: string; word: string }> = {
  error: { tone: "err", glyph: "▲", word: "needs attention" },
  disconnected: { tone: "warn", glyph: "↻", word: "reconnecting" },
  connecting: { tone: "info", glyph: "◌", word: "connecting" },
  idle: { tone: "mut", glyph: "○", word: "idle" },
  ended: { tone: "mut", glyph: "■", word: "ended" },
  popped: { tone: "popped", glyph: "⧉", word: "popped out" },
  connected: { tone: "ok", glyph: "●", word: "connected" },
};

function categoryOf(status: TabDisplayStatus): SummaryCategory {
  switch (status) {
    case "popped-out":
      return "popped";
    case "error":
      return "error";
    case "disconnected":
      return "disconnected";
    case "connecting":
    case "waiting-to-pair":
      return "connecting";
    case "session-ended":
      return "ended";
    case "connected":
      return "connected";
    case "idle":
    default:
      return "idle";
  }
}

/**
 * Worst-first count-by-state summary for the COLLAPSED dock bar (B5, design
 * §6) — e.g. "2 connected · 1 reconnecting". Only categories that exist appear
 * (all-healthy collapses to a single "N connected" chip). Callers with exactly
 * one session should keep today's single-session pill copy instead of this
 * summary (per the stage brief: "single session keeps today's copy"). Callers
 * pass a tab's DISPLAY status (terminal-dock.tsx substitutes "popped-out" for
 * any tab in its `poppedOutKeys`) so a preempted-by-design 4001 close never
 * misreads as "needs attention" in the summary.
 */
export function summarizeSessionStatuses(statuses: TabDisplayStatus[]): StatusSummaryChip[] {
  const counts = new Map<SummaryCategory, number>();
  for (const status of statuses) {
    const cat = categoryOf(status);
    counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }
  const chips: StatusSummaryChip[] = [];
  for (const cat of CATEGORY_ORDER) {
    const count = counts.get(cat) ?? 0;
    if (count === 0) continue;
    const meta = CATEGORY_META[cat];
    chips.push({ tone: meta.tone, glyph: meta.glyph, count, label: `${count} ${meta.word}` });
  }
  return chips;
}

// ── a11y: aria-live announcements for BACKGROUND tab state changes ─────────

/**
 * Only announce a background tab's own transition INTO an attention state —
 * never the active tab (its state is already visible on screen, a live
 * region would just double-speak it) and never a no-op re-render (guards
 * against `prevStatus === nextStatus` re-firing on every unrelated update).
 * `prevStatus === undefined` means "first report from a just-mounted tab" —
 * never worth announcing (it isn't a transition).
 */
export function shouldAnnounceAttention(
  prevStatus: TerminalStatus | undefined,
  nextStatus: TerminalStatus,
  isActiveTab: boolean,
): boolean {
  if (isActiveTab) return false;
  if (prevStatus === undefined || prevStatus === nextStatus) return false;
  return tabStatusMeta(nextStatus).needsAttention;
}

/** e.g. `Terminal "Fix login": reconnecting` — one shared announcer string shape. */
export function formatAttentionAnnouncement(label: string, status: TerminalStatus): string {
  return `Terminal "${label}": ${tabStatusMeta(status).ariaText}`;
}
