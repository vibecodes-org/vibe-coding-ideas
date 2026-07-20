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
  origin: "toolbar" | "task";
  taskId?: string;
  taskTitle?: string;
  createdAt: number;
  launchSeq: number;
  launchPayload: BrowserLaunchPayload | null;
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

export interface TabLabelInput {
  /** Set only for a task-scoped launch (LaunchClaudeCodeButton task variants). */
  taskTitle?: string | null;
  /** Slugified idea title (see slugifyIdeaTitle) — used when NOT task-scoped. */
  ideaSlug: string;
  /** The minted session id, once known (null before mint completes). */
  sessionId: string | null;
}

const SID_SHORT_LEN = 4;

/**
 * Task title when the launch was task-scoped, else `<idea slug> · <sid-short>`
 * (B3, design §2 callout 2 / §4). Callers truncate the rendered label with CSS
 * ellipsis and use the full title (or this same string, for board-level tabs)
 * as the tooltip/title attribute.
 */
export function deriveTabLabel(input: TabLabelInput): string {
  const title = input.taskTitle?.trim();
  if (title) return title;
  const sid = input.sessionId ? input.sessionId.slice(0, SID_SHORT_LEN) : "…";
  return `${input.ideaSlug} · ${sid}`;
}

// ── first-launch reuse: the pristine slot ───────────────────────────────────

export interface PristineCandidate {
  key: string;
  launchSeq: number;
}

/**
 * The dock always keeps at least one `useTerminalSession` instance mounted from
 * page load (matching P1's single always-mounted hook — see the `SessionEntry`
 * doc above). That entry is "pristine" — never yet handed a launch — for exactly
 * as long as it's the ONLY entry and its `launchSeq` is still 0. The very FIRST
 * launch on a board reuses it in place (bump its `launchSeq`, attach the
 * payload) instead of minting a second, redundant idle instance; every launch
 * after that opens a genuinely new tab (B7). Returns the reusable entry's key,
 * or null when there's nothing to reuse (a second+ launch, or the single entry
 * has already been used).
 */
export function findPristineSlot(sessions: PristineCandidate[]): string | null {
  if (sessions.length !== 1) return null;
  const [only] = sessions;
  return only.launchSeq === 0 ? only.key : null;
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
