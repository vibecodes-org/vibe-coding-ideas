"use client";

// In-app local Claude Code terminal — the board bottom dock (browser leg).
//
// Renders the collapsible VS Code-style terminal dock and wires it to the opaque
// Cloudflare relay as the `browser` leg:
//
//   POST /api/terminal/session  →  { sessionId, browserToken, bridgeToken }
//   WebSocket  <relay>/?session&role=browser&token  →  xterm.js
//
// MULTI-SESSION (stage 2, docs/design-terminal-multi-session-popout.html): the
// dock now manages an ORDERED LIST of session tabs, board-scoped (this idea
// only — the approved OQ2 recommendation; a global "My sessions" list is stage
// 3). One always-mounted `useTerminalSession` instance backs each tab, via the
// per-tab `TerminalSessionView` (terminal-session-view.tsx) — this file owns
// only the DOCK CHROME shared across tabs: the collapsed bar (single-session
// pill, or a worst-first status summary across tabs — B5), the tab strip
// (VS Code convention — status glyph, label, × close, "+" — B1/B3), launch-bus
// routing into either a NEW tab or a focus-existing dedupe (B7/B10), and the
// dock-wide `expanded` open/close state.
//
// SESSIONS MODEL (B2/B4): `sessions: SessionEntry[]` (terminal-tabs.ts) is the
// list of tabs. EVERY entry renders its own `TerminalSessionView`, ALWAYS —
// never conditionally mounted/unmounted while live — so a background tab's
// socket, xterm buffer, heartbeat watchdog and grace-window reconnect loop
// keep running exactly as if it were the only tab; only the ACTIVE entry's
// panel is visually shown (CSS `hidden`, not an unmount — see that file's doc).
// The dock keeps exactly ONE entry mounted from page load (the "pristine"
// slot, `launchSeq: 0`) so a first-time/returning user sees the unchanged P1
// idle/setup/auto-connect experience with NO tab strip (the strip only
// renders once a 2nd tab exists — "single session keeps P1's existing copy").
// The very first launch on a board REUSES that pristine slot in place
// (`findPristineSlot`); every launch after that opens a genuinely new tab.
// Ending the dock's only remaining tab resets `sessions` back to a fresh
// pristine entry (B8: last-session-ended returns to the P1 idle state, no
// lingering empty strip); ending one of several tabs just removes that entry
// (its underlying session has already been torn down via `actions.end()`).
//
// ARCHITECTURE (multi-session stage 1, same design doc): everything ONE
// session needs — the connection state machine, the WebSocket browser leg,
// xterm + resize/focus, the heartbeat watchdog, the grace-window reattach
// loop, and the vibecodes:// deep-link fire — lives behind `useTerminalSession`
// (use-terminal-session.ts). The connection STATE MACHINE + close-code mapping
// + framing are pure and live in src/lib/terminal/connection.ts (UNTOUCHED);
// the OS/arch detection, the paired-flag gate, and the first-run copy are pure
// and live in src/lib/terminal/{platform,paired-flag,first-run-copy}.ts; the
// tab-strip decisions (labels, dedupe, status→glyph, collapsed summary, a11y
// announce gating) are pure and live in terminal-tabs.ts — all unit-tested.
//
// GATING: off by default. Renders nothing unless NEXT_PUBLIC_TERMINAL_ENABLED is
// exactly "true" (checked here AND at the board page mount) — B9: flag off means
// zero new UI anywhere, including the tab strip and "+".

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { ChevronUp, ChevronDown, ChevronLeft, Circle, ListTree, Loader2, Pencil, Plus, Terminal as TerminalIcon, X } from "lucide-react";
import { usePostHog } from "posthog-js/react";
import { toast } from "sonner";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDraggable,
  type DragStartEvent,
  type DragMoveEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { isTerminalEnabled, relayBaseUrl, type TerminalStatus } from "@/lib/terminal/connection";
import { subscribeBrowserLaunch, type BrowserLaunchPayload } from "@/lib/terminal/launch-mode";
import { resolveDockView } from "@/lib/terminal/first-run-flow";
import type { RecordedProjectPath } from "@/lib/launch-claude-code";
import { newSessionTooltip } from "@/lib/terminal/session-cap";
import {
  resolveEffectiveTerminalModel,
  resolveTerminalModelSource,
  terminalLaunchModelLine,
  terminalDialogModelLine,
} from "@/lib/terminal/model-resolution";
import { usePlatformTerminalModelDefault } from "@/hooks/use-platform-terminal-model-default";
import { useViewerTerminalModel } from "@/hooks/use-viewer-terminal-model";
import {
  generatePopoutNonce,
  popoutChannelName,
  openPopoutWindow,
  createDockPopoutMessageHandler,
  startBringBackRequest,
  INITIAL_DOCK_HANDSHAKE_STATE,
  type DockPopoutEntry,
  type PopoutPayload,
} from "@/lib/terminal/popout-channel";
import type { TransferredBuffer } from "@/lib/terminal/scrollback-transfer";
import {
  deriveChooserSections,
  chooserHeaderCounts,
  findTaskSessionMatch,
  liveSessionsElsewhereOnThisBoard,
  type ChooserSections,
  type ChooserRegistryRow,
  type ChooserLiveRow,
  type ChooserRecentRow,
  type TaskSessionMatch,
} from "@/lib/terminal/chooser-data";
import { decideEntryBehaviour, type EntryDecision } from "@/lib/terminal/entry-decision";
import { loadSessionSnapshot, readTabSids, toReconnectBuffer } from "@/lib/terminal/session-snapshot";
import { readDockOpen, writeDockOpen } from "@/lib/terminal/dock-open-persistence";
import {
  type PaneAssignment,
  type PaneSide,
  type DropZone,
  eligiblePaneKeys,
  enterSplitAssignment,
  applyDropToSplit,
  isMobileViewport,
  readSplitViewPreference,
  writeSplitViewPreference,
  matchFocusMoveChord,
  classifyDropZone,
  resolveDragOutcome,
  formatFocusMoveAnnouncement,
  formatSplitOnAnnouncement,
  formatSplitOffAnnouncement,
  formatWidthFloorAnnouncement,
  formatDockAnnouncement,
  formatLeaveSplitAnnouncement,
  DRAG_ACTIVATION_DISTANCE_PX,
  panesForDockCount,
  resolveWidthFloorForCount,
  isSplitRenderableForCount,
  stepPaneFocusIndex,
  formatSplitOnAnnouncementForPanes,
  formatSplitRestoredAnnouncementForPanes,
  formatThirdPaneAddedAnnouncement,
  formatForcedTabsCountAnnouncement,
  formatThirdPaneWidthBlockedAnnouncement,
  formatWidthFallbackThreeAnnouncement,
  formatForcedTabsNoticeText,
  formatPoppedOutChipAriaLabel,
} from "@/lib/terminal/split-view";
import { useDockInset } from "./terminal-dock-inset";
import { useDockHeight, TerminalDockResizeHandle } from "./terminal-dock-resize";
import { getMachineIdentity } from "@/lib/terminal/machine-identity";
import { fetchHelperStatus, type HelperStatus } from "@/lib/terminal/helper-row";
import {
  DISPLAY_NAME_COUNTER_THRESHOLD,
  DISPLAY_NAME_MAX_CODE_POINTS,
  clampToCodePoints,
  codePointLength,
} from "@/lib/terminal/display-name";
import {
  type SessionEntry,
  type TabDisplayStatus,
  type TabTone,
  tabStatusMeta,
  isLiveTabStatus,
  deriveTabLabel,
  findPristineSlot,
  findReclaimableEndedSlot,
  findReclaimableEndedSlotByKey,
  decideTaskLaunch,
  summarizeSessionStatuses,
  type DedupeCandidate,
  type ReclaimCandidate,
} from "./terminal-tabs";
import {
  TerminalSessionView,
  dockStatusMeta,
  type SessionSummary,
} from "./terminal-session-view";
import { TerminalSessionChooser } from "./terminal-session-chooser";
import { TerminalTaskLaunchChoice } from "./terminal-task-launch-choice";
import { TerminalMySessionsPanel } from "./terminal-my-sessions-panel";
import type { AttachExistingPair, TerminalSessionActions, TerminalSessionDescriptor } from "./use-terminal-session";

interface TerminalDockProps {
  ideaId: string;
  ideaTitle: string;
  /**
   * The idea's GitHub URL (or null). Needed so hook-initiated launches — paired
   * auto-connect and Retry, which never pass through the launch button — can
   * build the SAME board-level compact bootstrap prompt the button would.
   */
  ideaGithubUrl: string | null;
  /**
   * Bug cbe60db5-followup-2: absolute paths the agent recorded for this user
   * + idea (idea_project_paths, one row per machine) — the board page already
   * fetches these for KanbanBoard/LaunchClaudeCodeButton's own resolution
   * (resolveEffectiveLaunchTarget); forwarded here so every session's
   * `useTerminalSession` descriptor can resolve the SAME recorded folder for
   * its fallback (no-bus-payload) launches. Undefined/empty → unchanged
   * "new project" fallback.
   */
  recordedProjectPaths?: RecordedProjectPath[];
}

let sessionKeySeq = 0;
/** Locally-unique tab key — never sent anywhere, just a React/registry key. */
function freshSessionKey(): string {
  sessionKeySeq += 1;
  return `tab-${Date.now().toString(36)}-${sessionKeySeq}`;
}

function createPristineEntry(): SessionEntry {
  return {
    key: freshSessionKey(),
    origin: "toolbar",
    taskId: undefined,
    taskTitle: undefined,
    createdAt: Date.now(),
    launchSeq: 0,
    launchPayload: null,
  };
}

// A small dot for the collapsed bar's single-session pill.
function dotClass(status: TerminalStatus): string {
  switch (status) {
    case "connected":
      return "text-emerald-400";
    case "connecting":
    case "waiting-to-pair":
      return "text-amber-400";
    case "error":
      return "text-rose-400";
    default:
      return "text-zinc-500";
  }
}

// Bug A retry schedule (card cbe60db5) — immediate attempt, then two backoff
// retries, before `refreshRegistry` gives up and surfaces the failure.
const REGISTRY_RETRY_DELAYS_MS = [0, 400, 1200];

// Drag-to-dock (design §6): the pointer position at drag START — dnd-kit's
// DragMoveEvent gives a DELTA from that point, not an absolute pointer
// position, so the raw geometry `classifyDropZone` needs is
// `startPoint + delta`. Reads whichever event shape actually fired
// (Pointer/Mouse/Touch — MouseSensor/TouchSensor each dispatch their own).
function getEventPoint(evt: Event | null | undefined): { x: number; y: number } | null {
  if (!evt) return null;
  if (typeof PointerEvent !== "undefined" && evt instanceof PointerEvent) return { x: evt.clientX, y: evt.clientY };
  if (typeof MouseEvent !== "undefined" && evt instanceof MouseEvent) return { x: evt.clientX, y: evt.clientY };
  if (typeof TouchEvent !== "undefined" && evt instanceof TouchEvent) {
    const touch = evt.touches[0] ?? evt.changedTouches[0];
    return touch ? { x: touch.clientX, y: touch.clientY } : null;
  }
  return null;
}

/**
 * Split view drag-to-dock (design §6.4: "reuse @dnd-kit, don't hand-roll
 * pointer events"). A tiny render-prop wrapper so `useDraggable` — a HOOK —
 * can be called once per tab from inside the tab strip's `.map()` (Rules of
 * Hooks forbid calling it directly inside the callback). Deliberately spreads
 * only `listeners` (the pointer/touch handlers), never dnd-kit's own
 * `attributes` — those carry a `role`/`tabIndex` meant for its OWN keyboard
 * sensor, which this feature deliberately doesn't wire up (design §6.4); the
 * tab keeps its existing `role="tab"`/tablist semantics untouched.
 */
function DraggableTab({
  id,
  disabled,
  children,
}: {
  id: string;
  disabled: boolean;
  children: (args: { setNodeRef: (el: HTMLElement | null) => void; listeners: ReturnType<typeof useDraggable>["listeners"] }) => ReactNode;
}) {
  const { setNodeRef, listeners } = useDraggable({ id, disabled });
  return children({ setNodeRef, listeners });
}

