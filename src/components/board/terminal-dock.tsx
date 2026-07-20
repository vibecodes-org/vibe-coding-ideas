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
import { ChevronUp, ChevronDown, Circle, ListTree, Plus, Terminal as TerminalIcon, X } from "lucide-react";
import { usePostHog } from "posthog-js/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isTerminalEnabled, relayBaseUrl, type TerminalStatus } from "@/lib/terminal/connection";
import { subscribeBrowserLaunch, type BrowserLaunchPayload } from "@/lib/terminal/launch-mode";
import { resolveDockView } from "@/lib/terminal/first-run-flow";
import { slugifyIdeaTitle } from "@/lib/launch-claude-code";
import { newSessionTooltip } from "@/lib/terminal/session-cap";
import {
  generatePopoutNonce,
  popoutChannelName,
  createDockPopoutMessageHandler,
  INITIAL_DOCK_HANDSHAKE_STATE,
  type DockHandshakeState,
  type PopoutChannelLike,
  type PopoutPayload,
} from "@/lib/terminal/popout-channel";
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
import { TerminalMySessionsPanel } from "./terminal-my-sessions-panel";
import type { TerminalSessionActions, TerminalSessionDescriptor } from "./use-terminal-session";

interface TerminalDockProps {
  ideaId: string;
  ideaTitle: string;
  /**
   * The idea's GitHub URL (or null). Needed so hook-initiated launches — paired
   * auto-connect and Retry, which never pass through the launch button — can
   * build the SAME board-level compact bootstrap prompt the button would.
   */
  ideaGithubUrl: string | null;
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

export function TerminalDock({ ideaId, ideaTitle, ideaGithubUrl }: TerminalDockProps) {
  // Defence-in-depth: also gated at the page mount. When off, render nothing —
  // no dock, no entry point, board unchanged (B9).
  const enabled = isTerminalEnabled();
  const [expanded, setExpanded] = useState(false);
  const [sessions, setSessions] = useState<SessionEntry[]>(() => [createPristineEntry()]);
  const [activeKey, setActiveKey] = useState<string>(() => sessions[0].key);
  const [summaries, setSummaries] = useState<Record<string, SessionSummary>>({});
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
  const popoutChannelsRef = useRef<Map<string, { channel: PopoutChannelLike; handshake: DockHandshakeState }>>(
    new Map(),
  );
  // Mirrors so `deliverLaunch` (used by both the launch-bus subscription and
  // "+") can read the CURRENT list/summaries without depending on them — that
  // keeps its identity stable across renders instead of forcing the launch-bus
  // effect to unsubscribe/resubscribe on every tab status change.
  const sessionsRef = useRef(sessions);
  const summariesRef = useRef(summaries);
  const posthog = usePostHog();
  const posthogRef = useRef(posthog);
  // Refs must only be WRITTEN outside render (react-hooks/refs) — sync them in
  // an effect, which always commits before any later event handler can read
  // them, so `deliverLaunch` (called only from event handlers / the launch-bus
  // subscription) never sees a stale value.
  useEffect(() => {
    sessionsRef.current = sessions;
    summariesRef.current = summaries;
    posthogRef.current = posthog;
  }, [sessions, summaries, posthog]);

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
    () => ({ ideaId, ideaTitle, ideaGithubUrl }),
    [ideaId, ideaTitle, ideaGithubUrl],
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
  // reuses the retained sid/browserToken, see use-terminal-session.ts) and
  // drop the pop-out bookkeeping. This is what BOTH "Bring back to dock" and
  // the popped window's close-signal do — the only difference is who
  // triggered it (design §10b: "two paths, never a race").
  const bringBackToDock = useCallback(
    (key: string) => {
      actionsMapRef.current.get(key)?.reconnectNow();
      endPopOut(key);
    },
    [endPopOut],
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
      const win = window.open(
        `/terminal/popout#${nonce}`,
        `vibecodes-terminal-${nonce}`,
        "width=760,height=560,noopener",
      );
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
      const payload: PopoutPayload = {
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
        getPayload: () => payload,
        // The popped window told us it's closing (D3) — OR its hand-off
        // timed out and it's telling us to give up on its behalf (see
        // startPopoutClientHandshake) — either way, reattach automatically.
        onReattach: () => bringBackToDock(key),
      });

      posthogRef.current?.capture("terminal_popout_used", { origin: entry?.origin ?? "toolbar" });
      setPoppedOutKeys((prev) => new Set(prev).add(key));
    },
    [ideaId, ideaTitle, ideaSlug, bringBackToDock],
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
  const deliverLaunch = useCallback((payload: BrowserLaunchPayload | null) => {
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
    const pristineKey = findPristineSlot(currentSessions.map((s) => ({ key: s.key, launchSeq: s.launchSeq })));
    if (pristineKey) {
      setSessions((prev) =>
        prev.map((s) =>
          s.key === pristineKey
            ? {
                ...s,
                origin: payload?.taskId ? "task" : "toolbar",
                taskId: payload?.taskId,
                taskTitle: payload?.taskTitle,
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
      origin: payload?.taskId ? "task" : "toolbar",
      taskId: payload?.taskId,
      taskTitle: payload?.taskTitle,
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
  }, []);

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
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-700 bg-[#141417] text-zinc-200 shadow-[0_-8px_30px_rgba(0,0,0,0.4)]">
      {/* Shared aria-live region — background-tab attention only (a11y §14). */}
      <div aria-live="polite" role="status" className="sr-only">
        {announcement}
      </div>

      {/* Collapsed dock bar — always visible */}
      <div className="flex items-center gap-2.5 px-3 py-1.5">
        <span className="inline-flex items-center gap-2 text-xs font-semibold">
          {!multi && (
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
          {multi &&
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
          {!multi && soleIsPoppedOut && (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-violet-500/50 bg-violet-500/10 px-2 py-0.5 text-[11px] font-semibold text-violet-300">
              <span aria-hidden="true">⧉</span> Popped out
            </span>
          )}
          {!multi && !soleIsPoppedOut && (
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
          aria-label={expanded ? "Collapse terminal panel" : "Expand terminal panel"}
          aria-expanded={expanded}
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
          <span className="hidden sm:inline">{expanded ? "Collapse" : "Expand"}</span>
        </Button>
      </div>

      {/* Expanded body — kept mounted (hidden when collapsed) so every tab's xterm
          instance and its scrollback survive collapse/expand and live bytes are
          never lost. */}
      <div className={cn("border-t border-zinc-800 bg-[#0c0c0e]", !expanded && "hidden")}>
        {multi && (
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
            autoConnectWhenExpanded={entry.launchSeq === 0}
            onReportSummary={reportSummary}
            onRegisterActions={registerActions}
            onAnnounce={announce}
            onCapExceeded={openMySessions}
            poppedOut={poppedOutKeys.has(entry.key)}
            onPopOut={() => handlePopOut(entry.key)}
            onBringBack={() => bringBackToDock(entry.key)}
          />
        ))}
      </div>
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

