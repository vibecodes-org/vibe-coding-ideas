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

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { ChevronUp, ChevronDown, ChevronLeft, Circle, ListTree, Loader2, Plus, Terminal as TerminalIcon, X } from "lucide-react";
import { usePostHog } from "posthog-js/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { isTerminalEnabled, relayBaseUrl, type TerminalStatus } from "@/lib/terminal/connection";
import { subscribeBrowserLaunch, type BrowserLaunchPayload } from "@/lib/terminal/launch-mode";
import { resolveDockView } from "@/lib/terminal/first-run-flow";
import { slugifyIdeaTitle, type RecordedProjectPath } from "@/lib/launch-claude-code";
import { newSessionTooltip } from "@/lib/terminal/session-cap";
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
import { loadSessionSnapshot, readLastTabSid, toReconnectBuffer } from "@/lib/terminal/session-snapshot";
import { readDockOpen, writeDockOpen } from "@/lib/terminal/dock-open-persistence";
import { useDockHeight, TerminalDockResizeHandle } from "./terminal-dock-resize";
import { getMachineIdentity } from "@/lib/terminal/machine-identity";
import { fetchHelperStatus, type HelperStatus } from "@/lib/terminal/helper-row";
import {
  type SessionEntry,
  type TabDisplayStatus,
  type TabTone,
  tabStatusMeta,
  isLiveTabStatus,
  deriveTabLabel,
  findPristineSlot,
  decideTaskLaunch,
  summarizeSessionStatuses,
  type DedupeCandidate,
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

export function TerminalDock({ ideaId, ideaTitle, ideaGithubUrl, recordedProjectPaths }: TerminalDockProps) {
  // Defence-in-depth: also gated at the page mount. When off, render nothing —
  // no dock, no entry point, board unchanged (B9).
  const enabled = isTerminalEnabled();
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
    posthogRef.current = posthog;
  }, [sessions, summaries, posthog]);
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

  // This tab's own snapshot info (session-snapshot.ts) — read once; a tab
  // doesn't gain a NEW "last sid" mid-session except by attaching another
  // session itself, at which point the chooser is long since resolved.
  const [entrySnapshotInfo] = useState(() => {
    const sid = readLastTabSid();
    if (!sid) return null;
    const snap = loadSessionSnapshot(sid);
    return snap ? { sid, savedAt: snap.savedAt } : null;
  });

  const entryDecision: EntryDecision | null = useMemo(() => {
    if (registryRows === null) return null; // still loading
    return decideEntryBehaviour(registryRows, entrySnapshotInfo, Date.now());
  }, [registryRows, entrySnapshotInfo]);
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
        entrySnapshotInfo?.sid ?? readLastTabSid(),
        getMachineIdentity(),
      ),
    [registryRows, ideaId, entrySnapshotInfo],
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
  const ideaSlug = useMemo(() => slugifyIdeaTitle(ideaTitle), [ideaTitle]);

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
        taskTitle: entry?.taskTitle,
        ideaSlug,
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
    [ideaId, ideaTitle, ideaSlug, applyBufferAndReattach],
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

  // ── launch routing (B7/B10) + the pristine-slot reuse for the FIRST launch ──
  // Renamed from the pre-chooser `deliverLaunch` — this is the ACTUAL mint
  // path (today's unchanged mint/dedupe/pristine-reuse behaviour), now
  // reached either directly (F1's empty-launch state — nothing to choose
  // between) or via the chooser's "Start new session" (see `deliverLaunch`
  // below, which decides which of the two applies).
  const mintAndDeliver = useCallback((payload: BrowserLaunchPayload | null) => {
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
    // "+" only appears once a 2nd tab already exists (see the tab-strip render
    // guard below), so the pristine slot is always already consumed by then —
    // this always mints a genuinely new, board-level tab (B7).
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
      void performReattach(entryDecision.sid, { focus: false });
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
    mintAndDeliver(buildResumePayload(row));
  }, [resumeParam, registryRows, pathname, mintAndDeliver, buildResumePayload]);

  // ── chooser action handlers ─────────────────────────────────────────────────
  // Shared by BOTH the sessions.length === 0 body-swap chooser and the
  // sessions.length > 0 overlay (rework 11) — the `setChooserMode(null)` in
  // each is a no-op when it was never opened (the body-swap case), and the
  // one thing that's allowed to close the overlay per the design's
  // non-disruption guarantee: only an explicit action in here, never an
  // outside click/Escape (see the Dialog's `onInteractOutside`/
  // `onEscapeKeyDown` below).
  const handleChooserStartNew = useCallback(() => {
    const payload = pendingLaunch;
    setPendingLaunch(null);
    setChooserMode(null);
    mintAndDeliver(payload);
  }, [pendingLaunch, mintAndDeliver]);

  const handleChooserReconnectHere = useCallback(
    (row: ChooserLiveRow) => {
      setPendingLaunch(null);
      setChooserMode(null);
      void performReattach(row.sid, { focus: true });
    },
    [performReattach],
  );

  const handleChooserOpenBoardAndReconnect = useCallback(
    (row: ChooserLiveRow) => {
      setChooserMode(null);
      router.push(`/ideas/${row.ideaId}/board?reconnect=${encodeURIComponent(row.sid)}`);
    },
    [router],
  );

  const handleChooserResume = useCallback(
    (row: ChooserRecentRow) => {
      setPendingLaunch(null);
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
      mintAndDeliver(buildResumePayload(row));
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
  const openChooserToBrowse = useCallback(() => {
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
      mintAndDeliver(buildResumePayload(row));
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
      mintAndDeliver(payload);
    },
    [ideaId, mintAndDeliver, router],
  );

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
    (e: KeyboardEvent<HTMLDivElement>, index: number, key: string) => {
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
        setActiveKey(key);
        setExpanded(true);
      } else if (e.key === "Delete") {
        e.preventDefault();
        requestClose(key);
      } else if (e.key === "Escape" && confirmingKey === key) {
        e.preventDefault();
        cancelClose();
      }
    },
    [sessions, requestClose, confirmingKey, cancelClose],
  );

  if (!enabled) return null;

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
      className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-700 bg-[#141417] text-zinc-200 shadow-[0_-8px_30px_rgba(0,0,0,0.4)]"
      style={dockHeight.rootStyle}
    >
      {/* Drag-to-resize handle on the top edge (card b885ebfd). Only while
          expanded AND at least one session body is rendered — collapsed there
          is nothing to size, and the chooser/loading faces size themselves.
          The remembered height still applies the moment the dock re-expands
          (the CSS variable on the root above is always set). */}
      {expanded && sessions.length > 0 && <TerminalDockResizeHandle controller={dockHeight} />}

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
            helperStatus={helperStatus}
            onHelperUpdateSettled={refreshAfterHelperUpdate}
          />
        )}

        {multi && !inlineBrowse && (
          <div role="tablist" aria-label="Terminal sessions" className="flex items-stretch border-b border-zinc-800 bg-[#141417]">
            {/* Tabs shrink then scroll; "+" (below) stays pinned OUTSIDE this
                scroll region so launch + oversight are never scrolled away
                (design §4a: "never wrap, never hide the '+'"). */}
            <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
              {sessions.map((entry, index) => {
                const summary = summaries[entry.key];
                const status = summary?.status ?? "idle";
                const poppedOut = poppedOutKeys.has(entry.key);
                const meta = tabStatusMeta(displayStatusFor(entry.key));
                const tabIsLive = poppedOut || isLiveTabStatus(status);
                const label = deriveTabLabel({
                  taskTitle: entry.taskTitle,
                  ideaSlug,
                  sessionId: summary?.sessionId ?? null,
                });
                const isActive = entry.key === activeKey;
                const confirming = confirmingKey === entry.key;
                return (
                  <div
                    key={entry.key}
                    id={`terminal-tab-${entry.key}`}
                    role="tab"
                    aria-selected={isActive}
                    tabIndex={isActive ? 0 : -1}
                    title={label}
                    onKeyDown={(e) => handleTabKeyDown(e, index, entry.key)}
                    onClick={() => {
                      setActiveKey(entry.key);
                      setExpanded(true);
                    }}
                    className={cn(
                      "flex min-w-[110px] max-w-[190px] flex-none cursor-pointer items-center gap-1.5 border-r border-t-2 border-zinc-800 border-t-transparent px-2.5 py-0 text-[12.5px] text-zinc-400",
                      isActive && "border-t-sky-400 bg-[#0c0c0e] font-semibold text-zinc-100",
                      !isActive && "hover:bg-zinc-800/60 hover:text-zinc-100",
                    )}
                  >
                    {confirming ? (
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
                        <span className="min-w-0 flex-1 truncate">{label}</span>
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
                );
              })}
            </div>
            <button
              type="button"
              aria-label="New terminal session"
              title={newSessionTooltip()}
              onClick={handlePlus}
              className="flex h-[38px] w-[38px] flex-none items-center justify-center border-l border-zinc-800 text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* CSS-hidden, never unmounted, while an inline browse takes the
            panel — the same rule the tab strip and the popped-out
            placeholder already follow in this file and in
            TerminalSessionView's own root. Unmounting would throw away the
            ended tab's scrollback, so "Back to terminal" above would return
            to an empty terminal instead of the conversation it promised. */}
        <div className={cn(inlineBrowse && "hidden")}>
        {sessions.map((entry) => (
          <TerminalSessionView
            key={entry.key}
            entry={entry}
            descriptor={descriptor}
            label={deriveTabLabel({
              taskTitle: entry.taskTitle,
              ideaSlug,
              sessionId: summaries[entry.key]?.sessionId ?? null,
            })}
            isActive={entry.key === activeKey}
            expanded={expanded && entry.key === activeKey}
            onRequestExpand={requestExpand}
            autoConnectWhenExpanded={entry.launchSeq === 0 && !entry.attach}
            onReportSummary={reportSummary}
            onRegisterActions={registerActions}
            onAnnounce={announce}
            onCapExceeded={openMySessions}
            onBrowseSessions={openChooserToBrowse}
            poppedOut={poppedOutKeys.has(entry.key)}
            onPopOut={() => handlePopOut(entry.key)}
            onBringBack={() => bringBackToDock(entry.key)}
            onReconnectTakenOver={(sid) => void performReattach(sid, { focus: true })}
            onRetryReconnect={(sid) => void performReattach(sid, { focus: true })}
            onResumeEndedSession={handleResumeEndedSession}
          />
        ))}
        </div>
      </div>

      {/* Chooser OVERLAY (card cbe60db5, rework 11): the same
          `TerminalSessionChooser` used by `showingChooser` above, but for the
          sessions.length > 0 case — a launch fired while a tab is already
          open (possibly actively connected). The tab strip and every
          `TerminalSessionView` render in the (untouched) block above this
          one, so opening this Dialog neither unmounts nor re-renders them —
          it's a Portal-rendered overlay layered on top, nothing more.

          Dismissal depends on WHY it opened (`chooserMode`). "launch" is a
          forced choice (matches onboarding-dialog.tsx's pattern): no close
          button, outside-click and Escape both suppressed — only an action
          inside the chooser (wired to also call `setChooserMode(null)`)
          closes it, because a fired launch must resolve to exactly one
          outcome. "browse" — the ended panel's "View my other sessions" link
          — has no pending launch to resolve, so it closes normally; trapping
          someone who only wanted a look would be worse than the dead end that
          link exists to fix. */}
      <Dialog
        open={chooserOpen && sessions.length > 0 && !inlineBrowse}
        onOpenChange={(next) => {
          if (!next && chooserMode === "browse") setChooserMode(null);
        }}
      >
        <DialogContent
          showCloseButton={chooserMode === "browse"}
          className="max-w-lg gap-0 border-zinc-700 bg-[#141417] p-0 text-zinc-200 sm:max-w-xl"
          onInteractOutside={(e) => {
            if (chooserMode !== "browse") e.preventDefault();
          }}
          onEscapeKeyDown={(e) => {
            if (chooserMode !== "browse") e.preventDefault();
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
            helperStatus={helperStatus}
            onHelperUpdateSettled={refreshAfterHelperUpdate}
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