export function TerminalDock({ ideaId, ideaTitle, ideaGithubUrl, recordedProjectPaths }: TerminalDockProps) {
  // Defence-in-depth: also gated at the page mount. When off, render nothing —
  // no dock, no entry point, board unchanged (B9).
  const enabled = isTerminalEnabled();
  // Task c4ca2d95 ("Terminal starting model") — called unconditionally
  // (before the `!enabled` early return below) per the rules of hooks; both
  // report `undefined` while loading, and the derived launch-surface lines
  // (computed further down, after the early return) omit themselves until
  // both resolve rather than showing a placeholder that might be wrong for
  // a beat.
  const platformTerminalDefault = usePlatformTerminalModelDefault();
  const viewerTerminalModel = useViewerTerminalModel();
  // Dock-open persistence (rework 5, card cbe60db5 — Nick's field test: "fix
  // the terminal panel staying open as well"). Initial paint stays collapsed
  // (SSR-safe, matches every other install-first input use-terminal-session.ts
  // corrects on mount) — the effect below flips it open right after mount if
  // this tab last left it expanded, so the entry-decision (instant-continue
  // or chooser) still runs exactly as if the reload never happened.
  const [expanded, setExpanded] = useState(false);
  // Session entry chooser (card cbe60db5, F1): the dock no longer seeds a
  // pristine tab unconditionally at page load — whether it does at all (and
  // whether the chooser renders instead) depends on `entryDecision`, which
  // needs the registry fetch below FIRST. `sessions` starts genuinely empty;
  // the seeding effect further down populates it once that decision is known.
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [activeKey, setActiveKey] = useState<string>("");
  const [summaries, setSummaries] = useState<Record<string, SessionSummary>>({});
  // Every one of the caller's active-or-recent (≤48h) sessions across all
  // ideas — null while the initial fetch is in flight (the "checking your
  // sessions…" beat: nothing may auto-mint before this is known, F1).
  const [registryRows, setRegistryRows] = useState<ChooserRegistryRow[] | null>(null);
  // Chooser helper-update nudge (card cbe60db5, rework 3): the caller's own
  // last-known helper status, fetched once alongside the registry — same
  // `/api/terminal/helper/status` response the My sessions panel polls
  // on-open. Best-effort only: a failed fetch leaves this `null`, which the
  // chooser's own predicate treats as "nothing to nudge about", never an
  // error state.
  const [helperStatus, setHelperStatus] = useState<HelperStatus | null>(null);
  // A task-scoped (or board-level) launch that arrived while the chooser was
  // showing — carried so "Start new session" / the task-dedupe banner can
  // act on it once the user actually picks something (F1: nothing mints on
  // the bus event itself while there's a choice to make).
  const [pendingLaunch, setPendingLaunch] = useState<BrowserLaunchPayload | null>(null);
  // Which tab's "View my other sessions" link opened the browse chooser, if
  // any (bug report 2026-08-23: Start New Session from that link opened a
  // SIBLING tab instead of replacing the ended one the link was clicked
  // from). Read only by `handleChooserStartNew`, which reclaims this tab in
  // place when it's still sitting there ended; every other way of closing
  // the chooser clears it so a stale origin never leaks into a later launch.
  const [chooserOriginKey, setChooserOriginKey] = useState<string | null>(null);
  // Disables every chooser action while a click's async work (reattach mint,
  // resume launch) is in flight — never a silent double-submit.
  const [chooserBusy, setChooserBusy] = useState(false);
  // Chooser OVERLAY (card cbe60db5, rework 11 — QA root cause: `deliverLaunch`
  // gated the chooser-vs-mint decision on "no local tabs yet", so once ANY
  // tab existed every subsequent launch (toolbar, "+", task launch) bypassed
  // the chooser regardless of what else the registry knew about). Visibility
  // is now a SEPARATE concern from "does a local tab already exist":
  // `showingChooser` (below) still owns the sessions.length === 0 full
  // dock-body swap — today's unchanged behaviour, nothing to protect.
  // `chooserOpen` gates a small non-destructive Dialog overlay for the case
  // a tab is already open (possibly actively connected) — the tab strip and
  // that tab's live `TerminalSessionView` stay mounted, connected, and
  // visible underneath; only clicking an action inside the overlay closes it.
  //
  // `chooserMode` records WHY it opened, because the two reasons want
  // different dismissal rules (Nick's field report 2026-08-19):
  //  - "launch": a launch fired and must resolve to exactly one outcome, so
  //    the overlay is a forced choice — no close button, Escape and
  //    outside-click both suppressed. Unchanged behaviour.
  //  - "browse": the user followed the ended panel's "View my other sessions"
  //    link purely to LOOK. Nothing is pending, so trapping them until they
  //    start or reconnect something would be worse than the dead end the link
  //    was added to fix — this mode is freely dismissible.
  // Kept as one state rather than a second boolean so "open" and "why" can
  // never drift out of sync; `chooserOpen` stays derived for every read site.
  const [chooserMode, setChooserMode] = useState<"launch" | "browse" | null>(null);
  const chooserOpen = chooserMode !== null;
  // Task-launch-skip-chooser (Nick's explicit product decision, 2026-08-16):
  // a per-task launch (payload carries `taskId`) never opens the full
  // chooser above — it either mints immediately (no existing session for
  // THIS exact task) or opens this minimal, task-scoped choice instead (see
  // `TerminalTaskLaunchChoice`). Mutually exclusive with `chooserOpen` —
  // `deliverLaunch` only ever sets one of the two.
  const [taskChoiceOpen, setTaskChoiceOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Tab close arms an inline confirm on a LIVE session (OQ1) — the second click
  // on the SAME tab's × (or a second Delete keypress) actually ends it. Ended
  // tabs close instantly, no confirm.
  const [confirmingKey, setConfirmingKey] = useState<string | null>(null);
  // Tab rename (card 3bf262ac) — mirrors `confirmingKey`'s "one contents-swap
  // active at a time" shape: the active tab's own inline editor, reusing the
  // tab strip's shipped contents-swap pattern (pencil/label ↔ input/✓/✕).
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  // Single shared aria-live announcer for background-tab attention (a11y §14) —
  // one region so simultaneous background transitions never talk over each other.
  const [announcement, setAnnouncement] = useState("");
  // Multi-session stage 3 (C3/C4): the global "My sessions" panel — one
  // instance, opened from the collapsed bar's button (always visible,
  // collapsed or expanded) OR by a cap refusal on ANY tab's mint (E1, design
  // §7b). `mySessionsCount` mirrors the panel's own fetch so the trigger's
  // badge stays in sync without a second independent poll.
  const [mySessionsOpen, setMySessionsOpen] = useState(false);
  const [mySessionsCount, setMySessionsCount] = useState<number | null>(null);
  const openMySessions = useCallback(() => setMySessionsOpen(true), []);
  const actionsMapRef = useRef<Map<string, TerminalSessionActions>>(new Map());
  // Multi-session stage 4 (D1-D3, popout-channel.ts): which tabs are CURRENTLY
  // popped out. Purely a dock-tracked fact — the underlying session's real
  // TerminalStatus is usually "error"/duplicate (the 4001 preemption) the
  // instant this is true, but that's not what the UI should show (design §5:
  // "popped out ... deliberate user state", never an attention/error
  // treatment). `popoutChannelsRef` holds the live BroadcastChannel + its
  // handshake phase per popped-out key, for the lifetime of the pop-out (open
  // from the moment "Pop out" is clicked until either "Bring back" or the
  // popped window's own close-signal).
  const [poppedOutKeys, setPoppedOutKeys] = useState<Set<string>>(() => new Set());
  const popoutChannelsRef = useRef<Map<string, DockPopoutEntry>>(new Map());
  // Mirrors so `deliverLaunch` (used by both the launch-bus subscription and
  // "+") can read the CURRENT list/summaries without depending on them — that
  // keeps its identity stable across renders instead of forcing the launch-bus
  // effect to unsubscribe/resubscribe on every tab status change.
  const sessionsRef = useRef(sessions);
  const summariesRef = useRef(summaries);
  // Card 3bf262ac — see the overlay Dialog's `onEscapeKeyDown` and
  // TerminalSessionChooser's `onRenamingActiveChange` doc: a ref (not
  // state) because it's read only from inside a native-event callback that
  // must see the CURRENT value without itself triggering a re-render.
  const chooserRenamingActiveRef = useRef(false);
  // Bug df29b85e (resume opens a new tab, leaves the dead one behind, field
  // report 22 Aug 2026): `mintAndDeliver`'s ended-tab reclaim path needs a
  // synchronous read of which tabs are popped out, same reason as the two
  // refs above — a popped-out tab's OWN reported status is untrustworthy
  // (see `requestClose`'s identical `poppedOutKeys.has(key) ||
  // isLiveTabStatus(status)` combined check just below), so reclaim must
  // never take over one even if its last-known status happens to read
  // "session-ended".
  const poppedOutKeysRef = useRef(poppedOutKeys);
  const posthog = usePostHog();
  const posthogRef = useRef(posthog);
  // Session entry chooser (card cbe60db5): mirrors `entryDecision` (declared
  // below, after the registry fetch) for the same reason as the refs above —
  // `deliverLaunch` needs a synchronous, always-current read without being a
  // dependency that would force the launch-bus effect to resubscribe.
  const entryDecisionRef = useRef<EntryDecision | null>(null);
  // Refs must only be WRITTEN outside render (react-hooks/refs) — sync them in
  // an effect, which always commits before any later event handler can read
  // them, so `deliverLaunch` (called only from event handlers / the launch-bus
  // subscription) never sees a stale value.
  useEffect(() => {
    sessionsRef.current = sessions;
    summariesRef.current = summaries;
    poppedOutKeysRef.current = poppedOutKeys;
    posthogRef.current = posthog;
  }, [sessions, summaries, poppedOutKeys, posthog]);
  // Bug B (card cbe60db5 rework 9 — RELEASE-BLOCKING, Nick's field test
  // 2026-08-14): `deliverLaunch` below used to treat `entryDecisionRef.current
  // === null` (the registry fetch is STILL LOADING — genuinely unknown, never
  // "nothing to choose between") the same as "no chooser needed", falling
  // through to an unconditional mint that bypassed the chooser entirely on a
  // fast click. Set true only while a launch is queued specifically because
  // the decision wasn't known yet; the seed effect below (which reacts to
  // `entryDecision` settling) reads and clears it, delivering the SAME outcome
  // `deliverLaunch` would have produced had the fetch simply finished first.
  const deferredLaunchPendingRef = useRef(false);

  // ── dock-open persistence (rework 5, card cbe60db5) ─────────────────────────
  // Correct the collapsed initial paint on mount if this tab last left the
  // dock expanded (mirrors the platform/paired install-first corrections in
  // use-terminal-session.ts — SSR paints collapsed, a mount effect flips it
  // open). Then persist every subsequent change, whatever caused it (a user
  // click, or any of the programmatic setExpanded(true) calls throughout this
  // file) — so the NEXT refresh keeps reflecting reality.
  useEffect(() => {
    if (readDockOpen()) setExpanded(true);
    // Mount-only correction (empty deps, intentional) — re-running this on
    // every render would fight the user's own collapse.
  }, []);
  useEffect(() => {
    writeDockOpen(expanded);
  }, [expanded]);

  // ── user-resizable height (card b885ebfd) ─────────────────────────────────
  // Preferred body height (localStorage) + live viewport → effective height,
  // exposed to the per-session bodies as a CSS variable on the root below.
  // See terminal-dock-resize.tsx for the full contract.
  const dockHeight = useDockHeight();
  // Reserve the dock's footprint at the bottom of the page, so board
  // columns can scroll past it instead of ending underneath it (card 534d2049).
  const dockInsetRef = useDockInset();

  // ── split view (task df7a0134) ──────────────────────────────────────────────
  // A view-mode toggle: two sessions side by side in the SAME dock body,
  // instead of one-at-a-time tabs. Tabs stay the default (Requirements
  // §"default recommendation") — `splitPreferred` is `null` until the
  // localStorage preference hydrates on mount (SSR/first-paint stays tabs,
  // same install-first correction pattern as `readDockOpen` above), then
  // tracks the user's OWN choice; entering/leaving the width floor or losing
  // a pane to pop-out never touches it (design §5.5/§5.8 — the preference is
  // "kept" through a suspension, not cleared).
  const [splitPreferred, setSplitPreferred] = useState<boolean | null>(null);
  useEffect(() => {
    setSplitPreferred(readSplitViewPreference());
  }, []);
  // Which sessions occupy panes, in strip (left→middle→right) order. Empty
  // when split isn't rendering. The all-or-nothing rule (D1/D2, design §10)
  // means this is always either [] or exactly as many keys as the current
  // pane count (2 or 3) — there is no partial assignment to reconcile
  // per-slot the way the shipped 2-pane feature used to (see the count-driven
  // effect below).
  const [paneKeys, setPaneKeys] = useState<string[]>([]);
  // Exactly ONE pane owns the keyboard at all times (the hard requirement).
  const [focusedPaneIndex, setFocusedPaneIndex] = useState(0);
  const paneKeysRef = useRef(paneKeys);
  const focusedPaneIndexRef = useRef(focusedPaneIndex);
  useEffect(() => {
    paneKeysRef.current = paneKeys;
  }, [paneKeys]);
  useEffect(() => {
    focusedPaneIndexRef.current = focusedPaneIndex;
  }, [focusedPaneIndex]);
  // Split-view focus-sync defect fix (task df7a0134, QA rework): `focusedSide`
  // above is the APP's declared intent — which pane a click/chord/forced move
  // targeted. It says nothing about whether the keyboard is ACTUALLY there
  // right now. `keyboardLive` is that ground truth: true only while real DOM
  // focus genuinely sits inside one of the two panes' xterm inputs — false
  // the instant it leaves both (click elsewhere on the page, window blur), so
  // neither pane's "Typing here" chip can ever be shown while nothing
  // actually holds the keyboard. Fed into `paneFocused` below alongside
  // `focusedSide`; kept true by every explicit "grab the keyboard" call site
  // (`movePaneFocus`, entering split, drag-to-dock) via `markPaneFocusLive`,
  // and corrected by real focus/blur events via `handlePaneFocusChange` —
  // see both below.
  const [keyboardLive, setKeyboardLive] = useState(false);
  // Which pane's textarea most recently reported real focus — read by the
  // deferred blur check in `handlePaneFocusChange` so a focus move BETWEEN
  // the two panes (blur old, focus new — both synchronous, same tick) never
  // flickers `keyboardLive` false in between.
  const liveFocusKeyRef = useRef<string | null>(null);
  const blurCheckTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (blurCheckTimeoutRef.current) clearTimeout(blurCheckTimeoutRef.current);
    };
  }, []);
  // Width-floor hysteresis state (design §7 Q3 / §5.8) — measured off the
  // same element the two panes actually share (see `splitBodyRef` below).
  const [belowWidthFloor, setBelowWidthFloor] = useState(false);
  const [floorNoticeDismissed, setFloorNoticeDismissed] = useState(false);
  // D3's 4th-session cap: which sky notice (if any) is showing, and whether
  // the human dismissed it. "count" = 4th/5th session forced tabs;
  // "width-entry" = a 3rd session couldn't get a pane for lack of room.
  const [forcedTabsNotice, setForcedTabsNotice] = useState<"count" | "width-entry" | null>(null);
  const [forcedTabsNoticeDismissed, setForcedTabsNoticeDismissed] = useState(false);
  // Mobile always renders tabs regardless of stored preference (Design
  // Review required change 3 / AC14) — tracked as an explicit gate, not left
  // as an accident of the width floor.
  const [viewportWidth, setViewportWidth] = useState(0);
  const splitBodyRef = useRef<HTMLDivElement | null>(null);
  // Most-recently-active session keys, most-recent-first — the recency
  // signal `enterSplitAssignment` needs for "the most-recently-active OTHER
  // eligible session" (design §7 Q1, exactly-2-eligible entry only — 3-pane
  // entry uses strip order instead, design §10.3), without threading a bump
  // through every existing `setActiveKey` call site. Purely additive
  // bookkeeping — never itself drives a render.
  const activeHistoryRef = useRef<string[]>([]);
  useEffect(() => {
    if (!activeKey) return;
    activeHistoryRef.current = [activeKey, ...activeHistoryRef.current.filter((k) => k !== activeKey)];
  }, [activeKey]);
  // Drag-to-dock (design §6, Design Review required change 2): true for the
  // whole lifetime of any tab drag — forwarded to EVERY mounted session's
  // xterm instance so Escape is consumed regardless of which pane had DOM
  // focus when the drag began (see use-terminal-session.ts's doc). A ref, not
  // state, so it never forces a render on its own.
  const dragActiveRef = useRef(false);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [dropZone, setDropZone] = useState<DropZone | null>(null);
  const dragStartPointRef = useRef<{ x: number; y: number } | null>(null);
  const tabStripRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // ── session entry chooser (card cbe60db5) — registry fetch + entry decision ──
  //
  // F1: "On board load the dock fetches the registry once (it already
  // fetches for the My sessions badge)". `refreshRegistry` is also reused
  // after a failed reattach (the row may have just gone stale) and by the
  // `?reconnect=` handler below.
  // Bug A (card cbe60db5, Nick's field report 2026-08-15 — hard refresh
  // silently minted a brand-new session instead of reattaching): this used
  // to be a single, no-retry fetch whose catch collapsed EVERY failure into
  // `[]`. `decideEntryBehaviour` can't tell a real empty registry apart from
  // "we never actually asked" — an empty array reads as "confirmed nothing
  // live or recent", which routes straight to `empty-launch` and the seed
  // effect auto-mints with no chooser and no error, exactly like a genuinely
  // fresh session. That's the SAME null-vs-[] confusion rework 9 already
  // fixed for the still-loading path (see the comment above
  // `entryDecisionRef`) — just reintroduced on the error path instead.
  // Retry with backoff first; if every attempt fails, leave `registryRows`
  // exactly as it was (null on first load keeps the dock in "still
  // checking…" and blocks the seed effect the same way an in-flight fetch
  // does; a stale array from an earlier successful load just keeps showing
  // what we last knew) rather than lying that we confirmed empty.
  const refreshRegistry = useCallback(async () => {
    let lastErr: unknown;
    for (const delay of REGISTRY_RETRY_DELAYS_MS) {
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      try {
        const res = await fetch("/api/terminal/session/list");
        if (!res.ok) throw new Error(`status ${res.status}`);
        const body = (await res.json()) as { sessions: ChooserRegistryRow[] };
        setRegistryRows(body.sessions);
        return;
      } catch (err) {
        lastErr = err;
      }
    }
    logger.error("Terminal registry fetch failed after retries", {
      error: lastErr instanceof Error ? lastErr.message : String(lastErr),
    });
    // Same retry-affordance idiom as the reattach failure toast below
    // (`Couldn't reconnect…` action: Retry) — never silently strand the user
    // on a registry we couldn't confirm.
    toast.error("Couldn't check your terminal sessions", {
      description: "We couldn't confirm whether a session is already running. Check your connection and retry.",
      action: { label: "Retry", onClick: () => void refreshRegistry() },
    });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refreshRegistry();
  }, [enabled, refreshRegistry]);

  // ── rename (card 3bf262ac) — the ONE persistence function every rename
  // surface calls. Pure persistence + central-state sync: PATCHes the
  // session, and on success keeps BOTH `registryRows` (the chooser's data
  // source) and any LIVE tab entry for this sid in sync, so the tab label,
  // pop-out title and aria announcer agree with what the initiating surface
  // just showed (design §4 "Optimistic update"). Each CALLER (the tab's own
  // editor below, the My Sessions panel, the chooser) owns its OWN
  // optimistic apply/revert of whatever it's rendering — this function never
  // does that on their behalf, since they don't share state with each other.
  const renameSession = useCallback(
    async (sid: string, next: string | null): Promise<{ ok: boolean; displayName: string | null }> => {
      try {
        const res = await fetch(`/api/terminal/session/${encodeURIComponent(sid)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          // "" is the clear signal the PATCH route expects — never send `null`.
          body: JSON.stringify({ displayName: next ?? "" }),
        });
        if (!res.ok) return { ok: false, displayName: null };
        const body = (await res.json().catch(() => null)) as { displayName?: string | null } | null;
        const resolved = body && "displayName" in body ? (body.displayName ?? null) : next;
        setRegistryRows((prev) => prev?.map((r) => (r.sid === sid ? { ...r, displayName: resolved } : r)) ?? prev);
        setSessions((prev) =>
          prev.map((s) => (summariesRef.current[s.key]?.sessionId === sid ? { ...s, displayName: resolved ?? undefined } : s)),
        );
        return { ok: true, displayName: resolved };
      } catch (err) {
        logger.error("Terminal session rename failed", { sid, error: err instanceof Error ? err.message : String(err) });
        return { ok: false, displayName: null };
      }
    },
    [],
  );

  useEffect(() => {
    if (!enabled) return;
    void fetchHelperStatus().then(setHelperStatus);
  }, [enabled]);

  // The chooser's own "Update now" shares the My sessions panel's
  // quiesce-then-download flow (use-helper-update-flow.ts) but has no fetch
  // loop of its own to notice the helper has quiesced — reuse the SAME
  // registry + status fetches the dock already owns to refresh it once the
  // flow settles, mirroring the panel's own post-quiesce `load()`.
  const refreshAfterHelperUpdate = useCallback(() => {
    void refreshRegistry();
    void fetchHelperStatus().then(setHelperStatus);
  }, [refreshRegistry]);

  // This tab's own snapshot infos (session-snapshot.ts) — one per sid the
  // tab held before the reload (multi-terminal reload restore: EVERY session
  // it had attached, not just the last), read once; a tab doesn't gain NEW
  // sids mid-session except by attaching another session itself, at which
  // point the chooser is long since resolved.
  const [entrySnapshotInfos] = useState(() =>
    readTabSids().flatMap((sid) => {
      const snap = loadSessionSnapshot(sid);
      return snap ? [{ sid, savedAt: snap.savedAt }] : [];
    }),
  );

  const entryDecision: EntryDecision | null = useMemo(() => {
    if (registryRows === null) return null; // still loading
    return decideEntryBehaviour(registryRows, entrySnapshotInfos, Date.now());
  }, [registryRows, entrySnapshotInfos]);
  useEffect(() => {
    entryDecisionRef.current = entryDecision;
    // Fix 3 (card 9fb9fced): the client's own page-load/refresh liveness
    // check — what the registry read found for this browser's sessions, and
    // which of the three branches it took as a result. `entryDecision.kind`
    // IS that branch (instant-continue → quiet reattach, chooser → render
    // the picker/session-ended surface, empty-launch → mint fresh) — this is
    // the exact decision point where the original bug's silent new-session
    // launch happened with no trace at all. Fires once per resolved decision,
    // not per render (this effect only re-runs when `entryDecision` itself
    // changes).
    if (entryDecision) {
      logger.info("Terminal entry decision resolved", {
        kind: entryDecision.kind,
        liveCount: registryRows?.filter((r) => r.status === "active").length ?? 0,
        recentEndedCount: registryRows?.filter((r) => r.status === "ended").length ?? 0,
      });
    }
  }, [entryDecision, registryRows]);

  const chooserSections: ChooserSections = useMemo(
    () =>
      deriveChooserSections(
        registryRows ?? [],
        ideaId,
        Date.now(),
        // Every sid this tab holds (re-read per recompute — a mid-session
        // attach adds to it), so no own session is ever miscounted as "open
        // in another tab" — the pre-reload set alone isn't enough once a
        // fresh mint lands.
        readTabSids(),
        getMachineIdentity(),
      ),
    [registryRows, ideaId],
  );
  const chooserCounts = useMemo(() => chooserHeaderCounts(chooserSections), [chooserSections]);
  // Card eaa55290 (Nick's field report, 2026-08-17): "no way to tell another
  // session is already active on this board" — two browser tabs on the same
  // idea, discovered only by reading one tab's own narration text. Every
  // sessionId this DOCK currently has mounted (covers a 2nd own tab within
  // this same dock, and the gap before session-snapshot's `wasOpenInThisTab`
  // catches up right after a fresh mint) — see liveSessionsElsewhereOnThisBoard's
  // doc for why this is combined with that per-tab sessionStorage signal
  // rather than used alone.
  const ownSessionIds = useMemo(
    () => new Set(sessions.map((s) => summaries[s.key]?.sessionId).filter((id): id is string => !!id)),
    [sessions, summaries],
  );
  const otherLiveHere = useMemo(
    () => liveSessionsElsewhereOnThisBoard(chooserSections, ownSessionIds),
    [chooserSections, ownSessionIds],
  );
  // Task-launch-skip-chooser: `deliverLaunch` needs a synchronous,
  // always-current read of `chooserSections` (to check whether THIS exact
  // task already has a match) without becoming a dependency that would force
  // the launch-bus effect to resubscribe — same rationale as
  // `entryDecisionRef` above.
  const chooserSectionsRef = useRef(chooserSections);
  useEffect(() => {
    chooserSectionsRef.current = chooserSections;
  }, [chooserSections]);

  // Close every open pop-out hand-off channel if the dock itself unmounts
  // (board navigation away) — the popped windows keep running independently
  // either way; this just stops the dock's side from listening. The Map
  // instance itself never changes identity across renders (created once by
  // useRef), so capturing it here is just satisfying the lint rule, not
  // guarding against a real staleness bug.
  useEffect(() => {
    const channels = popoutChannelsRef.current;
    return () => {
      for (const { channel } of channels.values()) {
        try {
          channel.close();
        } catch {
          /* already closed */
        }
      }
      channels.clear();
    };
  }, []);

  const descriptor: TerminalSessionDescriptor = useMemo(
    () => ({ ideaId, ideaTitle, ideaGithubUrl, recordedProjectPaths }),
    [ideaId, ideaTitle, ideaGithubUrl, recordedProjectPaths],
  );
  // Dock CHROME: shared by every session. Each tab calls this at the same points
  // P1's single hook called `setExpanded(true)` directly.
  const requestExpand = useCallback(() => setExpanded(true), []);

  const registerActions = useCallback((key: string, actions: TerminalSessionActions | null) => {
    if (actions) actionsMapRef.current.set(key, actions);
    else actionsMapRef.current.delete(key);
  }, []);

  const reportSummary = useCallback((key: string, summary: SessionSummary) => {
    setSummaries((prev) => {
      const cur = prev[key];
      if (
        cur &&
        cur.status === summary.status &&
        cur.sessionId === summary.sessionId &&
        cur.errorKind === summary.errorKind &&
        cur.launchPhase === summary.launchPhase &&
        cur.platformSupported === summary.platformSupported &&
        cur.paired === summary.paired &&
        cur.browserToken === summary.browserToken &&
        cur.readOnly === summary.readOnly
      ) {
        return prev;
      }
      return { ...prev, [key]: summary };
    });
  }, []);

  const announce = useCallback((text: string) => setAnnouncement(text), []);

  // ── split view (task df7a0134) — pane assignment, width floor, focus ───────
  // A session's own resolved name — the SAME string the tab shows
  // (`deriveTabLabel`, which delegates to `resolveSessionName`) — for
  // announcements and the pane header (design's binding note: never
  // re-derive it). Reads the refs (not `sessions`/`summaries` state) so it's
  // callable from event handlers without becoming a dependency that forces
  // them to rebind on every session/summary change.
  const labelFor = useCallback(
    (key: string | null): string => {
      if (!key) return "";
      const entry = sessionsRef.current.find((s) => s.key === key);
      return deriveTabLabel({
        displayName: entry?.displayName,
        taskTitle: entry?.taskTitle,
        ideaTitle,
        sessionId: summariesRef.current[key]?.sessionId ?? null,
      });
    },
    [ideaTitle],
  );

  // Split-view focus-sync defect fix: the one place `keyboardLive` is set
  // TRUE — every call site below that deliberately grabs the keyboard
  // (entering split, the chord/click move, a drag-drop dock) calls this
  // alongside its existing `refreshView({ focus: true })`, rather than
  // relying solely on the resulting native focus event. That event can be a
  // no-op when the target already genuinely had DOM focus before the
  // transition (the exact "belt and braces" gap the toggle's own comment
  // below already called out for `grabFocus`/`expanded`) — `.focus()` on an
  // already-focused element fires no new focus event, so nothing would
  // otherwise update `keyboardLive`. `handlePaneFocusChange` (below) is the
  // complementary correction for focus arriving somewhere the app DIDN'T
  // ask it to.
  const markPaneFocusLive = useCallback((key: string) => {
    liveFocusKeyRef.current = key;
    if (blurCheckTimeoutRef.current) {
      clearTimeout(blurCheckTimeoutRef.current);
      blurCheckTimeoutRef.current = null;
    }
    setKeyboardLive(true);
  }, []);

  // Popped-out sessions never claim a pane (shipped invariant); ended
  // sessions stay eligible — only pop-out excludes.
  const eligible = useMemo(
    () => eligiblePaneKeys(sessions.map((s) => ({ key: s.key, poppedOut: poppedOutKeys.has(s.key) }))),
    [sessions, poppedOutKeys],
  );
  const mobileViewport = isMobileViewport(viewportWidth);
  const dockCount = eligible.length;
  // 0 (tabs), 2, or 3 — the pane count the CURRENT dock-resident session
  // count maps to (D1/D3, design §10.1). Never 1 or >3.
  const paneCount = panesForDockCount(dockCount);
  const splitActive =
    isSplitRenderableForCount({
      preferred: splitPreferred === true,
      dockCount,
      belowWidthFloor,
      mobileViewport,
    }) && paneKeys.length === paneCount;

  const paneCountRef = useRef(paneCount);
  useEffect(() => {
    paneCountRef.current = paneCount;
  }, [paneCount]);
  const splitPreferredRef = useRef(splitPreferred);
  useEffect(() => {
    splitPreferredRef.current = splitPreferred;
  }, [splitPreferred]);

  // Count-driven transitions (D3/D8, design §10.3/§10.6): the all-or-nothing
  // rule means there's no per-slot backfill left to do — either every
  // eligible session gets a pane (strip order) or the dock is entirely
  // tabs. Reacts to `dockCount` directly (not a resize) so a 4th session
  // never renders a pane for even one frame; width for the NEW target pane
  // count is re-measured synchronously in the same tick, since the count
  // axis carries no hysteresis of its own (D5).
  const prevPaneCountRef = useRef(paneCount);
  useEffect(() => {
    if (splitPreferred !== true) return;
    const prevCount = prevPaneCountRef.current;
    prevPaneCountRef.current = paneCount;

    if (paneCount === 0) {
      // 0-1, or 4-5 dock sessions: the whole dock is plain tabs. Only the
      // 4-5 case gets a notice — 0-1 is simply "nothing to split".
      setPaneKeys([]);
      if (dockCount >= 4) {
        setForcedTabsNotice("count");
        setForcedTabsNoticeDismissed(false);
        announce(formatForcedTabsCountAnnouncement(labelFor(activeKey)));
      }
      return;
    }

    if (paneCount === prevCount && paneKeysRef.current.length === paneCount) {
      // Target count unchanged and already fully assigned — just keep
      // membership fresh (e.g. a popped-out session returned) without
      // treating it as a new transition to announce.
      const filtered = paneKeysRef.current.filter((k) => eligible.includes(k));
      const missing = eligible.filter((k) => !filtered.includes(k));
      const next = filtered.concat(missing).slice(0, paneCount);
      if (next.length !== paneKeysRef.current.length || next.some((k, i) => k !== paneKeysRef.current[i])) {
        setPaneKeys(next);
      }
      return;
    }

    // The target pane count itself just changed (2<->3, or arriving from
    // tabs) — measure the dock body against the NEW count's floor before
    // deciding anything (design §10.1's 1442/1462 pair for 3, shipped
    // 961/981 for 2).
    const width = splitBodyRef.current?.getBoundingClientRect().width ?? 0;
    const tooNarrow = resolveWidthFloorForCount(width, false, paneCount === 3 ? 3 : 2);
    setBelowWidthFloor(tooNarrow);
    const strip = eligible.slice(0, paneCount);

    if (tooNarrow) {
      setPaneKeys(strip); // held ready; renders as tabs until width regains (D4/D5)
      if (paneCount === 3 && prevCount === 2) {
        setForcedTabsNotice("width-entry");
        setForcedTabsNoticeDismissed(false);
        announce(formatThirdPaneWidthBlockedAnnouncement());
      }
      return;
    }

    setForcedTabsNotice(null);
    const wasFullyPaned = paneKeysRef.current.length === prevCount && prevCount !== 0;
    setPaneKeys(strip);
    if (paneCount === 3 && prevCount === 2 && wasFullyPaned) {
      // D8 — a 3rd session appeared while 2-up: it gets the new pane on the
      // right and takes focus, automatically.
      const added = strip.find((k) => !paneKeysRef.current.includes(k));
      if (added) {
        const idx = strip.indexOf(added);
        setFocusedPaneIndex(idx);
        setActiveKey(added);
        announce(formatThirdPaneAddedAnnouncement(labelFor(added)));
        actionsMapRef.current.get(added)?.refreshView({ focus: true });
        markPaneFocusLive(added);
      }
    } else if (prevCount === 0) {
      // D5 — automatic restore from a forced-tabs state (count or width).
      const focusIdx = Math.max(0, strip.indexOf(activeKey));
      setFocusedPaneIndex(focusIdx);
      announce(formatSplitRestoredAnnouncementForPanes(strip.map((k) => labelFor(k)), labelFor(strip[focusIdx] ?? null)));
    }
  }, [dockCount, paneCount, eligible, splitPreferred, activeKey, announce, labelFor, markPaneFocusLive]);

  // Keep `activeKey` (and so `aria-selected`) pointed at the focused pane's
  // session while split is the standing preference — even if not currently
  // RENDERED as split (width floor / mobile / count, §10.1).
  useEffect(() => {
    if (splitPreferred !== true || paneKeys.length === 0) return;
    const target = paneKeys[focusedPaneIndex] ?? paneKeys[0];
    if (target && target !== activeKey) setActiveKey(target);
  }, [splitPreferred, paneKeys, focusedPaneIndex, activeKey]);

  // Width-shrink fallback WHILE already rendering at the current pane
  // count (as opposed to the count-transition effect above, which handles
  // the width check at the moment the target count itself changes). Same
  // hysteresis idiom as shipped v1 — `splitPreferredRef`/`paneCountRef`
  // avoid re-subscribing the ResizeObserver on every toggle or count change.
  useEffect(() => {
    const el = splitBodyRef.current;
    // Guarded for jsdom and any environment without ResizeObserver — same
    // pattern as terminal-dock-inset.ts's own measurement effect.
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? el.getBoundingClientRect().width;
      const count = paneCountRef.current;
      if (count === 0) return; // nothing to fall back FROM — already full tabs
      setBelowWidthFloor((prev) => {
        const next = resolveWidthFloorForCount(width, prev, count === 3 ? 3 : 2);
        if (next !== prev && splitPreferredRef.current) {
          if (count === 3) {
            if (next) {
              announce(formatWidthFallbackThreeAnnouncement());
            } else {
              const keys = paneKeysRef.current;
              announce(
                formatSplitRestoredAnnouncementForPanes(
                  keys.map((k) => labelFor(k)),
                  labelFor(keys[focusedPaneIndexRef.current] ?? null),
                ),
              );
            }
          } else {
            announce(formatWidthFloorAnnouncement(next ? "fallback" : "restored"));
          }
          if (next) setFloorNoticeDismissed(false);
        }
        return next;
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [announce, labelFor]);

  // Toggle (design §5.1): the deliberate, keyboard/touch-accessible entry
  // route — drag-to-dock (below) is a shortcut, never the only way in.
  const toggleSplitView = useCallback(() => {
    const turningOn = splitPreferred !== true;
    if (turningOn) {
      // Card 7ee218b1: the tab strip (and this button with it) now shows at
      // 1 session too, so this is reachable with nothing to split against —
      // `enterSplitAssignment` below assumes exactly 2 eligible sessions.
      if (eligible.length < 2) return;
      let keys: string[];
      let focusIndex: number;
      if (eligible.length >= 3) {
        // 3 dock sessions: pane ALL of them at once, tab-strip order,
        // keeping focus on whichever was already active (design §10.3 —
        // "there is no partial entry").
        keys = eligible.slice(0, 3);
        focusIndex = Math.max(0, keys.indexOf(activeKey));
      } else {
        // Exactly 2 eligible — shipped v1 pick, byte-identical: active tab
        // left, most-recently-active other eligible session right.
        const recency = activeHistoryRef.current.filter((k) => k !== activeKey);
        const assignment = enterSplitAssignment(activeKey, eligible, recency);
        keys = [assignment.left, assignment.right].filter((k): k is string => !!k);
        focusIndex = 0;
      }
      setPaneKeys(keys);
      setFocusedPaneIndex(focusIndex);
      setFloorNoticeDismissed(false);
      setForcedTabsNoticeDismissed(false);
      if (keys.length === panesForDockCount(keys.length)) {
        const focusedKey = keys[focusIndex];
        const labels = keys.map((k) => labelFor(k));
        announce(
          keys.length === 3
            ? formatSplitOnAnnouncementForPanes(labels, labelFor(focusedKey))
            : formatSplitOnAnnouncement(labels[0], labels[1], labelFor(focusedKey)),
        );
        // Belt and braces for the hard requirement: the focused pane's
        // `grabFocus`/`expanded` props may both already have been `true`
        // (it was the tab the user was just on), so the effect that reacts
        // to THEIR transition wouldn't re-fire on its own — force the
        // keyboard there explicitly rather than trust it was already real
        // DOM focus (it might have been on the toggle button itself).
        actionsMapRef.current.get(focusedKey)?.refreshView({ focus: true });
        markPaneFocusLive(focusedKey);
      }
    } else {
      const remaining = paneKeys[focusedPaneIndex] ?? activeKey;
      if (remaining) {
        setActiveKey(remaining);
        announce(formatSplitOffAnnouncement(labelFor(remaining)));
      }
      setPaneKeys([]);
    }
    setSplitPreferred(turningOn);
    writeSplitViewPreference(turningOn);
  }, [splitPreferred, activeKey, eligible, paneKeys, focusedPaneIndex, announce, labelFor, markPaneFocusLive]);

  // Moving focus between panes (design §5.3/§5.4/§10.5): click-into-a-pane
  // and the Ctrl+Shift+←/→ chord both land here — one source of truth for
  // "which pane owns the keyboard", so visual state (border/glow/words/
  // cursor) and real DOM focus can never split-brain. `direction` steps one
  // pane that way, no wrap (D9) — generalized to N panes via
  // `stepPaneFocusIndex`; with 2 panes this is indistinguishable from the
  // shipped absolute behaviour.
  const movePaneFocus = useCallback(
    (direction: PaneSide) => {
      const nextIndex = stepPaneFocusIndex(focusedPaneIndex, direction, paneKeys.length);
      const key = paneKeys[nextIndex];
      if (!key || nextIndex === focusedPaneIndex) return;
      setFocusedPaneIndex(nextIndex);
      setActiveKey(key);
      actionsMapRef.current.get(key)?.refreshView({ focus: true });
      markPaneFocusLive(key);
      announce(formatFocusMoveAnnouncement(labelFor(key)));
    },
    [paneKeys, focusedPaneIndex, announce, labelFor, markPaneFocusLive],
  );
  const focusPaneByKey = useCallback(
    (key: string) => {
      const index = paneKeys.indexOf(key);
      if (index === -1 || index === focusedPaneIndex) return;
      setFocusedPaneIndex(index);
      setActiveKey(key);
      actionsMapRef.current.get(key)?.refreshView({ focus: true });
      markPaneFocusLive(key);
      announce(formatFocusMoveAnnouncement(labelFor(key)));
    },
    [paneKeys, focusedPaneIndex, announce, labelFor, markPaneFocusLive],
  );

  // Split-view focus-sync defect fix: the other half of the invariant —
  // real focus ARRIVING somewhere the app didn't send it (native Tab order
  // in particular, since xterm's hidden input defaults to `tabIndex=0`; also
  // covers a stray click that lands on the terminal viewport itself rather
  // than the pane wrapper `onFocusPane` is bound to). Wired to each pane's
  // `onPaneFocusChange` (terminal-session-view.tsx → use-terminal-session.ts's
  // real textarea focus/blur listener — see its doc). A `focused: true`
  // routes through the SAME `focusPaneByKey` a click already uses, so
  // `focusedSide` can never point at a pane the keyboard isn't really in. A
  // `focused: false` is deferred one tick before declaring the keyboard has
  // left BOTH panes: a focus move FROM one pane TO the other fires blur(old)
  // then focus(new) synchronously in the same tick, so `liveFocusKeyRef`
  // already reflects the new pane by the time this timeout runs — only a
  // blur with no followup focus (click elsewhere on the page, window blur)
  // survives to flip `keyboardLive` false.
  const handlePaneFocusChange = useCallback(
    (key: string, focused: boolean) => {
      if (focused) {
        focusPaneByKey(key);
        markPaneFocusLive(key);
        return;
      }
      if (liveFocusKeyRef.current !== key) return;
      if (blurCheckTimeoutRef.current) clearTimeout(blurCheckTimeoutRef.current);
      blurCheckTimeoutRef.current = setTimeout(() => {
        blurCheckTimeoutRef.current = null;
        if (liveFocusKeyRef.current === key) {
          liveFocusKeyRef.current = null;
          setKeyboardLive(false);
        }
      }, 0);
    },
    [focusPaneByKey, markPaneFocusLive],
  );

  useEffect(() => {
    if (!splitActive) return;
    const handler = (e: KeyboardEvent) => {
      const dir = matchFocusMoveChord(e);
      if (!dir) return;
      e.preventDefault();
      movePaneFocus(dir);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [splitActive, movePaneFocus]);

  // A tab click while split (design §10.0/§10.5): every tab already has a
  // pane (the all-or-nothing rule), so a click can only ever mean "focus
  // that pane" — the focused pane's own tab is a no-op, any other tab moves
  // focus there. There is no third-session-replaces-unfocused-pane branch
  // anymore (that was 2-pane-era, superseded — see split-view.ts).
  const handleSplitTabClick = useCallback(
    (key: string) => {
      const index = paneKeys.indexOf(key);
      if (index === -1 || index === focusedPaneIndex) return;
      setFocusedPaneIndex(index);
      setActiveKey(key);
      actionsMapRef.current.get(key)?.refreshView({ focus: true });
      markPaneFocusLive(key);
      announce(formatFocusMoveAnnouncement(labelFor(key)));
    },
    [paneKeys, focusedPaneIndex, announce, labelFor, markPaneFocusLive],
  );

  // ── drag-to-dock (design §6, Design Review required changes 1 + 2) ─────────
  // 8px activation distance + the touch delay/tolerance the design specifies
  // — @dnd-kit's MouseSensor/TouchSensor supply both for free (no bespoke
  // pointer-event layer to drift from the board's own drag behaviour).
  // Deliberately NO KeyboardSensor (design §6.4): the toggle above is the
  // full keyboard-equivalent route, and a keyboard drag mode would fight
  // both the tablist's own arrow-key navigation and the terminal's key
  // handling.
  const dragMouseSensor = useSensor(MouseSensor, { activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE_PX } });
  const dragTouchSensor = useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } });
  const dragSensors = useSensors(dragMouseSensor, dragTouchSensor);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    dragStartPointRef.current = getEventPoint(event.activatorEvent);
    dragActiveRef.current = true;
    setDraggingKey(String(event.active.id));
    setDropZone(null);
  }, []);

  const handleDragMove = useCallback((event: DragMoveEvent) => {
    const start = dragStartPointRef.current;
    const stripEl = tabStripRef.current;
    const bodyEl = splitBodyRef.current;
    if (!start || !stripEl || !bodyEl) return;
    const stripRect = stripEl.getBoundingClientRect();
    const bodyRect = bodyEl.getBoundingClientRect();
    setDropZone(
      classifyDropZone({
        pointerX: start.x + event.delta.x,
        pointerY: start.y + event.delta.y,
        stripBottom: stripRect.bottom,
        bodyLeft: bodyRect.left,
        bodyWidth: bodyRect.width,
      }),
    );
  }, []);

  // Design Review required change 1: NO tab reordering — a drag that begins
  // and ends within the strip cancels, changing nothing, UNLESS the dragged
  // tab was already paned, which keeps its designed "leave split" meaning
  // (`resolveDragOutcome` owns this decision, pure/tested).
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      dragActiveRef.current = false;
      const draggedKey = String(event.active.id);
      const zone = dropZone ?? "none";
      setDraggingKey(null);
      setDropZone(null);
      const isPaned = paneKeys.includes(draggedKey);
      const outcome = resolveDragOutcome(zone, isPaned);
      if (outcome.kind === "cancel") return;
      if (outcome.kind === "leave-split") {
        setActiveKey(draggedKey);
        setPaneKeys([]);
        setSplitPreferred(false);
        writeSplitViewPreference(false);
        announce(formatLeaveSplitAnnouncement(labelFor(draggedKey)));
        return;
      }
      // outcome.kind === "dock" — the user chose a side explicitly.
      if (eligible.length >= 3) {
        // A 3rd dock session is open: docking (like the toggle) enters the
        // full 3-pane split at once, strip order, the dragged key focused —
        // there is no meaningful "just this one side" with 3 sessions open
        // (design §10.3 — toggle and drag both trigger 3-at-once entry).
        const keys = eligible.slice(0, 3);
        setPaneKeys(keys);
        const idx = keys.indexOf(draggedKey);
        setFocusedPaneIndex(idx === -1 ? 0 : idx);
      } else {
        // Exactly 2 eligible — shipped v1 behaviour, byte-identical: this
        // may replace EITHER pane, including the focused one (design §6.3).
        const recency = activeHistoryRef.current.filter((k) => k !== draggedKey);
        const fallbackOther = recency.find((k) => k !== draggedKey) ?? eligible.find((k) => k !== draggedKey) ?? null;
        const assignment: PaneAssignment = { left: paneKeys[0] ?? null, right: paneKeys[1] ?? null };
        const result = applyDropToSplit(assignment, outcome.side, draggedKey, fallbackOther);
        const keys = [result.assignment.left, result.assignment.right].filter((k): k is string => !!k);
        setPaneKeys(keys);
        setFocusedPaneIndex(result.focusedSide === "left" ? 0 : 1);
      }
      setActiveKey(draggedKey);
      setFloorNoticeDismissed(false);
      setForcedTabsNoticeDismissed(false);
      setSplitPreferred(true);
      writeSplitViewPreference(true);
      setExpanded(true);
      announce(formatDockAnnouncement(labelFor(draggedKey), outcome.side));
      // Same belt-and-braces as the toggle above — direct manipulation is
      // the strongest possible statement of attention (design §6.3), so the
      // dropped pane must genuinely hold real DOM focus, not just the props
      // that would eventually produce it.
      actionsMapRef.current.get(draggedKey)?.refreshView({ focus: true });
      markPaneFocusLive(draggedKey);
    },
    [dropZone, paneKeys, eligible, announce, labelFor, markPaneFocusLive],
  );

  const handleDragCancel = useCallback(() => {
    dragActiveRef.current = false;
    setDraggingKey(null);
    setDropZone(null);
  }, []);

  // ── pop-out (D1-D7, design §10 + §13 Flow 3) ────────────────────────────────
  // Tears down THIS tab's pop-out bookkeeping — the BroadcastChannel and the
  // `poppedOutKeys` membership — without touching the underlying session
  // itself. Shared by both return paths: the user's own "Bring back to dock"
  // click and the popped window's own close-signal (D3).
  const endPopOut = useCallback((key: string) => {
    const entry = popoutChannelsRef.current.get(key);
    if (entry) {
      try {
        entry.channel.close();
      } catch {
        /* already closed */
      }
      popoutChannelsRef.current.delete(key);
    }
    setPoppedOutKeys((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  // Reattach the dock's OWN leg for this session (no re-mint — reconnectNow()
  // reuses the retained sid/browserToken, see use-terminal-session.ts), first
  // restoring a handed-over buffer into the dock's own (hidden) terminal when
  // one is available, then dropping the pop-out bookkeeping. The dock's own
  // leg was preempted the moment the pop-out attached (relay close 4001), so
  // underneath the "Popped out" placeholder its connection state is stuck in
  // "error" — reconnectNow() detects that (decideReconnectNow in
  // connection.ts) and resets the state machine before reopening the socket,
  // rather than silently reattaching into a state the reducer has no forward
  // edge out of (fix/terminal-bringback-state-reset).
  //
  // Scrollback transfer (card 35cffc10, D1): a non-null `buffer` here is
  // always a SUPERSET of the dock's own history (Flow A handed the dock's
  // pre-pop-out buffer to the popped window; it only grew from there) —
  // wholesale REPLACE via restoreBuffer, never append. `null` (no buffer
  // ever arrived — deploy skew, a failed serialize, or the hand-off-timeout
  // "closed" that never carried a payload) leaves the dock's own buffer
  // untouched, exactly today's pre-this-card behaviour.
  //
  // Shared by BOTH reattach paths — the popped window's own close-signal
  // (Flow C, `onReattach` below) and the button's two-phase request (Flow B,
  // `bringBackToDock` below) — the only difference between them is HOW the
  // buffer got decided, never what happens once it has been.
  const applyBufferAndReattach = useCallback(
    (key: string, buffer: TransferredBuffer | null) => {
      if (buffer) actionsMapRef.current.get(key)?.restoreBuffer(buffer);
      actionsMapRef.current.get(key)?.reconnectNow();
      endPopOut(key);
    },
    [endPopOut],
  );

  // "Bring back to dock" button click (Flow B, design §3): two-phase —
  // request the popped window's buffer, wait up to 500ms for the reply (or
  // proceed on timeout with the dock's own buffer, D3) — THEN reconnect and
  // tear down. No channel entry means Flow C already completed the reattach
  // moments earlier (the popped window closed on its own, racing this click)
  // — a no-op (E1).
  const bringBackToDock = useCallback(
    (key: string) => {
      const entry = popoutChannelsRef.current.get(key);
      if (!entry) return;
      startBringBackRequest({
        channel: entry.channel,
        onSettle: (buffer) => applyBufferAndReattach(key, buffer),
      });
    },
    [applyBufferAndReattach],
  );

  const handlePopOut = useCallback(
    (key: string) => {
      const summary = summariesRef.current[key];
      if (!summary?.sessionId || !summary.browserToken) return; // nothing minted yet — button shouldn't even be visible
      const entry = sessionsRef.current.find((s) => s.key === key);
      const label = deriveTabLabel({
        displayName: entry?.displayName,
        taskTitle: entry?.taskTitle,
        ideaTitle,
        sessionId: summary.sessionId,
      });
      const identity = `${ideaTitle} · session ${summary.sessionId.slice(0, 8)}`;
      const nonce = generatePopoutNonce();
      // MUST be the direct, synchronous result of the click — no await before
      // this line — or popup blockers treat it as an unsolicited pop-up (D7).
      // openPopoutWindow (popout-channel.ts) owns the feature string — see its
      // doc for why `noopener` can NEVER go back in there: it shipped twice
      // and made window.open() return null unconditionally, so this guard
      // fired on every click even when the popup opened fine.
      const win = openPopoutWindow(nonce, (url, target, features) => window.open(url, target, features));
      if (!win) {
        toast.error("Couldn't open the terminal window", {
          description: "Your browser blocked the pop-up. Allow pop-ups for vibecodes.co.uk and try again.",
        });
        return; // D7: no state change on failure — the tab stays attached and streaming.
      }

      // Set up the hand-off channel FIRST, synchronously, before any other
      // work (posthog, setPoppedOutKeys, building the payload) — so it's
      // guaranteed to be a live listener the instant the popped window's
      // "ready" (or one of its retries — see startPopoutClientHandshake)
      // arrives. This was the root cause of the field failure (see this
      // module's rework doc in popout-channel.ts): nothing here previously
      // depended on ordering in a way that could race in a real browser, but
      // keeping this first removes any doubt and matches the hardening in
      // createDockPopoutMessageHandler, which now treats every "ready" —
      // not just the first — as a reason to (re)send the payload.
      const channel = new BroadcastChannel(popoutChannelName(nonce));
      popoutChannelsRef.current.set(key, { channel, handshake: INITIAL_DOCK_HANDSHAKE_STATE });
      // Everything but the buffer is static for the lifetime of this
      // hand-off — the buffer itself is captured FRESH on every send
      // (including retries) inside getPayload below (design §1/§2's "as
      // current as possible"), never memoized alongside the rest.
      const basePayload: Omit<PopoutPayload, "buffer"> = {
        sid: summary.sessionId,
        browserToken: summary.browserToken,
        relayUrl: relayBaseUrl(),
        ideaId,
        ideaTitle,
        label,
        identity,
        readOnly: summary.readOnly,
      };
      channel.onmessage = createDockPopoutMessageHandler({
        getEntry: () => popoutChannelsRef.current.get(key),
        setEntry: (next) => popoutChannelsRef.current.set(key, next),
        getPayload: () => {
          const buffer = actionsMapRef.current.get(key)?.serializeNow();
          return buffer ? { ...basePayload, buffer } : basePayload;
        },
        // The popped window told us it's closing (D3, Flow C — possibly with
        // a stashed buffer that arrived just ahead of "closed") — OR its
        // hand-off timed out and it's telling us to give up on its behalf
        // (see startPopoutClientHandshake, always with a null buffer) —
        // either way, apply whatever buffer was stashed (or none) and
        // reattach automatically.
        onReattach: (stashedBuffer) => applyBufferAndReattach(key, stashedBuffer),
      });

      posthogRef.current?.capture("terminal_popout_used", { origin: entry?.origin ?? "toolbar" });
      setPoppedOutKeys((prev) => new Set(prev).add(key));
    },
    [ideaId, ideaTitle, applyBufferAndReattach],
  );

  // ── close / remove a tab ────────────────────────────────────────────────────
  const removeEntry = useCallback(
    (key: string) => {
      endPopOut(key);
      setSessions((prev) => {
        const idx = prev.findIndex((s) => s.key === key);
        if (idx === -1) return prev;
        const next = prev.filter((s) => s.key !== key);
        if (next.length === 0) {
          // Last tab closed → back to the true P1 idle/resting state (B8), not a
          // lingering empty strip.
          const fresh = createPristineEntry();
          setActiveKey(fresh.key);
          return [fresh];
        }
        setActiveKey((cur) => {
          if (cur !== key) return cur;
          const neighbor = prev[idx - 1] ?? prev[idx + 1] ?? next[0];
          return neighbor.key;
        });
        return next;
      });
      setSummaries((prev) => {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
    },
    [endPopOut],
  );

  const requestClose = useCallback(
    (key: string) => {
      const status = summaries[key]?.status ?? "idle";
      // A popped-out tab's OWN reported status is usually "error"/duplicate
      // (the 4001 preemption) at this point, which `isLiveTabStatus` would
      // read as "already over" — but the session is very much alive, just
      // running in the popped window. × on this tab must still end the WHOLE
      // session (both legs, wherever they are), never silently orphan it.
      const live = poppedOutKeys.has(key) || isLiveTabStatus(status);
      if (!live) {
        // Already ended/errored — nothing to end, just close the tab (OQ1).
        setConfirmingKey((c) => (c === key ? null : c));
        removeEntry(key);
        return;
      }
      if (confirmingKey !== key) {
        setConfirmingKey(key);
        return;
      }
      // Second click/keypress on an armed LIVE tab — confirmed.
      actionsMapRef.current.get(key)?.end();
      setConfirmingKey(null);
      removeEntry(key);
    },
    [summaries, confirmingKey, removeEntry, poppedOutKeys],
  );

  const cancelClose = useCallback(() => setConfirmingKey(null), []);

  // Secondary hardening for the zero-reflow fix above (task 9f30ae15): an
  // armed "End session?" is easy to leave behind — clear it the moment the
  // user activates a DIFFERENT tab (mouse or keyboard), so a later click on
  // that other tab's × can never land on an already-armed confirm. A no-op
  // when `key` is the armed tab itself (arming, then re-clicking the same
  // tab, must stay a confirm).
  const disarmCloseIfSwitching = useCallback((key: string) => {
    setConfirmingKey((current) => (current && current !== key ? null : current));
  }, []);

  // Belt-and-braces: an armed confirm auto-expires after ~5s so a forgotten
  // arm can't sit live indefinitely. Re-arms/cancels reset the timer (the
  // effect re-runs on every `confirmingKey` change, cleaning up the previous
  // timer first); unmount clears it too. Deliberately NOT applied to
  // `renamingKey` — an in-progress rename must never be cancelled out from
  // under the user's typing.
  useEffect(() => {
    if (!confirmingKey) return;
    const timer = setTimeout(() => setConfirmingKey(null), 5000);
    return () => clearTimeout(timer);
  }, [confirmingKey]);

  // ── tab rename (card 3bf262ac) ───────────────────────────────────────────────
  // Optimistic apply to THIS tab's own entry, persisted via the shared
  // `renameSession`; on failure, revert + a toast whose Retry re-attempts the
  // SAME (key, sid, next, previous) tuple — the typed text is never lost, it's
  // just held in this closure rather than a reopened editor (design §4
  // Failure spec; the editor itself already closed the instant save was
  // requested — see `commitTabRename` below and SessionRenameField's doc for
  // why rows work the same way).
  const persistTabRename = useCallback(
    async (key: string, sid: string, next: string | null, previous: string | null) => {
      setSessions((prev) => prev.map((s) => (s.key === key ? { ...s, displayName: next ?? undefined } : s)));
      const result = await renameSession(sid, next);
      if (result.ok) return;
      setSessions((prev) => prev.map((s) => (s.key === key ? { ...s, displayName: previous ?? undefined } : s)));
      const entry = sessionsRef.current.find((s) => s.key === key);
      const stillCalled = deriveTabLabel({
        displayName: previous,
        taskTitle: entry?.taskTitle,
        ideaTitle,
        sessionId: sid,
      });
      toast.error(`Couldn't rename the session — it's still called "${stillCalled}".`, {
        action: { label: "Retry", onClick: () => void persistTabRename(key, sid, next, previous) },
      });
    },
    [renameSession, ideaTitle],
  );

  // Prefill: the user's own name if one exists (SessionRenameField's row
  // editors select it fully; this tab editor does the same via the input's
  // own `autoFocus`+select in the JSX below). Empty otherwise — the
  // CURRENT resolved label is shown as the input's placeholder, never
  // prefilled as if it were user text (design §4 Prefill spec).
  const openTabRename = useCallback((key: string) => {
    const entry = sessionsRef.current.find((s) => s.key === key);
    setRenameDraft(entry?.displayName?.trim() ?? "");
    setRenamingKey(key);
  }, []);

  const cancelTabRename = useCallback(() => setRenamingKey(null), []);

  const commitTabRename = useCallback(() => {
    const key = renamingKey;
    setRenamingKey(null);
    if (!key) return;
    const entry = sessionsRef.current.find((s) => s.key === key);
    const sid = summariesRef.current[key]?.sessionId;
    if (!entry || !sid) return; // nothing minted yet — the pencil isn't shown before mint anyway
    const trimmed = renameDraft.trim();
    const current = entry.displayName?.trim() ?? "";
    if (trimmed === current) return; // no real change — silent close, no network call
    void persistTabRename(key, sid, trimmed ? trimmed : null, entry.displayName ?? null);
  }, [renamingKey, renameDraft, persistTabRename]);

  // ── launch routing (B7/B10) + the pristine-slot reuse for the FIRST launch ──
  // Renamed from the pre-chooser `deliverLaunch` — this is the ACTUAL mint
  // path (today's unchanged mint/dedupe/pristine-reuse behaviour), now
  // reached either directly (F1's empty-launch state — nothing to choose
  // between) or via the chooser's "Start new session" (see `deliverLaunch`
  // below, which decides which of the two applies).
  const mintAndDeliver = useCallback((payload: BrowserLaunchPayload | null, targetSessionId?: string | null, targetKey?: string | null) => {
    const currentSessions = sessionsRef.current;
    const currentSummaries = summariesRef.current;
    const candidates: DedupeCandidate[] = currentSessions.map((s) => ({
      key: s.key,
      taskId: s.taskId,
      status: currentSummaries[s.key]?.status ?? "idle",
    }));
    const dedupe = decideTaskLaunch(candidates, payload?.taskId);
    if (dedupe.action === "focus") {
      setActiveKey(dedupe.key);
      setExpanded(true);
      toast.info("This task already has a terminal — switched to it.");
      return;
    }

    setExpanded(true);

    // Ended-tab reclaim (card df29b85e, field report 22 Aug 2026): a resume
    // that names the sid of a tab already sitting here, already ended, takes
    // that tab over IN PLACE instead of opening a sibling next to its own
    // corpse. Checked before the pristine-slot reuse below — the two never
    // overlap in practice (a reclaimable tab has already connected once, so
    // its `launchSeq` can't be 0) but reclaim is the more SPECIFIC intent
    // (an explicit originating sid was named) so it goes first on principle.
    const reclaimCandidates: ReclaimCandidate[] = currentSessions.map((s) => ({
      key: s.key,
      status: currentSummaries[s.key]?.status ?? "idle",
      sessionId: currentSummaries[s.key]?.sessionId ?? null,
      poppedOut: poppedOutKeysRef.current.has(s.key),
    }));
    // Start New Session from a specific ended tab's "View my other sessions"
    // link (bug report 2026-08-23): there's no session id to match against
    // (it's a fresh mint, not a resume), so this reclaims by the tab's own
    // key instead — same in-place takeover, just keyed differently.
    const reclaimKey =
      findReclaimableEndedSlot(reclaimCandidates, targetSessionId) ??
      findReclaimableEndedSlotByKey(reclaimCandidates, targetKey);
    if (reclaimKey) {
      setSessions((prev) =>
        prev.map((s) =>
          s.key === reclaimKey
            ? {
                ...s,
                origin: payload?.resume || payload?.resumeId ? "resume" : payload?.taskId ? "task" : "toolbar",
                taskId: payload?.taskId,
                taskTitle: payload?.taskTitle,
                // Card 3bf262ac (tab rename): match the pristine-slot and
                // fresh-entry branches below — a reclaimed tab picks up
                // whatever displayName this launch carries (usually
                // undefined, falling back to the derived label) rather than
                // silently keeping a stale custom rename from its dead
                // session.
                displayName: payload?.displayName,
                ideaId: payload?.ideaId ?? ideaId,
                launchSeq: s.launchSeq + 1,
                launchPayload: payload ?? null,
              }
            : s,
        ),
      );
      setActiveKey(reclaimKey);
      return;
    }

    const pristineKey = findPristineSlot(
      currentSessions.map((s) => ({ key: s.key, launchSeq: s.launchSeq, hasAttach: !!s.attach })),
    );
    if (pristineKey) {
      setSessions((prev) =>
        prev.map((s) =>
          s.key === pristineKey
            ? {
                ...s,
                origin: payload?.resume || payload?.resumeId ? "resume" : payload?.taskId ? "task" : "toolbar",
                taskId: payload?.taskId,
                taskTitle: payload?.taskTitle,
                displayName: payload?.displayName,
                // Cross-board resume fix: resolves to a concrete idea even
                // when the payload doesn't specify one (board/task launches
                // always mean "here") — see SessionEntry.ideaId's doc.
                ideaId: payload?.ideaId ?? ideaId,
                launchSeq: s.launchSeq + 1,
                launchPayload: payload ?? null,
              }
            : s,
        ),
      );
      setActiveKey(pristineKey);
      return;
    }

    const entry: SessionEntry = {
      key: freshSessionKey(),
      origin: payload?.resume || payload?.resumeId ? "resume" : payload?.taskId ? "task" : "toolbar",
      taskId: payload?.taskId,
      taskTitle: payload?.taskTitle,
      displayName: payload?.displayName,
      ideaId: payload?.ideaId ?? ideaId,
      createdAt: Date.now(),
      launchSeq: 1,
      launchPayload: payload ?? null,
    };
    setSessions((prev) => [...prev, entry]);
    setActiveKey(entry.key);
    // Mirrors launch_claude_code_clicked's pattern — fired only for a GENUINE
    // 2nd+ tab (the pristine-slot reuse above is still the board's first tab,
    // same as P1, and isn't a "multi-session" event).
    posthogRef.current?.capture("terminal_tab_opened", { origin: entry.origin });
  }, [ideaId]);

  // Session entry chooser (card cbe60db5, F1; rework 11 fixes the gate below).
  // The actual entry point every launch source (toolbar bus event,
  // task-launch bus event, "+") calls. Always consults `entryDecisionRef`
  // — NOT gated on whether a local tab already exists — so a launch fired
  // while another tab is open (or actively connected) still routes through
  // the chooser instead of blindly minting a duplicate/parallel session
  // whenever the registry knows about other live/recent sessions.
  const deliverLaunch = useCallback(
    (payload: BrowserLaunchPayload | null) => {
      if (entryDecisionRef.current === null) {
        // Bug B (rework 9): the registry fetch that decides chooser-vs-mint
        // hasn't resolved yet — null here means "don't know", NOT
        // "empty-launch". Queue regardless of how many tabs are already
        // open — the seed/replay effect below (keyed on `entryDecision`)
        // replays this the instant it settles, picking the body-swap or the
        // overlay exactly as this function would have, had the fetch simply
        // finished first.
        setExpanded(true);
        setPendingLaunch(payload);
        deferredLaunchPendingRef.current = true;
        return;
      }
      if (payload?.taskId) {
        // Task-launch-skip-chooser (Nick's explicit product decision,
        // 2026-08-16): a task-specific launch is unambiguous intent — it
        // NEVER routes through the full cross-board chooser, regardless of
        // `entryDecisionRef.current.kind`. It keys ONLY on whether THIS
        // exact task already has a live-or-recent match; unrelated sessions
        // elsewhere (which would put the global decision at "chooser") are
        // irrelevant here.
        const match = findTaskSessionMatch(chooserSectionsRef.current, payload.taskId);
        if (!match) {
          mintAndDeliver(payload);
          return;
        }
        setExpanded(true);
        setPendingLaunch(payload);
        setTaskChoiceOpen(true);
        return;
      }
      if (entryDecisionRef.current.kind === "chooser") {
        // Rework 11 (card cbe60db5): no longer gated on
        // `sessionsRef.current.length === 0`. With no local tabs there's
        // nothing to protect, so it's today's unchanged full dock-body swap
        // (`showingChooser` below); with a tab already open, the SAME
        // chooser renders in a non-destructive overlay instead
        // (`chooserOpen`) — the existing tab stays mounted, connected, and
        // visible underneath.
        setExpanded(true);
        setPendingLaunch(payload);
        if (sessionsRef.current.length > 0) setChooserMode("launch");
        return;
      }
      mintAndDeliver(payload);
    },
    [mintAndDeliver],
  );

  // The "In the browser" menu item (board toolbar) and task-card menus fire the
  // launch bus; forward every event to the routing decision above. Called
  // unconditionally (Rules of Hooks) — `enabled` is checked inside, same as
  // every effect in use-terminal-session.ts.
  useEffect(() => {
    if (!enabled) return;
    return subscribeBrowserLaunch((payload) => deliverLaunch(payload ?? null));
  }, [enabled, deliverLaunch]);

  const handlePlus = useCallback(() => {
    // Card 7ee218b1: the "+" now also shows at 1 session, where the
    // pristine slot may already be consumed OR may not be — either way this
    // just delivers a launch (B7) and lets `deliverLaunch` decide: mint
    // directly, or show the chooser overlay if another live session exists
    // to choose between (same routing a launch always goes through).
    deliverLaunch(null);
  }, [deliverLaunch]);

  // ── reattach (chooser Reconnect, instant-continue, ?reconnect=<sid>) ───────
  // Sibling to `mintAndDeliver`: mints NOTHING new (F2 — the reattach route
  // is exempt from the cap/rate-limit) and reuses the pristine-slot rule
  // (`findPristineSlot`) so, in the rare case an attach entry is the dock's
  // sole existing tab and ANOTHER reattach is requested, it doesn't leak a
  // stray idle slot either. `focus` controls whether the dock expands to
  // show the result immediately (an explicit chooser/My-sessions click) or
  // stays collapsed (instant-continue — attach quietly, reopening feels
  // instant, design's veto-note wording: "the refresher never even notices
  // the reload").
  const performReattach = useCallback(async (sid: string, opts: { focus: boolean }) => {
    setChooserBusy(true);
    try {
      const res = await fetch("/api/terminal/session/reattach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sid }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        toast.error(body?.error || "Couldn't reconnect — the session may have just ended.", {
          action: { label: "Retry", onClick: () => void performReattach(sid, opts) },
        });
        void refreshRegistry(); // the row may have just ended/expired — let the chooser reflect that
        return;
      }
      const data = (await res.json()) as {
        sessionId: string;
        browserToken: string;
        bridgeToken?: string;
        helperToken?: string;
        cwd?: string | null;
        claudeSessionId?: string | null;
        displayName?: string | null;
      };
      const snapshot = loadSessionSnapshot(sid);
      const initialBuffer = snapshot ? toReconnectBuffer(snapshot) : null;
      // Bug cbe60db5-followup: forward the registry's cwd/claudeSessionId
      // (now included in the reattach response) into the attach pair, so
      // attachToExisting can seed them — otherwise a reattached session that
      // later ends never offers "Resume this conversation".
      //
      // Reconnect-relaunch fix: forward bridgeToken/helperToken too (now also
      // included in the reattach response) — attachToExisting fires the
      // vibecodes:// deep link when these are present, which is what
      // actually relaunches the local helper instead of leaving the browser
      // leg waiting passively forever.
      const attach: AttachExistingPair = {
        sessionId: data.sessionId,
        browserToken: data.browserToken,
        bridgeToken: data.bridgeToken,
        helperToken: data.helperToken,
        initialBuffer,
        cwd: data.cwd,
        claudeSessionId: data.claudeSessionId,
      };

      const currentSessions = sessionsRef.current;
      const pristineKey = findPristineSlot(
        currentSessions.map((s) => ({ key: s.key, launchSeq: s.launchSeq, hasAttach: !!s.attach })),
      );
      const entry: SessionEntry = {
        key: pristineKey ?? freshSessionKey(),
        origin: "reconnect",
        taskId: undefined,
        taskTitle: undefined,
        // Card 3bf262ac AC 3: a reload-reattached (or manually reconnected)
        // live tab shows its custom name — the registry row's own
        // display_name, forwarded by the reattach route. Unlike taskId/
        // taskTitle just above (deliberately NOT carried across a reattach —
        // see this constant's own history), a rename is exactly what AC 3
        // requires surviving a reload.
        displayName: data.displayName ?? undefined,
        // A reattach always runs already ON the row's own board — a
        // cross-board live row goes through handleChooserOpenBoardAndReconnect
        // (navigate first, `?reconnect=` picks it up here), never straight
        // to performReattach — so the current board IS the correct one.
        ideaId,
        createdAt: Date.now(),
        launchSeq: 0,
        launchPayload: null,
        attach,
        showReconnectedNoHistoryNote: !initialBuffer,
      };
      setSessions((prev) => (pristineKey ? prev.map((s) => (s.key === pristineKey ? entry : s)) : [...prev, entry]));
      setActiveKey(entry.key);
      if (opts.focus) setExpanded(true);
      posthogRef.current?.capture("terminal_session_reconnected", { instant: !opts.focus });
    } catch (err) {
      logger.error("Terminal reattach failed", { sid, error: err instanceof Error ? err.message : String(err) });
      toast.error("Couldn't reconnect — check your connection and try again.");
    } finally {
      setChooserBusy(false);
    }
  }, [refreshRegistry, ideaId]);

  // F1's empty-launch state ("today's open→launch behaviour remains") and
  // the instant-continue variant (design's veto note, Nick: yes) are both
  // driven off `entryDecision` the moment it resolves — neither waits for
  // the user to open the dock. Guarded on `sessions.length === 0` so this
  // only ever seeds/attaches ONCE per pageview; every launch after that is
  // real user action.
  const instantContinueTriggeredRef = useRef(false);
  useEffect(() => {
    if (!entryDecision) return;
    // Bug B (card cbe60db5 rework 9) / rework 11: a launch that raced the
    // still-loading registry (`deliverLaunch` queued it via
    // `deferredLaunchPendingRef` instead of guessing) gets resolved HERE, the
    // instant the real decision is known — regardless of how many tabs exist
    // by then — taking priority over the passive empty-launch/instant-
    // continue defaults below, exactly as if the fetch had finished before
    // the click that triggered it.
    if (deferredLaunchPendingRef.current) {
      deferredLaunchPendingRef.current = false;
      if (pendingLaunch?.taskId) {
        // Task-launch-skip-chooser: the same per-task predicate
        // `deliverLaunch` uses, replayed here now that the registry (and so
        // `chooserSections`) has actually resolved — never the global
        // `entryDecision.kind`, which would wrongly route on unrelated
        // sessions elsewhere.
        const match = findTaskSessionMatch(chooserSections, pendingLaunch.taskId);
        if (!match) {
          const payload = pendingLaunch;
          setPendingLaunch(null);
          mintAndDeliver(payload);
          return;
        }
        // `pendingLaunch` stays set — `TerminalTaskLaunchChoice` reads it below.
        setTaskChoiceOpen(true);
        return;
      }
      if (entryDecision.kind === "chooser") {
        // `deliverLaunch` already expanded the dock and set `pendingLaunch`.
        // With no local tabs, `showingChooser` renders the body-swap chooser
        // from that state alone — nothing else to do. With a tab already
        // open, `deliverLaunch` couldn't know the resolved kind yet at queue
        // time, so the overlay hasn't been shown — open it now,
        // non-destructively.
        if (sessions.length > 0) setChooserMode("launch");
        return;
      }
      const payload = pendingLaunch;
      setPendingLaunch(null);
      mintAndDeliver(payload);
      return;
    }
    if (sessions.length > 0) return; // a real tab already exists — nothing left to seed
    if (entryDecision.kind === "empty-launch") {
      const fresh = createPristineEntry();
      setSessions([fresh]);
      setActiveKey(fresh.key);
    } else if (entryDecision.kind === "instant-continue" && !instantContinueTriggeredRef.current) {
      instantContinueTriggeredRef.current = true;
      // Multi-terminal reload restore: reattach EVERY session this tab held,
      // not just the last-attached one. Each call appends its own dock tab as
      // its fetch resolves (functional setSessions updates — concurrent
      // resolutions can't clobber each other).
      for (const sid of entryDecision.sids) void performReattach(sid, { focus: false });
    }
    // "chooser": nothing to seed — the chooser renders in the body below.
  }, [entryDecision, sessions.length, performReattach, pendingLaunch, mintAndDeliver, chooserSections]);

  // Cross-board resume fix (bug 62e57071, Sentinel's investigation): a
  // Recent row can belong to ANY board — chooser-data.ts's Recent section is
  // deliberately never idea-scoped, so the user can reach it from any board
  // they're currently viewing (see deriveChooserSections' header comment and
  // its own test coverage for "still offered"). Minting straight into
  // `mintAndDeliver` from a click on such a row used to mint under
  // WHICHEVER board's dock was mounted, carrying the row's foreign
  // taskId/cwd along for the ride — the origination point of the bug.
  // `handleChooserResume`/`handleTaskChoiceReconnect`'s recent arm below
  // mirror `handleChooserOpenBoardAndReconnect`'s live-row pattern (defined
  // further below): navigate to the row's OWN board first (`?resume=<sid>`,
  // this file's sibling to
  // `?reconnect=<sid>`, handled by the effect just below) and let THAT
  // board's dock fire the mint once mounted there — never mint in place
  // under the wrong one. Declared up here (ahead of the `?resume=` effect
  // that also uses it) so both that effect and the click handlers below
  // share one payload-building rule.
  const buildResumePayload = useCallback(
    (row: ChooserRecentRow): BrowserLaunchPayload => ({
      // F4's Resume: the EXISTING (capped) launch flow, carrying the ended
      // row's own recorded folder instead of a bootstrap prompt — see
      // BrowserLaunchPayload's doc and use-terminal-session.ts's
      // fireLaunchDeepLink. A row with a tracked `claudeSessionId` (rework 5,
      // exact-conversation Resume) fires `claude --resume <id>` — the exact
      // conversation the row described, never whatever else has run in that
      // folder since; a row without one falls back to the legacy
      // `claude --continue`.
      resume: row.claudeSessionId ? undefined : true,
      resumeId: row.claudeSessionId ?? undefined,
      cwd: row.cwd ?? undefined,
      taskId: row.taskId ?? undefined,
      taskTitle: row.taskTitle ?? undefined,
      // Terminal sessions need names that stick (card 3bf262ac, AC 4): a
      // renamed ended row's name rides the fresh mint Resume produces,
      // exactly like taskId/taskTitle already do.
      displayName: row.displayName ?? undefined,
      ideaId: row.ideaId,
    }),
    [],
  );

  // ── other-board Reconnect (`?reconnect=<sid>`, design item 2) ──────────────
  // "Open board & reconnect" navigates here with the target sid on the URL;
  // once the registry confirms it, reattach immediately (no second chooser —
  // the click on the OTHER board's chooser was already the informed
  // confirmation, F3) and strip the param without a server round-trip (same
  // recipe as kit-applied-toast.tsx — this board route is force-dynamic).
  const reconnectParam = searchParams.get("reconnect");
  const reconnectHandledRef = useRef(false);
  useEffect(() => {
    if (!reconnectParam || reconnectHandledRef.current || registryRows === null) return;
    reconnectHandledRef.current = true;
    const params = new URLSearchParams(window.location.search);
    params.delete("reconnect");
    const qs = params.toString();
    window.history.replaceState(null, "", `${pathname}${qs ? `?${qs}` : ""}`);
    void performReattach(reconnectParam, { focus: true });
  }, [reconnectParam, registryRows, pathname, performReattach]);

  // ── cross-board Resume (`?resume=<sid>`, cross-board resume fix 62e57071) ──
  // Sibling to the `?reconnect=<sid>` effect just above, for a Recent (ended)
  // row instead of a live one: handleChooserResume /
  // handleTaskChoiceReconnect's recent arm navigate here with the target
  // row's sid rather than minting under whichever board was open when the
  // user clicked. chooser-data.ts's Recent section is deliberately NOT
  // idea-scoped (see its header comment + tests), so this board's own
  // `chooserSections.recent` — built from the SAME idea-unscoped registry
  // fetch every board's dock makes — already carries the identical row; look
  // it up by sid and fire the exact mint `handleChooserResume` would have,
  // now that we're actually on the row's own board. A row that's vanished
  // by the time this runs (expired past 48h, machine-identity filtered,
  // etc.) surfaces as a toast rather than silently doing nothing.
  const resumeParam = searchParams.get("resume");
  const resumeHandledRef = useRef(false);
  useEffect(() => {
    if (!resumeParam || resumeHandledRef.current || registryRows === null) return;
    resumeHandledRef.current = true;
    const params = new URLSearchParams(window.location.search);
    params.delete("resume");
    const qs = params.toString();
    window.history.replaceState(null, "", `${pathname}${qs ? `?${qs}` : ""}`);
    const row = chooserSectionsRef.current.recent.find((r) => r.sid === resumeParam);
    if (!row) {
      toast.error("Couldn't find that session to resume — it may have expired.");
      return;
    }
    mintAndDeliver(buildResumePayload(row), row.sid);
  }, [resumeParam, registryRows, pathname, mintAndDeliver, buildResumePayload]);

  // ── chooser action handlers ─────────────────────────────────────────────────
  // Shared by BOTH the sessions.length === 0 body-swap chooser and the
  // sessions.length > 0 overlay (rework 11) — the `setChooserMode(null)` in
  // each is a no-op when it was never opened (the body-swap case). These are
  // the ways to close the overlay by ACTING; `handleChooserDismiss` below is
  // the way to close it by walking away, and both are always available.
  const handleChooserStartNew = useCallback(() => {
    const payload = pendingLaunch;
    const originKey = chooserOriginKey;
    setPendingLaunch(null);
    setChooserOriginKey(null);
    setChooserMode(null);
    mintAndDeliver(payload, null, originKey);
  }, [pendingLaunch, chooserOriginKey, mintAndDeliver]);

  // Nick, 2026-08-19: "HOW THE HELL AM I GOING TO CLOSE THIS?" — the
  // launch-mode overlay was a dead end by design (forced choice: no close
  // button, Escape and outside-click both suppressed). That was wrong. A
  // fired launch has minted NOTHING yet — the chooser's whole point is that
  // no session exists until a click — so abandoning it costs nothing and
  // leaves no orphan: dropping `pendingLaunch` returns the dock to exactly
  // the state it was in before the launch event arrived. Every modal needs a
  // way out.
  const handleChooserDismiss = useCallback(() => {
    setPendingLaunch(null);
    setChooserOriginKey(null);
    setChooserMode(null);
  }, []);

  const handleChooserReconnectHere = useCallback(
    (row: ChooserLiveRow) => {
      setPendingLaunch(null);
      setChooserOriginKey(null);
      setChooserMode(null);
      void performReattach(row.sid, { focus: true });
    },
    [performReattach],
  );

  const handleChooserOpenBoardAndReconnect = useCallback(
    (row: ChooserLiveRow) => {
      setChooserOriginKey(null);
      setChooserMode(null);
      router.push(`/ideas/${row.ideaId}/board?reconnect=${encodeURIComponent(row.sid)}`);
    },
    [router],
  );

  const handleChooserResume = useCallback(
    (row: ChooserRecentRow) => {
      setPendingLaunch(null);
      setChooserOriginKey(null);
      setChooserMode(null);
      if (row.ideaId !== ideaId) {
        router.push(`/ideas/${row.ideaId}/board?resume=${encodeURIComponent(row.sid)}`);
        return;
      }
      // F4's Resume: the EXISTING (capped) launch flow, carrying the ended
      // row's own recorded folder instead of a bootstrap prompt — see
      // BrowserLaunchPayload's doc and use-terminal-session.ts's
      // fireLaunchDeepLink. A row with a tracked `claudeSessionId` (rework 5,
      // exact-conversation Resume) fires `claude --resume <id>` — the exact
      // conversation the row described, never whatever else has run in that
      // folder since; a row without one falls back to the legacy
      // `claude --continue`. Now built by `buildResumePayload` above, which
      // this exact payload shape moved into (cross-board resume fix) so the
      // `?resume=` landing effect can build the identical payload.
      mintAndDeliver(buildResumePayload(row), row.sid);
    },
    [mintAndDeliver, buildResumePayload, ideaId, router],
  );

  // The ended panel's "View my other sessions" link (Nick's field report
  // 2026-08-19). It used to call `openMySessions`, which opens a panel that
  // filters to `status === "active"` by construction — so from an ended
  // session it showed a list that could never contain the ended/resumable
  // rows the wording promises. This opens the chooser instead: the same
  // component the launch flow uses, which has the "Recent — ended in the last
  // 48h" section with its per-row Resume.
  //
  // Refreshes first because the session the user just ended is very likely
  // NOT in `registryRows` as ended yet — without this the chooser would open
  // missing the very row they came looking for. `refreshRegistry` swallows
  // and toasts its own failures, so a stale-but-present list still opens
  // rather than the link doing nothing.
  const openChooserToBrowse = useCallback((originKey?: string | null) => {
    setChooserOriginKey(originKey ?? null);
    setChooserMode("browse");
    void refreshRegistry();
  }, [refreshRegistry]);

  // Task-launch-skip-chooser: the minimal task-scoped choice's two actions.
  // Re-derives the match from the CURRENT `chooserSections` (rather than
  // trusting a stale value captured when the dialog opened) so a registry
  // refresh in the meantime — the row expiring past 48h, for instance — is
  // never acted on with a match that no longer exists.
  const handleTaskChoiceReconnect = useCallback(() => {
    const taskId = pendingLaunch?.taskId;
    const match = taskId ? findTaskSessionMatch(chooserSectionsRef.current, taskId) : null;
    setPendingLaunch(null);
    setTaskChoiceOpen(false);
    if (!match) return; // the match expired between render and click — nothing safe to reconnect to
    if (match.kind === "recent") {
      // Same cross-board fix as handleChooserResume just above — a task's
      // matched Recent row can belong to a different board than the one the
      // task-launch button was clicked from (chooser-data.ts's Recent isn't
      // idea-scoped), so this arm must navigate-then-mint too, not mint here.
      const row = match.row;
      if (row.ideaId !== ideaId) {
        router.push(`/ideas/${row.ideaId}/board?resume=${encodeURIComponent(row.sid)}`);
        return;
      }
      mintAndDeliver(buildResumePayload(row), row.sid);
      return;
    }
    if (match.kind === "live-here") {
      void performReattach(match.row.sid, { focus: true });
    } else {
      router.push(`/ideas/${match.row.ideaId}/board?reconnect=${encodeURIComponent(match.row.sid)}`);
    }
  }, [pendingLaunch, mintAndDeliver, buildResumePayload, ideaId, performReattach, router]);

  const handleTaskChoiceStartFresh = useCallback(() => {
    const payload = pendingLaunch;
    setPendingLaunch(null);
    setTaskChoiceOpen(false);
    mintAndDeliver(payload);
  }, [pendingLaunch, mintAndDeliver]);

  // Propagation fix (Sentinel's finding — "perpetuates a mis-file forever"):
  // an already-mounted tab's OWN "Resume this conversation" button
  // (terminal-session-view.tsx's `handleResume`) must obey the same
  // board-correctness the chooser/task-choice Resume actions above do, or a
  // session that was ever mis-filed onto the wrong board keeps re-minting
  // under that same wrong board every time someone clicks Resume on it —
  // patching only the chooser closes the ORIGINATION point but leaves this
  // one still capable of perpetuating an existing mis-file forever.
  // `payload.ideaId` comes from `entry.ideaId` (see SessionEntry's doc) —
  // undefined for a `reconnect`-origin entry or anything that predates this
  // fix. Unknown honestly stays on the current board rather than guessing
  // (same "only act on a disagreement we can actually see" spirit as
  // chooser-data.ts's machine-identity filter) — there is no way to recover
  // the TRUE board for a session that was mis-filed before this field
  // existed; see this card's return value for that limitation.
  const handleResumeEndedSession = useCallback(
    (payload: BrowserLaunchPayload, sid: string | null) => {
      if (payload.ideaId && payload.ideaId !== ideaId && sid) {
        router.push(`/ideas/${payload.ideaId}/board?resume=${encodeURIComponent(sid)}`);
        return;
      }
      // The ended panel's own tab is very likely the reclaim target — `sid`
      // is `pair?.sessionId`, this tab's own last-known session id, so
      // `mintAndDeliver`'s reclaim check (`findReclaimableEndedSlot`) finds
      // and takes over THIS tab rather than opening a new one next to it.
      mintAndDeliver(payload, sid);
    },
    [ideaId, mintAndDeliver, router],
  );

  // Back out of the task-scoped choice without launching anything — see the
  // note in terminal-task-launch-choice.tsx. Drops the pending launch so the
  // dialog can't reopen against a payload nobody asked for any more.
  const handleTaskChoiceCancel = useCallback(() => {
    setPendingLaunch(null);
    setTaskChoiceOpen(false);
  }, []);

  // My sessions panel Reconnect (design item 9) — the SAME reattach flow;
  // "this board" attaches in place, any other board navigates + reconnects.
  const handleMySessionsReconnect = useCallback(
    (sid: string, targetIdeaId: string) => {
      setMySessionsOpen(false);
      if (targetIdeaId === ideaId) {
        void performReattach(sid, { focus: true });
      } else {
        router.push(`/ideas/${targetIdeaId}/board?reconnect=${encodeURIComponent(sid)}`);
      }
    },
    [ideaId, performReattach, router],
  );

  const handleTabKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>, index: number, key: string) => {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const dir = e.key === "ArrowRight" ? 1 : -1;
        const next = sessions[(index + dir + sessions.length) % sessions.length];
        document.getElementById(`terminal-tab-${next.key}`)?.focus();
      } else if (e.key === "Home") {
        e.preventDefault();
        document.getElementById(`terminal-tab-${sessions[0].key}`)?.focus();
      } else if (e.key === "End") {
        e.preventDefault();
        document.getElementById(`terminal-tab-${sessions[sessions.length - 1].key}`)?.focus();
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setExpanded(true);
        disarmCloseIfSwitching(key);
        // Split view: keyboard activation must reach the SAME pane-aware
        // decision the click handler does (§8 "keyboard reachability") — a
        // blind setActiveKey here would desync `activeKey` from whichever
        // pane is actually focused, and skip the focus-move announcement.
        if (splitActive) handleSplitTabClick(key);
        else setActiveKey(key);
      } else if (e.key === "Delete") {
        e.preventDefault();
        requestClose(key);
      } else if (e.key === "Escape" && confirmingKey === key) {
        e.preventDefault();
        cancelClose();
      } else if (e.key === "F2" && activeKey === key) {
        // Desktop accelerator (design §2) — additive only, the pencil stays
        // the primary/taught path. Only fires on the ACTIVE tab, matching
        // the pencil's own active-only visibility.
        e.preventDefault();
        openTabRename(key);
      }
    },
    [
      sessions,
      requestClose,
      confirmingKey,
      cancelClose,
      activeKey,
      openTabRename,
      splitActive,
      handleSplitTabClick,
      disarmCloseIfSwitching,
    ],
  );

  if (!enabled) return null;

  const terminalModelLine =
    platformTerminalDefault === undefined || viewerTerminalModel === undefined
      ? null
      : terminalLaunchModelLine(
          resolveEffectiveTerminalModel({ userValue: viewerTerminalModel, platformValue: platformTerminalDefault }),
          resolveTerminalModelSource({ userValue: viewerTerminalModel, platformValue: platformTerminalDefault })
        );
  const activeSummary = summaries[activeKey];
  const activeStatus: TerminalStatus = activeSummary?.status ?? "idle";
  const multi = sessions.length > 1;
  const activeIsPoppedOut = poppedOutKeys.has(activeKey);
  const soleIsPoppedOut = !multi && !!sessions[0] && poppedOutKeys.has(sessions[0].key);
  // Session entry chooser (card cbe60db5): the dock's resting state for this
  // pageview — no local tab yet, and the registry says there's something to
  // choose between (mockup A1's collapsed header + A2's chooser body).
  // Task-launch-skip-chooser: excludes `taskChoiceOpen` — the board's
  // resting state (nothing minted yet, and SOME unrelated live/recent
  // session exists somewhere) would otherwise still satisfy this predicate
  // while a task-scoped launch's minimal choice is the one interstitial
  // that's actually allowed to show; the full chooser must never render
  // underneath/alongside it.
  const showingChooser = sessions.length === 0 && entryDecision?.kind === "chooser" && !taskChoiceOpen;
  // Is ANY open tab still a running session? Drives whether a browse opens
  // in the panel or as an overlay (below). Mirrors `requestClose`'s liveness
  // test exactly, including its popped-out caveat: a popped tab's own
  // reported status is usually mid-preemption ("error"/duplicate) while the
  // session is very much alive in the other window, so it must never be read
  // as finished here either. "idle"/"connecting" count as live — a tab
  // mid-launch is about to be a real session, and swapping the panel out
  // from under it would be exactly the disruption this is avoiding.
  const anyTabLive = sessions.some(
    (s) => poppedOutKeys.has(s.key) || isLiveTabStatus(summaries[s.key]?.status ?? "idle"),
  );
  // Nick's follow-up, 2026-08-19: "why a popup rather than just showing this
  // in the terminal panel?" The overlay exists to protect a LIVE terminal
  // underneath — swapping the panel's body would tear down its xterm
  // instance, socket and scrollback. That reason evaporates when every open
  // tab has ended: there's nothing running to disturb, so the list belongs
  // in the panel like it already does when there are no tabs at all
  // (`showingChooser`), rather than floating over a dimmed board for no gain.
  //
  // Browsing only — a launch keeps the overlay whatever the tab states are,
  // because it also has to sit ON TOP of the forced-choice guarantee (and
  // with no live tab it would be showing over a body that's about to be
  // replaced anyway).
  const inlineBrowse = chooserMode === "browse" && sessions.length > 0 && !anyTabLive;
  const pendingTask = pendingLaunch?.taskId
    ? { taskId: pendingLaunch.taskId, taskTitle: pendingLaunch.taskTitle ?? "" }
    : null;
  // Task-launch-skip-chooser: re-derived every render (not cached at the
  // moment the dialog opened) so a registry refresh while it's showing —
  // e.g. the matched row expiring past the 48h recent window — is always
  // reflected; `taskChoiceOpen` alone gates whether the dialog is mounted.
  const pendingTaskMatch: TaskSessionMatch | null = pendingLaunch?.taskId
    ? findTaskSessionMatch(chooserSections, pendingLaunch.taskId)
    : null;

  // Task c4ca2d95 ("Terminal starting model") — the per-task dialog's terser
  // variant (chooser footer's own `terminalModelLine` is computed earlier,
  // before the `!enabled` early return, alongside the hook calls it needs).
  const terminalTaskDialogModelLine =
    platformTerminalDefault === undefined || viewerTerminalModel === undefined
      ? null
      : terminalDialogModelLine(
          resolveEffectiveTerminalModel({ userValue: viewerTerminalModel, platformValue: platformTerminalDefault }),
          resolveTerminalModelSource({ userValue: viewerTerminalModel, platformValue: platformTerminalDefault })
        );

  // Substitute "popped-out" for any tab the dock knows it popped — its real
  // status is usually mid-preemption at this exact moment and would
  // otherwise misread as an error in the collapsed-bar summary (design §5).
  const displayStatusFor = (key: string): TabDisplayStatus =>
    poppedOutKeys.has(key) ? "popped-out" : (summaries[key]?.status ?? "idle");

  const statusChips = multi ? summarizeSessionStatuses(sessions.map((s) => displayStatusFor(s.key))) : [];
  const singleView = activeSummary
    ? resolveDockView(activeSummary.status, activeSummary.launchPhase, activeSummary.platformSupported, activeSummary.paired)
    : "setup";
  const singleMeta = dockStatusMeta(singleView, activeSummary?.errorKind ?? null);

  return (
    <div
      // `dockInsetRef` measures this element and publishes its height as
      // `--vc-term-dock-inset`, which the board page reserves as bottom
      // padding. Without it this fixed overlay covers the last cards of every
      // column with no way to scroll to them (card 534d2049).
      ref={dockInsetRef}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-700 bg-[#141417] text-zinc-200 shadow-[0_-8px_30px_rgba(0,0,0,0.4)]"
      style={dockHeight.rootStyle}
    >
      {/* Drag-to-resize handle on the top edge (card b885ebfd). Only while
          expanded AND at least one session body is rendered — collapsed there
          is nothing to size, and the chooser/loading faces size themselves.
          The remembered height still applies the moment the dock re-expands
          (the CSS variable on the root above is always set). Also hidden
          while the active tab is popped out (card 534d2049 rework): its face
          is the compact placeholder, which sizes itself to its content, not
          `--vc-term-dock-h` — there is nothing to resize, and a live handle
          sitting over a collapsed placeholder invites a confusing drag. */}
      {expanded && sessions.length > 0 && !activeIsPoppedOut && <TerminalDockResizeHandle controller={dockHeight} />}

      {/* Shared aria-live region — background-tab attention only (a11y §14). */}
      <div aria-live="polite" role="status" className="sr-only">
        {announcement}
      </div>

      {/* Collapsed dock bar — always visible */}
      <div className="flex items-center gap-2.5 px-3 py-1.5">
        <span className="inline-flex items-center gap-2 text-xs font-semibold">
          {!multi && sessions.length > 0 && (
            <Circle
              className={cn("h-2.5 w-2.5 fill-current", activeIsPoppedOut ? "text-violet-400" : dotClass(activeStatus))}
            />
          )}
          <TerminalIcon className="h-3.5 w-3.5 text-zinc-400" />
          <span className="hidden sm:inline">{multi ? "Terminals" : "Terminal"}</span>
          {!multi && activeSummary?.sessionId && (
            <span className="hidden font-mono text-[11px] font-normal text-zinc-500 md:inline">
              · session {activeSummary.sessionId.slice(0, 8)}
            </span>
          )}
        </span>
        <span className="ml-auto inline-flex items-center gap-1.5">
          {/* Card eaa55290: persistent, glanceable warning — visible in BOTH
              collapsed and expanded states (this whole bar is, unlike the
              body below it) — the moment more than one of this user's own
              sessions is live on THIS board. Phase 1 only (see the
              investigation step): `terminal_sessions` RLS is owner-only, so
              every `liveHere` row is guaranteed to be this same person's,
              never a collaborator's — the copy says "tab", never "someone
              else". */}
          {otherLiveHere.length > 0 && (
            <span
              className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/50 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-300"
              title={`Also open here: ${otherLiveHere.map((r) => r.taskTitle ?? r.cwd ?? "another folder").join(", ")}`}
            >
              <span aria-hidden="true">⚠</span>
              {otherLiveHere.length === 1
                ? "Another tab is open here"
                : `${otherLiveHere.length} other tabs are open here`}
            </span>
          )}
          {/* Mockup A1: header count pills, only while the chooser is the
              resting state — real text, never badge-only (a11y, design §2). */}
          {showingChooser && registryRows === null && (
            <span className="inline-flex items-center gap-1 text-[11px] text-zinc-500">
              <Loader2 className="h-3 w-3 animate-spin" /> Checking your sessions…
            </span>
          )}
          {showingChooser && chooserCounts.here > 0 && (
            <span className="rounded-md border border-sky-500/50 bg-sky-500/10 px-2 py-0.5 text-[11px] font-semibold text-sky-300">
              {chooserCounts.here} running here
            </span>
          )}
          {showingChooser && chooserCounts.elsewhere > 0 && (
            <span className="rounded-md border border-zinc-600 bg-zinc-800/60 px-2 py-0.5 text-[11px] font-semibold text-zinc-400">
              {chooserCounts.elsewhere} on another board
            </span>
          )}
          {showingChooser && chooserCounts.recent > 0 && (
            <span className="rounded-md border border-zinc-600 bg-zinc-800/60 px-2 py-0.5 text-[11px] font-semibold text-zinc-400">
              {chooserCounts.recent} recent
            </span>
          )}
          {sessions.length > 0 &&
            multi &&
            statusChips.map((chip) => (
              <span
                key={chip.label}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10.5px] font-bold",
                  chip.tone === "ok" && "border-emerald-500/50 bg-emerald-500/10 text-emerald-400",
                  chip.tone === "info" && "border-sky-500/50 bg-sky-500/10 text-sky-400",
                  chip.tone === "warn" && "border-amber-500/50 bg-amber-500/10 text-amber-400",
                  chip.tone === "err" && "border-rose-500/50 bg-rose-500/10 text-rose-400",
                  chip.tone === "popped" && "border-violet-500/50 bg-violet-500/10 text-violet-300",
                  chip.tone === "mut" && "border-zinc-600 bg-zinc-800/60 text-zinc-400",
                )}
              >
                <span aria-hidden="true">{chip.glyph}</span>
                {chip.label}
              </span>
            ))}
          {sessions.length > 0 && !multi && soleIsPoppedOut && (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-violet-500/50 bg-violet-500/10 px-2 py-0.5 text-[11px] font-semibold text-violet-300">
              <span aria-hidden="true">⧉</span> Popped out
            </span>
          )}
          {sessions.length > 0 && !multi && !soleIsPoppedOut && (
            <span className={cn("inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-semibold", singleMeta.className)}>
              <singleMeta.Icon className={cn("h-3 w-3", singleMeta.spin && "animate-spin")} />
              {singleMeta.label}
            </span>
          )}
        </span>
        <TerminalMySessionsPanel
          open={mySessionsOpen}
          onOpenChange={setMySessionsOpen}
          onCountChange={setMySessionsCount}
          onReconnect={handleMySessionsReconnect}
          onRenameSession={renameSession}
        >
          <Button
            variant="ghost"
            size="xs"
            className="text-zinc-300 hover:text-zinc-100"
            aria-label="My terminal sessions — every terminal running across your ideas"
            aria-haspopup="dialog"
          >
            <ListTree className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">My sessions</span>
            {!!mySessionsCount && (
              <span className="rounded-full border border-zinc-600 bg-zinc-800 px-1.5 text-[10px] font-bold text-sky-300">
                {mySessionsCount}
              </span>
            )}
          </Button>
        </TerminalMySessionsPanel>
        <Button
          variant="ghost"
          size="xs"
          className="text-zinc-300 hover:text-zinc-100"
          onClick={() => setExpanded((e) => !e)}
          aria-label={expanded ? "Collapse terminal panel" : showingChooser ? "Open terminal sessions" : "Expand terminal panel"}
          aria-expanded={expanded}
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
          <span className="hidden sm:inline">{expanded ? "Collapse" : showingChooser ? "Open" : "Expand"}</span>
        </Button>
      </div>

      {/* Expanded body — kept mounted (hidden when collapsed) so every tab's xterm
          instance and its scrollback survive collapse/expand and live bytes are
          never lost. */}
      <div className={cn("border-t border-zinc-800 bg-[#0c0c0e]", !expanded && "hidden")}>
        {sessions.length === 0 && registryRows === null && (
          <div className="flex items-center justify-center gap-2 px-4 py-10 text-[12.5px] text-zinc-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking your sessions…
          </div>
        )}

        {/* Inline browse needs a way back that `showingChooser` never did:
            with no tabs there's nothing behind the chooser to return to, but
            here an ended tab is sitting underneath with its scrollback
            intact ("The scrollback above is kept" — the ended panel's own
            promise), so backing out has to be possible without acting. */}
        {inlineBrowse && (
          <div className="flex items-center justify-between border-b border-zinc-800 bg-[#141417] px-3.5 py-1.5">
            <span className="text-[11.5px] font-semibold text-zinc-400">Your sessions</span>
            <Button
              variant="ghost"
              size="xs"
              className="text-zinc-400 hover:text-zinc-100"
              onClick={() => setChooserMode(null)}
            >
              <ChevronLeft className="h-3 w-3" /> Back to terminal
            </Button>
          </div>
        )}

        {(showingChooser || inlineBrowse) && (
          <TerminalSessionChooser
            sections={chooserSections}
            pendingTask={pendingTask}
            busy={chooserBusy}
            onReconnectHere={handleChooserReconnectHere}
            onOpenBoardAndReconnect={handleChooserOpenBoardAndReconnect}
            onResume={handleChooserResume}
            onStartNew={handleChooserStartNew}
            modelLine={terminalModelLine}
            onRenameSession={renameSession}
            helperStatus={helperStatus}
            onHelperUpdateSettled={refreshAfterHelperUpdate}
          />
        )}

        {/* Split view (design §6.4): both the tab strip (drag SOURCE) and the
            session body (drop TARGET, further below) live inside ONE
            DndContext so a drag can travel from one into the other —
            unconditional (not gated on `multi`/`inlineBrowse`) so the
            always-mounted session body underneath is never pulled in/out of
            it; nothing inside is actually draggable without 2+ tabs anyway. */}
        <DndContext
          sensors={dragSensors}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          {sessions.length > 0 && !inlineBrowse && (
            <>
            {/* Below-floor notice (design §5.8/§10.1, mockup D) — only while
                split is the standing preference but the window's too narrow
                for the CURRENT target pane count; dismissible, never blocks
                the toggle from being pressed again. Text depends on which
                pane count is being blocked (shipped 2-pane wording is
                unchanged; the 3-pane entry-block vs shrink-fallback wording
                differs per design §10.5). */}
            {splitPreferred === true && belowWidthFloor && paneCount !== 0 && !mobileViewport && !floorNoticeDismissed && (
              <div className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11.5px] text-amber-300">
                <span aria-hidden="true">ⓘ</span>
                <span className="flex-1">
                  {paneCount === 2
                    ? "Split view needs a wider window — it will come back automatically when there's room."
                    : forcedTabsNotice === "width-entry"
                      ? formatThirdPaneWidthBlockedAnnouncement()
                      : formatWidthFallbackThreeAnnouncement()}
                </span>
                <button
                  type="button"
                  aria-label="Dismiss"
                  className="text-amber-400 hover:text-amber-200"
                  onClick={() => setFloorNoticeDismissed(true)}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
            {/* D3's 4th-session cap (design §10.3 G-after) — sky, not amber:
                informational (nothing is lost, just re-laid-out), distinct
                from the width warning above. */}
            {forcedTabsNotice === "count" && !forcedTabsNoticeDismissed && (
              <div className="flex items-center gap-2 border-b border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-[11.5px] text-sky-300">
                <span aria-hidden="true">ⓘ</span>
                <span className="flex-1">{formatForcedTabsNoticeText()}</span>
                <button
                  type="button"
                  aria-label="Dismiss"
                  className="text-sky-400 hover:text-sky-200"
                  onClick={() => setForcedTabsNoticeDismissed(true)}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
            <div
              ref={tabStripRef}
              role="tablist"
              aria-label="Terminal sessions"
              className={cn(
                "flex items-stretch border-b bg-[#141417]",
                // Drag-to-dock (design §6.3 "Back to tabs" indicator): a
                // PANED tab dragged back up over the strip highlights it as
                // the un-split target, distinct from the ordinary border.
                dropZone === "strip" && draggingKey && paneKeys.includes(draggingKey) ? "border-sky-500/60" : "border-zinc-800",
              )}
            >
              {/* Tabs shrink then scroll; "+"/toggle (stripControls below)
                  stay pinned OUTSIDE the scroll region(s) so launch +
                  oversight are never scrolled away (design §4a: "never wrap,
                  never hide the '+'"). While split actually renders, the
                  strip abandons the flow layout and becomes the SAME flex
                  row as the pane row below — exactly N `flex-1` cells, so
                  each tab's edges are its pane's edges by construction
                  (design §10.2). No un-paned tab can ever live among them —
                  a popped-out session gets a corner chip instead (§10.4). */}
              {(() => {
              const renderTab = (entry: SessionEntry, index: number) => {
                const summary = summaries[entry.key];
                const status = summary?.status ?? "idle";
                const poppedOut = poppedOutKeys.has(entry.key);
                const meta = tabStatusMeta(displayStatusFor(entry.key));
                const tabIsLive = poppedOut || isLiveTabStatus(status);
                const label = deriveTabLabel({
                  displayName: entry.displayName,
                  taskTitle: entry.taskTitle,
                  ideaTitle,
                  sessionId: summary?.sessionId ?? null,
                });
                const isActive = entry.key === activeKey;
                const confirming = confirmingKey === entry.key;
                const renaming = renamingKey === entry.key;
                const renameLength = codePointLength(renameDraft);
                return (
                  <DraggableTab key={entry.key} id={entry.key} disabled={poppedOut || renaming || confirming}>
                    {({ setNodeRef, listeners }) => (
                  <div
                    ref={setNodeRef}
                    {...listeners}
                    id={`terminal-tab-${entry.key}`}
                    role="tab"
                    aria-selected={isActive}
                    tabIndex={isActive ? 0 : -1}
                    title={label}
                    onKeyDown={(e) => handleTabKeyDown(e, index, entry.key)}
                    onClick={() => {
                      setExpanded(true);
                      disarmCloseIfSwitching(entry.key);
                      if (splitActive) handleSplitTabClick(entry.key);
                      else setActiveKey(entry.key);
                    }}
                    className={cn(
                      "flex min-w-[110px] max-w-[190px] flex-none cursor-pointer items-center gap-1.5 border-r border-t-2 border-zinc-800 border-t-transparent px-2.5 py-0 text-[12.5px] text-zinc-400",
                      isActive && "border-t-sky-400 bg-[#0c0c0e] font-semibold text-zinc-100",
                      !isActive && "hover:bg-zinc-800/60 hover:text-zinc-100",
                      // Deliberately NO width change while renaming/confirming.
                      // This used to widen the armed tab (`max-w-[300px]
                      // flex-1`, briefly `max-w-none`) "so there's room to
                      // type"/read the confirm — but arming instantly reflows
                      // the whole strip of 110-190px tabs, and a click resolves
                      // at MOUSEUP: reflow between the arm click and the
                      // confirm click lands the confirm on a NEIGHBOUR tab's
                      // button (task 9f30ae15 — Nick clicked confirm on the
                      // tab he intended and a different session died). The
                      // fix is zero layout shift, full stop: the armed tab
                      // keeps its exact box, and the confirm/rename controls
                      // render inside it, truncating the label/input as
                      // needed rather than growing the tab.
                    )}
                  >
                    {renaming ? (
                      // Contents-swap (design §3a mid-edit) — same shape as
                      // the "End session?" confirm below, reusing the tab's
                      // shipped pattern rather than forking a new one.
                      // Nothing here ever unmounts TerminalSessionView; the
                      // terminal underneath keeps streaming untouched.
                      <>
                        <input
                          autoFocus
                          type="text"
                          dir="auto"
                          value={renameDraft}
                          placeholder={label}
                          aria-label="Session name"
                          onFocus={(e) => e.currentTarget.select()}
                          onChange={(e) =>
                            setRenameDraft(clampToCodePoints(e.target.value, DISPLAY_NAME_MAX_CODE_POINTS))
                          }
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => {
                            // The rename input must never exchange keystrokes
                            // with the tab strip's own key handling (arrow-key
                            // nav, Delete-to-close) or the PTY — stop it here.
                            e.stopPropagation();
                            if (e.key === "Enter") {
                              e.preventDefault();
                              commitTabRename();
                            } else if (e.key === "Escape") {
                              e.preventDefault();
                              cancelTabRename();
                            }
                          }}
                          onKeyUp={(e) => e.stopPropagation()}
                          onBlur={commitTabRename}
                          className="min-w-0 flex-1 rounded border border-sky-500 bg-zinc-900 px-1.5 py-0.5 text-[12.5px] text-zinc-100 outline-none ring-2 ring-sky-500/20"
                        />
                        {renameLength >= DISPLAY_NAME_COUNTER_THRESHOLD && (
                          <span className="flex-none font-mono text-[10px] text-amber-400" aria-hidden="true">
                            {renameLength}/{DISPLAY_NAME_MAX_CODE_POINTS}
                          </span>
                        )}
                        <button
                          type="button"
                          aria-label="Save name"
                          className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded text-emerald-400 hover:bg-emerald-500/15"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={(e) => {
                            e.stopPropagation();
                            commitTabRename();
                          }}
                        >
                          ✓
                        </button>
                        <button
                          type="button"
                          aria-label="Cancel"
                          className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded text-zinc-400 hover:bg-zinc-700"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={(e) => {
                            e.stopPropagation();
                            cancelTabRename();
                          }}
                        >
                          ✕
                        </button>
                      </>
                    ) : confirming ? (
                      <>
                        <span className="min-w-0 flex-1 truncate text-[11.5px] text-rose-300">End session?</span>
                        <button
                          type="button"
                          aria-label={`Confirm end session: ${label}`}
                          className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded text-rose-400 hover:bg-rose-500/15"
                          onClick={(e) => {
                            e.stopPropagation();
                            requestClose(entry.key);
                          }}
                        >
                          ✓
                        </button>
                        <button
                          type="button"
                          aria-label="Cancel"
                          className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded text-zinc-400 hover:bg-zinc-700"
                          onClick={(e) => {
                            e.stopPropagation();
                            cancelClose();
                          }}
                        >
                          ✕
                        </button>
                      </>
                    ) : (
                      <>
                        <span aria-hidden="true" className="flex-none text-[11px]" style={toneStyle(meta.tone)}>
                          {meta.glyph}
                        </span>
                        <span className="sr-only">{meta.ariaText}</span>
                        <span
                          className="min-w-0 flex-1 truncate"
                          onDoubleClick={(e) => {
                            // Desktop accelerator (design §2) — additive only,
                            // the pencil (below) is the primary/taught path.
                            if (!isActive) return;
                            e.stopPropagation();
                            openTabRename(entry.key);
                          }}
                        >
                          {label}
                        </span>
                        {/* Pencil renders on the ACTIVE tab only (design §2's
                            deliberate, human-approved trade — a permanent
                            second icon on every background tab would crush
                            the label below the 110px minimum width). */}
                        {isActive && (
                          <button
                            type="button"
                            aria-label={`Rename session (double-click or F2): ${label}`}
                            title="Rename session (double-click or F2)"
                            className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded text-zinc-500 hover:bg-zinc-700 hover:text-zinc-200"
                            onClick={(e) => {
                              e.stopPropagation();
                              openTabRename(entry.key);
                            }}
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                        )}
                        <button
                          type="button"
                          aria-label={`${tabIsLive ? "End session and close tab" : "Close tab"}: ${label}`}
                          className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded text-zinc-500 hover:bg-zinc-700 hover:text-zinc-200"
                          onClick={(e) => {
                            e.stopPropagation();
                            requestClose(entry.key);
                          }}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </>
                    )}
                  </div>
                    )}
                  </DraggableTab>
                );
              };
              // Split view toggle (design §1 "immediately left of the
              // existing '+'"): visible whenever tabs themselves are — never
              // a disabled dead button (no trapping dialogs — the toggle
              // always does something, even below the width floor, where
              // pressing it stores the preference and shows the amber notice
              // instead of silently failing). The "+" rides with it; the
              // pair pins at the strip's far right in both layouts.
              // Popped-out sessions never sit among the pane-aligned tab
              // columns (D7/§10.4 — that would recreate "a tab without a
              // pane"). Instead a compact violet chip in the utility
              // cluster; click brings the frontmost popped window forward.
              // Applies whenever split renders (the one visible ≤2-session
              // change from shipped v1, §10.0).
              const poppedOutEntries = sessions.filter((s) => poppedOutKeys.has(s.key));
              const poppedOutChip = splitActive && poppedOutEntries.length > 0 && (
                <button
                  type="button"
                  aria-label={formatPoppedOutChipAriaLabel(poppedOutEntries.map((s) => labelFor(s.key)))}
                  title={`Popped out: ${poppedOutEntries.map((s) => labelFor(s.key)).join(", ")}`}
                  onClick={() => {
                    // Same affordance a popped-out tab already gives in
                    // tabbed mode — switch to it (its own placeholder offers
                    // "Bring back to dock"). No cross-window focus API is
                    // wired up beyond what's already shipped.
                    setExpanded(true);
                    setActiveKey(poppedOutEntries[0].key);
                  }}
                  className="flex h-[38px] flex-none items-center gap-1 border-l border-zinc-800 px-2 text-[11px] font-bold text-violet-400 hover:bg-zinc-800/60"
                >
                  <span aria-hidden="true">⧉</span>
                  {poppedOutEntries.length}
                </button>
              );
              const stripControls = (
                <>
              {poppedOutChip}
              <button
                type="button"
                aria-pressed={splitPreferred === true}
                aria-label={splitPreferred === true ? "Split view — back to tabs" : "Split view: show two sessions side by side"}
                title={
                  mobileViewport
                    ? "Split view (needs a wider window)"
                    : "Split view · Ctrl+Shift+←/→ moves typing"
                }
                onClick={toggleSplitView}
                className={cn(
                  "flex h-[38px] w-[38px] flex-none items-center justify-center border-l border-zinc-800 text-base text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100",
                  splitPreferred === true && "bg-sky-500/10 text-sky-300",
                )}
              >
                <span aria-hidden="true">◫</span>
              </button>
              <button
                type="button"
                aria-label="New terminal session"
                title={newSessionTooltip()}
                onClick={handlePlus}
                className="flex h-[38px] w-[38px] flex-none items-center justify-center border-l border-zinc-800 text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100"
              >
                <Plus className="h-4 w-4" />
              </button>
                </>
              );
              if (!splitActive) {
                return (
                  <>
                    <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">{sessions.map(renderTab)}</div>
                    {stripControls}
                  </>
                );
              }
              // N pane-aligned tab columns (design §10.2) — the SAME flex
              // math as the pane row below (`flex-1 1 0`, matching gutters),
              // so tab edges are pane edges by construction. No un-paned
              // tab can ever appear (D2) — the map above already excludes
              // anything not in `paneKeys`. The utility cluster (toggle,
              // +, popped-out chip) lives INSIDE the LAST column so it
              // never shifts the earlier columns' boundaries.
              const byIndex = sessions.filter((entry) => paneKeys.includes(entry.key));
              return (
                <>
                  {paneKeys.map((key, colIndex) => {
                    const entry = byIndex.find((e) => e.key === key);
                    const originalIndex = sessions.findIndex((s) => s.key === key);
                    const isLast = colIndex === paneKeys.length - 1;
                    return (
                      <div
                        key={key}
                        className={cn(
                          "flex min-w-0 flex-1 items-stretch overflow-x-auto",
                          colIndex > 0 && "border-l border-zinc-800",
                        )}
                      >
                        {entry && renderTab(entry, originalIndex)}
                        {isLast && stripControls}
                      </div>
                    );
                  })}
                </>
              );
              })()}
            </div>
            </>
          )}

          {/* CSS-hidden, never unmounted, while an inline browse takes the
              panel — the same rule the tab strip and the popped-out
              placeholder already follow in this file and in
              TerminalSessionView's own root. Unmounting would throw away the
              ended tab's scrollback, so "Back to terminal" above would return
              to an empty terminal instead of the conversation it promised.
              Split view (design §2 "splitbody"): `flex items-stretch` only
              while actually rendering the split — `splitBodyRef` measures
              THIS element for the width floor either way, since it's the
              space the two panes would share. `relative` hosts the drop-zone
              overlay below. */}
          <div ref={splitBodyRef} className={cn("relative", inlineBrowse && "hidden", splitActive && "flex items-stretch")}>
        {sessions.map((entry) => {
          const paneIndex = splitActive ? paneKeys.indexOf(entry.key) : -1;
          const inPane = paneIndex !== -1;
          const isEntryVisible = splitActive ? inPane : entry.key === activeKey;
          const isFocusedPane = inPane && paneIndex === focusedPaneIndex;
          return (
          <TerminalSessionView
            key={entry.key}
            entry={entry}
            descriptor={descriptor}
            label={deriveTabLabel({
              displayName: entry.displayName,
              taskTitle: entry.taskTitle,
              ideaTitle,
              sessionId: summaries[entry.key]?.sessionId ?? null,
            })}
            isActive={isEntryVisible}
            expanded={expanded && isEntryVisible}
            grabFocus={splitActive ? isFocusedPane : true}
            paneFocused={inPane ? isFocusedPane && keyboardLive : undefined}
            onFocusPane={inPane ? () => focusPaneByKey(entry.key) : undefined}
            onPaneFocusChange={inPane ? (focused: boolean) => handlePaneFocusChange(entry.key, focused) : undefined}
            dragActiveRef={dragActiveRef}
            onRequestExpand={requestExpand}
            autoConnectWhenExpanded={entry.launchSeq === 0 && !entry.attach}
            onReportSummary={reportSummary}
            onRegisterActions={registerActions}
            onAnnounce={announce}
            onCapExceeded={openMySessions}
            onBrowseSessions={() => openChooserToBrowse(entry.key)}
            poppedOut={poppedOutKeys.has(entry.key)}
            onPopOut={() => handlePopOut(entry.key)}
            onBringBack={() => bringBackToDock(entry.key)}
            onReconnectTakenOver={(sid) => void performReattach(sid, { focus: true })}
            onRetryReconnect={(sid) => void performReattach(sid, { focus: true })}
            onResumeEndedSession={handleResumeEndedSession}
          />
          );
        })}
          {/* Drag-to-dock drop zones (design §6.2) — a pure geometry read
              (`pointer-events: none`; the drag layer hit-tests from raw
              coordinates, never DOM hover, so the xterm canvas underneath
              never sees these). Only rendered for a drag that's actually
              capable of docking somewhere: a popped-out session was never
              made draggable in the first place (DraggableTab above), so
              nothing further to exclude here. */}
          {draggingKey && (
            <div className="pointer-events-none absolute inset-0 z-30 flex gap-0">
              <div
                className={cn(
                  "m-1.5 ml-1.5 mr-[3px] flex flex-1 items-center justify-center rounded-lg border text-[12px] font-semibold",
                  dropZone === "left"
                    ? "border-sky-500/50 bg-sky-500/15 text-sky-300 font-bold"
                    : "border-dashed border-zinc-600 bg-zinc-700/15 text-zinc-400",
                )}
              >
                Dock left
              </div>
              <div
                className={cn(
                  "m-1.5 ml-[3px] mr-1.5 flex flex-1 items-center justify-center rounded-lg border text-[12px] font-semibold",
                  dropZone === "right"
                    ? "border-sky-500/50 bg-sky-500/15 text-sky-300 font-bold"
                    : "border-dashed border-zinc-600 bg-zinc-700/15 text-zinc-400",
                )}
              >
                Dock right
              </div>
            </div>
          )}
        </div>
          {/* Drag ghost (design §6.2) — a portal overlay, so it renders above
              everything (including the drop zones) without the source tab
              ever leaving the strip (DraggableTab's `disabled` aside, dnd-kit
              itself never removes/moves the source node). */}
          <DragOverlay dropAnimation={null}>
            {draggingKey
              ? (() => {
                  const entry = sessionsRef.current.find((s) => s.key === draggingKey);
                  const summary = summariesRef.current[draggingKey];
                  const dragLabel = deriveTabLabel({
                    displayName: entry?.displayName,
                    taskTitle: entry?.taskTitle,
                    ideaTitle,
                    sessionId: summary?.sessionId ?? null,
                  });
                  const dragMeta = tabStatusMeta(displayStatusFor(draggingKey));
                  return (
                    <div className="flex max-w-[220px] items-center gap-1.5 rounded-md border border-zinc-700 bg-[#141417] px-3 py-1.5 text-[12.5px] font-semibold text-zinc-100 opacity-90 shadow-[0_4px_16px_rgba(0,0,0,0.5)]">
                      <span aria-hidden="true" style={toneStyle(dragMeta.tone)}>
                        {dragMeta.glyph}
                      </span>
                      <span className="truncate">{dragLabel}</span>
                      <span className="flex-none text-[11px] font-normal text-zinc-500">in hand</span>
                    </div>
                  );
                })()
              : null}
          </DragOverlay>
        </DndContext>
      </div>

      {/* Chooser OVERLAY (card cbe60db5, rework 11): the same
          `TerminalSessionChooser` used by `showingChooser` above, but for the
          sessions.length > 0 case — a launch fired while a tab is already
          open (possibly actively connected). The tab strip and every
          `TerminalSessionView` render in the (untouched) block above this
          one, so opening this Dialog neither unmounts nor re-renders them —
          it's a Portal-rendered overlay layered on top, nothing more.

          Dismissal is the SAME in both modes (`chooserMode`), and always
          available: close button, Escape and outside-click all work. Launch
          mode used to be a forced choice with all three suppressed, on the
          theory that a fired launch must resolve to exactly one outcome —
          but nothing is minted until a click inside here, so "no outcome" is
          a perfectly valid one that costs nothing and leaves nothing behind.
          A modal with no exit is a trap, not a guarantee. */}
      <Dialog
        open={chooserOpen && sessions.length > 0 && !inlineBrowse}
        onOpenChange={(next) => {
          if (!next) handleChooserDismiss();
        }}
      >
        <DialogContent
          className="max-w-lg gap-0 border-zinc-700 bg-[#141417] p-0 text-zinc-200 sm:max-w-xl"
          onEscapeKeyDown={(e) => {
            // Card 3bf262ac: Radix's Escape-to-dismiss runs in the CAPTURE
            // phase on `document`, ahead of any row's own rename-input
            // keydown handler — so a plain `stopPropagation` inside that
            // input can't stop the Dialog closing underneath it. Suppress
            // the dismiss here instead while a rename is active; the row's
            // own handler still independently cancels ITS edit on the same
            // keypress. See TerminalSessionChooser's onRenamingActiveChange doc.
            if (chooserRenamingActiveRef.current) e.preventDefault();
          }}
        >
          <DialogTitle className="sr-only">Choose a terminal session</DialogTitle>
          <DialogDescription className="sr-only">
            You already have a terminal open. Pick a session to reconnect to, resume, or start a new one.
          </DialogDescription>
          <TerminalSessionChooser
            sections={chooserSections}
            pendingTask={pendingTask}
            busy={chooserBusy}
            onReconnectHere={handleChooserReconnectHere}
            onOpenBoardAndReconnect={handleChooserOpenBoardAndReconnect}
            onResume={handleChooserResume}
            onStartNew={handleChooserStartNew}
            modelLine={terminalModelLine}
            onRenameSession={renameSession}
            helperStatus={helperStatus}
            onHelperUpdateSettled={refreshAfterHelperUpdate}
            onDismiss={handleChooserDismiss}
            onRenamingActiveChange={(active) => {
              chooserRenamingActiveRef.current = active;
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Task-launch-skip-chooser (Nick's explicit product decision,
          2026-08-16): the per-task launch's ONLY interstitial — rendered
          instead of (never alongside) either Dialog above, and only when
          `pendingTaskMatch` is non-null (this exact task has a live/recent
          session). Mounted conditionally rather than just `open`-gated, so a
          match that expires out from under an open dialog (a registry
          refresh crossing the 48h window) unmounts it instead of leaving a
          dialog with nothing to act on. */}
      {pendingTaskMatch && (
        <TerminalTaskLaunchChoice
          open={taskChoiceOpen}
          taskTitle={pendingTask?.taskTitle ?? ""}
          match={pendingTaskMatch}
          busy={chooserBusy}
          onReconnect={handleTaskChoiceReconnect}
          onStartFresh={handleTaskChoiceStartFresh}
          onCancel={handleTaskChoiceCancel}
          modelLine={terminalTaskDialogModelLine}
        />
      )}
    </div>
  );
}

// Tone → text colour, matching terminal-tabs.ts's shared vocabulary (TabTone) —
// the SAME tone that also picks the collapsed-bar chip's border/background.
function toneStyle(tone: TabTone): { color: string } {
  switch (tone) {
    case "ok":
      return { color: "#34d399" };
    case "warn":
      return { color: "#fbbf24" };
    case "err":
      return { color: "#fb7185" };
    case "info":
      return { color: "#7dd3fc" };
    case "popped":
      return { color: "#a78bfa" };
    case "mut":
    default:
      return { color: "#6f6f7a" };
  }
}

