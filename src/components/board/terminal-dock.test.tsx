// Card cbe60db5 rework 9 (Bug B — RELEASE-BLOCKING, Nick's field test
// 2026-08-14): the toolbar's "Launch Claude Code" fires the launch bus,
// which `TerminalDock`'s `deliverLaunch` is supposed to route into EITHER a
// direct mint (nothing to choose between) OR the session entry chooser
// (there's live/recent sessions elsewhere worth knowing about first) —
// never both, never neither. The bug: `deliverLaunch`'s gate checked
// `entryDecisionRef.current?.kind === "chooser"`, and `entryDecisionRef` is
// `null` while the registry fetch that DECIDES that is still in flight.
// `null?.kind === "chooser"` is `false`, so a click that lands during that
// window fell through to an unconditional mint — bypassing the chooser with
// zero visibility into other live sessions, exactly the failure mode QA
// pinned.
//
// This file is a FOCUSED harness for that race and for rework 11 (card
// cbe60db5, same card — QA's follow-up root cause): `deliverLaunch`'s
// chooser-vs-mint decision was ALSO wrongly gated on
// `sessionsRef.current.length === 0` (this pageview's own tab count) — once
// any local tab existed, every subsequent launch (toolbar, "+", task launch)
// fell straight through to `mintAndDeliver`, bypassing the chooser entirely,
// regardless of what the registry still knew about. The fix always consults
// `entryDecisionRef.current`; visibility is now separate from that decision
// — `showingChooser` keeps the unchanged full-body swap when no local tab
// exists, and a new `chooserOpen`-gated Dialog overlays the SAME chooser
// over an already-open tab without ever unmounting it.
//
// Not a full dock test suite (no existing terminal-dock test file to extend
// — see the card). `TerminalSessionView` / `TerminalMySessionsPanel` /
// `TerminalSessionChooser` are stubbed so the test can assert purely on "did
// a session tab get minted" vs. "did the chooser render" vs. "did the
// overlay open", without pulling in the real hook's xterm/WebSocket
// machinery — that machinery is already covered by
// terminal-session-view.test.tsx and use-terminal-session.test.ts.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, waitFor, fireEvent, within } from "@testing-library/react";
import { useEffect } from "react";
import type {
  ChooserRegistryRow,
  ChooserLiveRow,
  ChooserRecentRow,
  ChooserSections,
  TaskSessionMatch,
} from "@/lib/terminal/chooser-data";

// Shared spy (not a fresh vi.fn() per call) so cross-board resume/reconnect
// tests can assert on WHERE the dock navigated, not just that it did.
// `mockSearchParams` is mutable so a `?resume=<sid>` landing test can seed it
// before render — defaults to empty (today's every-other-test behaviour).
const { mockRouterPush, mockSearchParams } = vi.hoisted(() => ({
  mockRouterPush: vi.fn(),
  mockSearchParams: { current: new URLSearchParams() },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockRouterPush }),
  usePathname: () => "/ideas/idea-1/board",
  useSearchParams: () => mockSearchParams.current,
}));

vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

// Mount/unmount tracking (rework 11's non-disruption guarantee): a real
// `TerminalSessionView` keeps its xterm instance, socket, and connection
// state alive for the lifetime of the tab — an unmount+remount would lose
// all of that. These spies fire once per genuine mount/unmount (empty-deps
// effect), so a test can assert the overlay opening never triggers either.
const { sessionViewMountSpy, sessionViewUnmountSpy } = vi.hoisted(() => ({
  sessionViewMountSpy: vi.fn(),
  sessionViewUnmountSpy: vi.fn(),
}));

// Task 9f30ae15 (wrong-tab-closes-on-confirm bug): the dock's real
// `onRegisterActions` wiring is what `requestClose`'s confirmed click
// actually calls (`actionsMapRef.current.get(key)?.end()`) — this was
// previously never exercised by this file (the stub below dropped the prop
// entirely), so the exact close-mapping path the bug lives in had zero
// coverage. Registering a real per-key actions object here, keyed by the
// same `entry.key` the dock itself uses, lets the close-mapping tests assert
// EXACTLY which session's `end()` fired — full shape (not just `end`)
// because other dock code paths (e.g. split-view focus's `refreshView`)
// call other members of the SAME registered object.
type MockTerminalSessionActions = {
  connect: ReturnType<typeof vi.fn>;
  beginBrowserLaunch: ReturnType<typeof vi.fn>;
  launchFromBus: ReturnType<typeof vi.fn>;
  reconnectNow: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  setReadOnly: ReturnType<typeof vi.fn>;
  setAutoAccept: ReturnType<typeof vi.fn>;
  copyBridgeCommand: ReturnType<typeof vi.fn>;
  refreshView: ReturnType<typeof vi.fn>;
  serializeNow: ReturnType<typeof vi.fn>;
  restoreBuffer: ReturnType<typeof vi.fn>;
};
const { registeredActionsByKey } = vi.hoisted(() => ({
  registeredActionsByKey: new Map<string, MockTerminalSessionActions>(),
}));

// Renders just enough of a real TerminalSessionView for the test to see HOW
// MANY tabs actually got minted, and with what payload — the real component
// (and the hook underneath it) is exercised elsewhere. The `resume-ended-*`
// button stands in for the real component's ended-session "Resume this
// conversation" action (terminal-session-view.tsx's `handleResume`) —
// mirrors its exact payload shape (`ideaId: entry.ideaId`, see SessionEntry's
// doc) so a click here exercises the DOCK's real `handleResumeEndedSession`
// routing decision, not just the payload-building terminal-session-view.test.tsx
// already covers (mutation-tested rework round 2: gutting that routing
// decision must FAIL this file, not just terminal-session-view's own tests).
vi.mock("./terminal-session-view", () => ({
  TerminalSessionView: ({
    entry,
    onResumeEndedSession,
    onBrowseSessions,
    onReportSummary,
    onPopOut,
    onRegisterActions,
    paneFocused,
    grabFocus,
    onPaneFocusChange,
    autoConnectWhenExpanded,
  }: {
    entry: { key: string; taskId?: string; ideaId?: string };
    onResumeEndedSession?: (payload: { cwd?: string; taskId?: string; ideaId?: string }, sid: string | null) => void;
    onBrowseSessions?: () => void;
    onReportSummary: (key: string, summary: Record<string, unknown>) => void;
    onPopOut?: () => void;
    // Task 9f30ae15: the real prop the dock always passes — wired here (not
    // just accepted and dropped) so requestClose's `actionsMapRef.current
    // .get(key)?.end()` has a real spy to resolve, keyed exactly like the
    // dock keys it. See `registeredActionsByKey` above.
    onRegisterActions: (key: string, actions: MockTerminalSessionActions | null) => void;
    // Bug fix (last-tab-close auto-relaunch): the real hook's own paired
    // auto-connect effect (use-terminal-session.ts) lives entirely inside the
    // component this stub replaces, so it can't be exercised here — surfaced
    // as a data attribute instead so a test can assert the DOCK computed the
    // right value for `autoConnectWhenExpanded` (the only thing the dock
    // itself is responsible for; the hook's own reaction to it is covered by
    // use-terminal-session.test.ts).
    autoConnectWhenExpanded?: boolean;
    // Split-view focus-sync defect fix (task df7a0134, QA rework): a real
    // focusable element stands in for xterm's own hidden input, so a test
    // can drive the SAME real focus/blur events the fix listens for (not
    // just clicks) and assert `grabFocus`'s tabIndex consequence — the
    // dock's own logic is what's under test here, the real xterm/hook
    // wiring is covered by use-terminal-session.test.ts.
    paneFocused?: boolean;
    grabFocus?: boolean;
    onPaneFocusChange?: (focused: boolean) => void;
  }) => {
    useEffect(() => {
      sessionViewMountSpy(entry.key);
      const actions: MockTerminalSessionActions = {
        connect: vi.fn(),
        beginBrowserLaunch: vi.fn(),
        launchFromBus: vi.fn(),
        reconnectNow: vi.fn(),
        end: vi.fn(),
        setReadOnly: vi.fn(),
        setAutoAccept: vi.fn(),
        copyBridgeCommand: vi.fn(),
        refreshView: vi.fn(),
        serializeNow: vi.fn(),
        restoreBuffer: vi.fn(),
      };
      registeredActionsByKey.set(entry.key, actions);
      onRegisterActions(entry.key, actions);
      return () => {
        sessionViewUnmountSpy(entry.key);
        registeredActionsByKey.delete(entry.key);
        onRegisterActions(entry.key, null);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return (
      <div
        data-testid="session-view"
        data-key={entry.key}
        data-task-id={entry.taskId ?? ""}
        data-idea-id={entry.ideaId ?? ""}
        data-auto-connect-when-expanded={autoConnectWhenExpanded ? "true" : "false"}
      >
        <button
          data-testid={`resume-ended-${entry.key}`}
          onClick={() =>
            onResumeEndedSession?.(
              { cwd: "/Users/nick/projects/here", taskId: entry.taskId, ideaId: entry.ideaId },
              "sid-ended-own-tab",
            )
          }
        >
          Resume this conversation
        </button>
        {/* Stands in for the ended panel's "View my other sessions" link —
            the real panel only renders it on the session-ended view, which
            needs the whole xterm/socket machinery this stub deliberately
            omits. What matters here is WHERE the dock points the callback. */}
        {onBrowseSessions && (
          <button data-testid="view-my-other-sessions" onClick={onBrowseSessions}>
            View my other sessions
          </button>
        )}
        {/* Lets a test drive this tab to a real ENDED status. Without it every
            stubbed tab reports nothing and the dock defaults it to "idle" —
            which counts as live, so the panel-vs-overlay branch would never
            be exercised. */}
        <button
          data-testid={`report-ended-${entry.key}`}
          onClick={() =>
            onReportSummary(entry.key, {
              status: "session-ended",
              sessionId: `sid-for-${entry.key}`,
              errorKind: null,
              launchPhase: "idle",
              platformSupported: true,
              paired: true,
              browserToken: null,
              readOnly: false,
              autoAccept: false,
            })
          }
        >
          report ended
        </button>
        {/* Card df29b85e regression test (ended-tab reclaim): `report-ended`
            above reports a per-key sid (`sid-for-${entry.key}`), which never
            lines up with THIS tab's own "Resume this conversation" button —
            that button always fires the fixed "sid-ended-own-tab" (mirrors
            the real ended panel's `pair.sessionId`, a single tab's own last
            session, not derived from its dock key). A dedicated button
            reports the matching sid so a test can put this tab into the
            exact state `mintAndDeliver`'s reclaim check needs before
            clicking Resume. */}
        <button
          data-testid={`report-ended-own-sid-${entry.key}`}
          onClick={() =>
            onReportSummary(entry.key, {
              status: "session-ended",
              sessionId: "sid-ended-own-tab",
              errorKind: null,
              launchPhase: "idle",
              platformSupported: true,
              paired: true,
              browserToken: null,
              readOnly: false,
              autoAccept: false,
            })
          }
        >
          report ended (own sid)
        </button>
        {/* Lets a test drive this tab to a real MINTED-and-connected status —
            `handlePopOut` (terminal-dock.tsx) bails out silently unless the
            summary carries both a sessionId and a browserToken, so the
            resize-handle-hides-on-popout test needs this to reach the pop-out
            call at all. */}
        <button
          data-testid={`report-connected-${entry.key}`}
          onClick={() =>
            onReportSummary(entry.key, {
              status: "connected",
              sessionId: `sid-for-${entry.key}`,
              errorKind: null,
              launchPhase: "idle",
              platformSupported: true,
              paired: true,
              browserToken: `token-for-${entry.key}`,
              readOnly: false,
              autoAccept: false,
            })
          }
        >
          report connected
        </button>
        {onPopOut && (
          <button data-testid={`pop-out-${entry.key}`} onClick={onPopOut}>
            Pop out
          </button>
        )}
        {/* Split-view focus-sync defect fix (task df7a0134, QA rework):
            `paneFocused` only renders (true or false) while this stub is one
            of the split's two panes — mirrors the real component's `inPane`
            gate. The indicator text is the SAME words a real user reads
            (paneFocusWord); the input is a real focusable element wired to
            `onPaneFocusChange` exactly like the real xterm textarea is
            wired via use-terminal-session.ts, with `grabFocus` driving its
            tabIndex the same way the real fix does — so a test here can
            assert BOTH "the indicator never lies" and "Tab can't reach the
            watching pane" without needing the real xterm/hook machinery. */}
        {paneFocused !== undefined && (
          <>
            <span data-testid={`pane-indicator-${entry.key}`}>{paneFocused ? "Typing here" : "Watching"}</span>
            <input
              data-testid={`pane-input-${entry.key}`}
              tabIndex={grabFocus ? 0 : -1}
              onFocus={() => onPaneFocusChange?.(true)}
              onBlur={() => onPaneFocusChange?.(false)}
              readOnly
            />
          </>
        )}
      </div>
    );
  },
  dockStatusMeta: () => ({ label: "Terminal", Icon: () => null, className: "" }),
}));

vi.mock("./terminal-my-sessions-panel", () => ({
  TerminalMySessionsPanel: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Real enough to drive rework 11's overlay tests — exposes one button per
// action the dock wires up (`onStartNew`/`onReconnectHere`/
// `onOpenBoardAndReconnect`/`onResume`), skipping the real component's
// layout/copy (covered by terminal-session-chooser.test.tsx).
vi.mock("./terminal-session-chooser", () => ({
  TerminalSessionChooser: ({
    sections,
    onStartNew,
    onReconnectHere,
    onOpenBoardAndReconnect,
    onResume,
  }: {
    sections: ChooserSections;
    onStartNew: () => void;
    onReconnectHere: (row: ChooserLiveRow) => void;
    onOpenBoardAndReconnect: (row: ChooserLiveRow) => void;
    onResume: (row: ChooserRecentRow) => void;
  }) => (
    <div data-testid="chooser">
      <button data-testid="chooser-start-new" onClick={onStartNew}>
        Start new
      </button>
      {sections.liveHere.map((row) => (
        <button key={row.sid} data-testid={`chooser-reconnect-here-${row.sid}`} onClick={() => onReconnectHere(row)}>
          Reconnect here
        </button>
      ))}
      {sections.liveElsewhere.map((row) => (
        <button key={row.sid} data-testid={`chooser-open-board-${row.sid}`} onClick={() => onOpenBoardAndReconnect(row)}>
          Open board & reconnect
        </button>
      ))}
      {sections.recent.map((row) => (
        <button key={row.sid} data-testid={`chooser-resume-${row.sid}`} onClick={() => onResume(row)}>
          Resume
        </button>
      ))}
    </div>
  ),
}));

// Task-launch-skip-chooser (2026-08-16): the minimal task-scoped choice —
// exposes one button per action (`onReconnect`/`onStartFresh`) and the
// match's `kind`, skipping the real component's layout/copy (covered by
// terminal-task-launch-choice.test.tsx).
vi.mock("./terminal-task-launch-choice", () => ({
  TerminalTaskLaunchChoice: ({
    open,
    match,
    onReconnect,
    onStartFresh,
  }: {
    open: boolean;
    match: TaskSessionMatch;
    onReconnect: () => void;
    onStartFresh: () => void;
  }) =>
    open ? (
      <div data-testid="task-choice" data-match-kind={match.kind} data-match-sid={match.row.sid}>
        <button data-testid="task-choice-reconnect" onClick={onReconnect}>
          Reconnect
        </button>
        <button data-testid="task-choice-start-fresh" onClick={onStartFresh}>
          Start fresh anyway
        </button>
      </div>
    ) : null,
}));

import { TerminalDock } from "./terminal-dock";
import { requestBrowserLaunch } from "@/lib/terminal/launch-mode";
import { rememberLastTabSid, rememberTabSid, saveSessionSnapshot } from "@/lib/terminal/session-snapshot";
import { toast } from "sonner";

function deferredRegistryResponse() {
  let resolve!: (rows: ChooserRegistryRow[]) => void;
  const promise = new Promise<ChooserRegistryRow[]>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Every OTHER fetch the dock's own effects fire (helper status) fails open
 * to null/[] — never hangs the test, and is irrelevant to this race. Only
 * `/api/terminal/session/list` (the registry — the ONE fetch this bug races
 * against) is wired to the caller-controlled deferred promise. Reattach
 * (rework 11's Reconnect-inside-the-overlay test) always succeeds — its own
 * failure handling is covered elsewhere. */
function stubFetch(registryPromise: Promise<ChooserRegistryRow[]>) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url === "/api/terminal/session/list") {
        return registryPromise.then((sessions) => ({ ok: true, json: async () => ({ sessions }) }));
      }
      if (url === "/api/terminal/session/reattach") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ sessionId: "reattached-session-id", browserToken: "reattached-token" }),
        });
      }
      return Promise.resolve({ ok: false, json: async () => ({}) });
    }),
  );
}

/** Registry fetch that fails `failCount` times before resolving with `rows`
 * (or fails on every attempt within the retry budget when `rows` is
 * omitted) — drives Bug A's retry-then-fail-closed path. Every other
 * endpoint behaves like `stubFetch`'s defaults. */
function stubFlakyRegistryFetch(failCount: number, rows?: ChooserRegistryRow[]) {
  let calls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url === "/api/terminal/session/list") {
        calls += 1;
        if (calls <= failCount) return Promise.reject(new Error("network down"));
        return Promise.resolve({ ok: true, json: async () => ({ sessions: rows ?? [] }) });
      }
      if (url === "/api/terminal/session/reattach") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ sessionId: "reattached-session-id", browserToken: "reattached-token" }),
        });
      }
      return Promise.resolve({ ok: false, json: async () => ({}) });
    }),
  );
}

function liveElsewhereRow(): ChooserRegistryRow {
  return {
    sid: "sid-live-elsewhere",
    ideaId: "idea-OTHER",
    ideaTitle: "Another Idea",
    taskId: null,
    taskTitle: null,
    machineLabel: null,
    cwd: "/Users/nick/projects/other",
    claudeSessionId: null,
    displayName: null,
    createdAt: new Date().toISOString(),
    status: "active",
    endedAt: null,
  };
}

/** A live session on THIS board — belongs in `liveHere`, exercises
 * `onReconnectHere` → `performReattach` (rather than `onOpenBoardAndReconnect`,
 * which navigates away instead). */
function liveHereRow(): ChooserRegistryRow {
  return {
    sid: "sid-live-here",
    ideaId: "idea-1",
    ideaTitle: "My Idea",
    taskId: null,
    taskTitle: null,
    machineLabel: null,
    cwd: "/Users/nick/projects/here",
    claudeSessionId: null,
    displayName: null,
    createdAt: new Date().toISOString(),
    status: "active",
    endedAt: null,
  };
}

/** A live session on THIS board, scoped to `taskId` — the exact-task match
 * task-launch-skip-chooser's dedupe should find. */
function liveHereRowForTask(taskId: string): ChooserRegistryRow {
  return { ...liveHereRow(), sid: `sid-live-here-${taskId}`, taskId };
}

/** An ENDED session (within the 48h recent window), scoped to `taskId`. */
function recentRowForTask(taskId: string): ChooserRegistryRow {
  return {
    sid: `sid-recent-${taskId}`,
    ideaId: "idea-1",
    ideaTitle: "My Idea",
    taskId,
    taskTitle: "Do the thing",
    machineLabel: null,
    cwd: "/Users/nick/projects/here",
    claudeSessionId: null,
    displayName: null,
    createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    status: "ended",
    endedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1h ago — well within 48h
  };
}

/** Same as `recentRowForTask`, but on a DIFFERENT board (`idea-OTHER`) —
 * cross-board resume fix coverage: chooser-data.ts's Recent is never
 * idea-scoped, so this row is still offered on `idea-1`'s dock even though
 * it belongs elsewhere. */
function recentRowForTaskElsewhere(taskId: string): ChooserRegistryRow {
  return { ...recentRowForTask(taskId), sid: `sid-recent-elsewhere-${taskId}`, ideaId: "idea-OTHER" };
}

/** An ENDED, board-level (no taskId) session on THIS board — exercises the
 * general chooser's Resume action (not the task-scoped choice). */
function recentRowHere(): ChooserRegistryRow {
  return {
    sid: "sid-recent-here",
    ideaId: "idea-1",
    ideaTitle: "My Idea",
    taskId: null,
    taskTitle: null,
    machineLabel: null,
    cwd: "/Users/nick/projects/here",
    claudeSessionId: null,
    displayName: null,
    createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    status: "ended",
    endedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  };
}

/** Same as `recentRowHere`, but on a DIFFERENT board. */
function recentRowElsewhere(): ChooserRegistryRow {
  return { ...recentRowHere(), sid: "sid-recent-elsewhere", ideaId: "idea-OTHER" };
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_TERMINAL_ENABLED", "true");
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  mockSearchParams.current = new URLSearchParams();
  // The dock reads this tab's remembered sids/snapshots (session-snapshot.ts)
  // straight from sessionStorage on mount — clear it so one test's tab state
  // never leaks into the next.
  window.sessionStorage.clear();
});

describe("TerminalDock — launch-bus race with the still-loading registry (Bug B)", () => {
  it("never mints while the registry fetch is in flight, then delivers the queued launch once it resolves to empty-launch", async () => {
    const registry = deferredRegistryResponse();
    stubFetch(registry.promise);

    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);

    // The registry fetch is still in flight — nothing has minted yet.
    expect(screen.getByText(/Checking your sessions/)).toBeInTheDocument();
    expect(screen.queryByTestId("session-view")).not.toBeInTheDocument();

    // The toolbar's "Launch Claude Code" fires the launch bus WHILE the
    // fetch is still unresolved — the exact race QA pinned. The old bug
    // minted here, synchronously, before the fetch ever landed.
    act(() => {
      requestBrowserLaunch({ taskId: "task-9", taskTitle: "Do the thing" });
    });
    expect(screen.queryByTestId("session-view")).not.toBeInTheDocument();

    // The registry resolves with nothing live/recent anywhere → the decision
    // is "empty-launch" (nothing to choose between) — NOW it's safe to
    // deliver the queued launch, exactly as if the fetch had finished before
    // the click.
    registry.resolve([]);

    await waitFor(() => expect(screen.getByTestId("session-view")).toBeInTheDocument());
    expect(screen.getByTestId("session-view").dataset.taskId).toBe("task-9");
    expect(screen.getAllByTestId("session-view")).toHaveLength(1); // never double-minted
  });

  it("routes a raced BOARD-LEVEL launch into the chooser (never a blind mint) once the resolved decision has something to choose between", async () => {
    const registry = deferredRegistryResponse();
    stubFetch(registry.promise);

    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);

    // No taskId — a board-level launch (toolbar / dock "+"), unlike the
    // task-scoped tests further down (task-launch-skip-chooser, 2026-08-16):
    // a task-scoped launch now keys ONLY on whether ITS task has a match,
    // never on the global "is anything worth choosing between" decision this
    // test exercises.
    act(() => {
      requestBrowserLaunch();
    });
    expect(screen.queryByTestId("session-view")).not.toBeInTheDocument();
    expect(screen.queryByTestId("chooser")).not.toBeInTheDocument();

    // A live session on another board resolves once the fetch lands — the
    // decision is "chooser" (something worth choosing between), so the
    // queued launch must route there, never straight to a blind mint.
    registry.resolve([liveElsewhereRow()]);

    await waitFor(() => expect(screen.getByTestId("chooser")).toBeInTheDocument());
    expect(screen.queryByTestId("session-view")).not.toBeInTheDocument();
  });

  it("mints immediately with no race when the registry is already loaded before the click (unchanged behaviour)", async () => {
    stubFetch(Promise.resolve([]));

    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);
    // Registry already resolved to "empty-launch" — the dock seeds its usual
    // pristine tab with no launch-bus event involved at all.
    await waitFor(() => expect(screen.getByTestId("session-view")).toBeInTheDocument());
    expect(screen.getAllByTestId("session-view")).toHaveLength(1);
    // The empty-registry common case never shows the overlay, chooser, or
    // any other UI (rework 11 no-regression check).
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByTestId("chooser")).not.toBeInTheDocument();

    act(() => {
      requestBrowserLaunch({ taskId: "task-9", taskTitle: "Do the thing" });
    });

    // The pristine slot is reused in place — still exactly one tab, now
    // carrying the task launch (never a 2nd tab).
    await waitFor(() => expect(screen.getByTestId("session-view").dataset.taskId).toBe("task-9"));
    expect(screen.getAllByTestId("session-view")).toHaveLength(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("TerminalDock — chooser overlay when a tab is already open (rework 11, card cbe60db5)", () => {
  /** Gets the dock's registry-loaded chooser to mint a first, genuinely
   * local tab via its own "Start new session" action — the same path a real
   * user takes, and the only way to reach a non-empty `sessions` list
   * without relying on the bug this rework fixes. */
  async function openFirstTabViaChooser() {
    await waitFor(() => expect(screen.getByTestId("chooser")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("chooser-start-new"));
    await waitFor(() => expect(screen.getByTestId("session-view")).toBeInTheDocument());
    return screen.getByTestId("session-view").dataset.key;
  }

  it("routes a launch into the chooser overlay even though a local tab is already open — no longer gated on sessions.length === 0", async () => {
    stubFetch(Promise.resolve([liveElsewhereRow()]));
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);

    await openFirstTabViaChooser();
    expect(screen.getAllByTestId("session-view")).toHaveLength(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // The old bug: once ANY tab existed, `deliverLaunch` fell straight
    // through to `mintAndDeliver`, bypassing the chooser regardless of what
    // the registry still knew about (here, a live session on another
    // board). Firing the toolbar's launch again must still route through
    // the chooser — as an overlay, since a tab now exists.
    act(() => {
      requestBrowserLaunch();
    });

    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    // Never a blind 2nd mint — the overlay is showing instead of minting.
    expect(screen.getAllByTestId("session-view")).toHaveLength(1);
  });

  it("never unmounts the already-open tab's TerminalSessionView when the overlay opens", async () => {
    stubFetch(Promise.resolve([liveElsewhereRow()]));
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);

    const firstKey = await openFirstTabViaChooser();
    expect(sessionViewMountSpy).toHaveBeenCalledTimes(1);
    expect(sessionViewMountSpy).toHaveBeenCalledWith(firstKey);

    act(() => {
      requestBrowserLaunch();
    });
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    // Same tab, same key — never torn down and remounted underneath the
    // overlay. A real TerminalSessionView losing its mount would drop the
    // xterm buffer, the socket, and the heartbeat watchdog.
    expect(screen.getByTestId("session-view").dataset.key).toBe(firstKey);
    expect(sessionViewMountSpy).toHaveBeenCalledTimes(1);
    expect(sessionViewUnmountSpy).not.toHaveBeenCalled();
  });

  it("Start new inside the overlay mints a 2nd tab and closes the overlay, leaving the first tab untouched", async () => {
    stubFetch(Promise.resolve([liveElsewhereRow()]));
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);

    const firstKey = await openFirstTabViaChooser();
    act(() => {
      requestBrowserLaunch();
    });
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("chooser-start-new"));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getAllByTestId("session-view")).toHaveLength(2));
    const keys = screen.getAllByTestId("session-view").map((el) => el.dataset.key);
    expect(keys).toContain(firstKey); // appended a 2nd tab, never replaced the first
    expect(sessionViewUnmountSpy).not.toHaveBeenCalled();
  });

  it("Reconnect inside the overlay performs a non-destructive reattach (appends a tab) and closes the overlay, leaving the first tab untouched", async () => {
    stubFetch(Promise.resolve([liveHereRow()]));
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);

    const firstKey = await openFirstTabViaChooser();
    act(() => {
      requestBrowserLaunch();
    });
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId(`chooser-reconnect-here-${liveHereRow().sid}`));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getAllByTestId("session-view")).toHaveLength(2));
    const keys = screen.getAllByTestId("session-view").map((el) => el.dataset.key);
    expect(keys).toContain(firstKey); // appended, never replaced the existing tab
    expect(sessionViewUnmountSpy).not.toHaveBeenCalled();
  });

  it("Open board & reconnect inside the overlay closes it without minting or touching the existing tab", async () => {
    stubFetch(Promise.resolve([liveElsewhereRow()]));
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);

    const firstKey = await openFirstTabViaChooser();
    act(() => {
      requestBrowserLaunch();
    });
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId(`chooser-open-board-${liveElsewhereRow().sid}`));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // Navigates to the other board — nothing local minted, first tab intact.
    expect(screen.getAllByTestId("session-view")).toHaveLength(1);
    expect(screen.getByTestId("session-view").dataset.key).toBe(firstKey);
    expect(sessionViewUnmountSpy).not.toHaveBeenCalled();
  });
});

// Card 7ee218b1, Nick's field report 2026-08-23: with only one terminal
// open, the whole tab strip — including the rename pencil and the "+"
// button that starts a 2nd terminal — used to be hidden entirely (gated on
// `sessions.length > 1`). That made the side-by-side feature undiscoverable
// (its only entry point was invisible until a 2nd tab already existed) and
// made a lone session impossible to rename. The strip now shows at 1
// session too.
describe("TerminalDock — tab strip shows at a single session too (card 7ee218b1)", () => {
  async function openFirstTabViaChooser() {
    await waitFor(() => expect(screen.getByTestId("chooser")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("chooser-start-new"));
    await waitFor(() => expect(screen.getByTestId("session-view")).toBeInTheDocument());
    return screen.getByTestId("session-view").dataset.key as string;
  }

  it("shows the tab strip, the rename pencil and the '+' button with just one terminal open", async () => {
    stubFetch(Promise.resolve([liveElsewhereRow()]));
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);
    await openFirstTabViaChooser();

    expect(screen.getByRole("tablist", { name: "Terminal sessions" })).toBeInTheDocument();
    expect(screen.getByRole("tab")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Rename session/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New terminal session" })).toBeInTheDocument();
  });

  it("clicking '+' with only one terminal open delivers a launch — same routing every launch goes through (chooser, since another live session exists elsewhere)", async () => {
    stubFetch(Promise.resolve([liveElsewhereRow()]));
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);
    const firstKey = await openFirstTabViaChooser();

    fireEvent.click(screen.getByRole("button", { name: "New terminal session" }));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("chooser-start-new"));

    await waitFor(() => expect(screen.getAllByTestId("session-view")).toHaveLength(2));
    const keys = screen.getAllByTestId("session-view").map((el) => el.dataset.key);
    expect(keys).toContain(firstKey);
  });

  it("the split-view toggle is a no-op with only one terminal open — nothing to split against", async () => {
    stubFetch(Promise.resolve([liveElsewhereRow()]));
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);
    await openFirstTabViaChooser();

    fireEvent.click(screen.getByRole("button", { name: "Split view: show two sessions side by side" }));

    // Still exactly one tab, still tabbed (not paned) — the toggle must not
    // leave `paneKeys`/`splitPreferred` in a state that only a 2nd session
    // arriving would silently repair.
    expect(screen.getAllByTestId("session-view")).toHaveLength(1);
    expect(screen.getByRole("tablist", { name: "Terminal sessions" })).toBeInTheDocument();
  });
});

// Card cbe60db5, Nick's field report 2026-08-15 (Bug A): a hard refresh
// silently minted a brand-new session instead of reattaching, because the
// registry fetch's catch block collapsed EVERY failure into `[]` —
// indistinguishable from a genuinely empty registry, so `decideEntryBehaviour`
// routed to `empty-launch` and the seed effect auto-minted with no chooser
// and no visible error. This is the SAME null-vs-`[]` bug rework 9 already
// fixed for the still-loading path, reintroduced on the error path.
describe("TerminalDock — registry fetch failure never collapses into confirmed-empty (Bug A)", () => {
  it("keeps registryRows unresolved (never auto-mints) and surfaces a retryable error once every retry is exhausted", async () => {
    stubFlakyRegistryFetch(99); // fails every attempt within the retry budget

    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);

    // Still "checking…" throughout — a failed fetch must never masquerade as
    // a confirmed-empty registry.
    expect(screen.getByText(/Checking your sessions/)).toBeInTheDocument();

    await waitFor(() => expect(toast.error).toHaveBeenCalled(), { timeout: 5000 });
    const [, opts] = vi.mocked(toast.error).mock.calls[0] as [string, { action?: { label: string } }];
    expect(opts.action?.label).toBe("Retry");

    // Never auto-minted a fresh session — the old bug's exact failure mode —
    // and the dock is still honestly showing "still checking", not a chooser
    // or an empty-launch tab.
    expect(screen.queryByTestId("session-view")).not.toBeInTheDocument();
    expect(screen.getByText(/Checking your sessions/)).toBeInTheDocument();
  });

  it("recovers once a retry succeeds and proceeds with the resolved decision", async () => {
    stubFlakyRegistryFetch(1, []); // first attempt fails, the retry succeeds with a genuinely empty registry

    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);

    await waitFor(() => expect(screen.getByTestId("session-view")).toBeInTheDocument(), { timeout: 5000 });
    expect(toast.error).not.toHaveBeenCalled();
  });
});

// Task-launch-skip-chooser (Nick's explicit product decision, 2026-08-16):
// QA confirmed the cross-board chooser was working exactly as originally
// designed for EVERY launch source, task-scoped or not — Nick then decided
// that's wrong for a task-specific launch specifically. Clicking "Launch
// Claude Code" on a specific task is unambiguous intent: it must start
// immediately with NO chooser, UNLESS this EXACT task already has a
// live-or-recent session, in which case a small task-scoped choice (never
// the full cross-board chooser) is the only interstitial allowed.
describe("TerminalDock — task-launch-skip-chooser (Nick's explicit product decision, 2026-08-16)", () => {
  it("auto-starts a task launch with no chooser at all when this exact task has no existing session, even though other sessions exist elsewhere", async () => {
    // A live session exists (on another board, for no particular task) —
    // under the OLD behaviour this alone put the global decision at
    // "chooser" and would have blocked every launch, task-scoped or not.
    stubFetch(Promise.resolve([liveElsewhereRow()]));
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);

    act(() => {
      requestBrowserLaunch({ taskId: "task-9", taskTitle: "Do the thing" });
    });

    await waitFor(() => expect(screen.getByTestId("session-view")).toBeInTheDocument());
    expect(screen.getByTestId("session-view").dataset.taskId).toBe("task-9");
    expect(screen.queryByTestId("chooser")).not.toBeInTheDocument();
    expect(screen.queryByTestId("task-choice")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the minimal task-scoped choice (never the full chooser) when this exact task already has a LIVE session", async () => {
    stubFetch(Promise.resolve([liveHereRowForTask("task-9"), liveElsewhereRow()]));
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);

    act(() => {
      requestBrowserLaunch({ taskId: "task-9", taskTitle: "Do the thing" });
    });

    await waitFor(() => expect(screen.getByTestId("task-choice")).toBeInTheDocument());
    expect(screen.getByTestId("task-choice").dataset.matchKind).toBe("live-here");
    expect(screen.getByTestId("task-choice").dataset.matchSid).toBe("sid-live-here-task-9");
    // Never the full generic chooser — no cross-board content, no other tasks.
    expect(screen.queryByTestId("chooser")).not.toBeInTheDocument();
    expect(screen.queryByTestId("session-view")).not.toBeInTheDocument();
  });

  it("shows the minimal task-scoped choice when this exact task has a RECENT (ended, ≤48h) session", async () => {
    stubFetch(Promise.resolve([recentRowForTask("task-9")]));
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);

    act(() => {
      requestBrowserLaunch({ taskId: "task-9", taskTitle: "Do the thing" });
    });

    await waitFor(() => expect(screen.getByTestId("task-choice")).toBeInTheDocument());
    expect(screen.getByTestId("task-choice").dataset.matchKind).toBe("recent");
    expect(screen.queryByTestId("chooser")).not.toBeInTheDocument();
    expect(screen.queryByTestId("session-view")).not.toBeInTheDocument();
  });

  // Card 79a0046c (Nick's field report, 2026-08-19): the ended session for
  // this task had no recorded folder, so the choice dialog opened with Resume
  // hidden and "Start fresh anyway" as its ONLY button — an interstitial in
  // front of the exact mint it was gating. Nothing to choose between → don't
  // ask; just start, same as if no session existed.
  it("auto-starts when this task's only RECENT session has no recorded folder — no dead-end one-button dialog", async () => {
    stubFetch(Promise.resolve([{ ...recentRowForTask("task-9"), cwd: null }]));
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);

    act(() => {
      requestBrowserLaunch({ taskId: "task-9", taskTitle: "Do the thing" });
    });

    await waitFor(() => expect(screen.getByTestId("session-view")).toBeInTheDocument());
    expect(screen.getByTestId("session-view").dataset.taskId).toBe("task-9");
    expect(screen.queryByTestId("task-choice")).not.toBeInTheDocument();
    expect(screen.queryByTestId("chooser")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // The skip is scoped to unresumable ENDED sessions. A RUNNING one still
  // stops the launch even with no folder recorded — reattaching to a live
  // session never needed one, so Reconnect is a genuine second option.
  it("still shows the task choice when this task's LIVE session has no recorded folder", async () => {
    stubFetch(Promise.resolve([{ ...liveHereRowForTask("task-9"), cwd: null }]));
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);

    act(() => {
      requestBrowserLaunch({ taskId: "task-9", taskTitle: "Do the thing" });
    });

    await waitFor(() => expect(screen.getByTestId("task-choice")).toBeInTheDocument());
    expect(screen.getByTestId("task-choice").dataset.matchKind).toBe("live-here");
    expect(screen.queryByTestId("session-view")).not.toBeInTheDocument();
  });

  it("auto-starts (no false-positive dedupe) when the only existing session belongs to a DIFFERENT task", async () => {
    stubFetch(Promise.resolve([liveHereRowForTask("task-OTHER")]));
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);

    act(() => {
      requestBrowserLaunch({ taskId: "task-9", taskTitle: "Do the thing" });
    });

    await waitFor(() => expect(screen.getByTestId("session-view")).toBeInTheDocument());
    expect(screen.getByTestId("session-view").dataset.taskId).toBe("task-9");
    expect(screen.queryByTestId("task-choice")).not.toBeInTheDocument();
    expect(screen.queryByTestId("chooser")).not.toBeInTheDocument();
  });

  it("Reconnect inside the task choice reattaches the exact-task live session", async () => {
    stubFetch(Promise.resolve([liveHereRowForTask("task-9")]));
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);

    act(() => {
      requestBrowserLaunch({ taskId: "task-9", taskTitle: "Do the thing" });
    });
    await waitFor(() => expect(screen.getByTestId("task-choice")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("task-choice-reconnect"));

    await waitFor(() => expect(screen.queryByTestId("task-choice")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("session-view")).toBeInTheDocument());
  });

  it("Start fresh anyway inside the task choice mints a brand-new session for the task, ignoring the match", async () => {
    stubFetch(Promise.resolve([liveHereRowForTask("task-9")]));
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);

    act(() => {
      requestBrowserLaunch({ taskId: "task-9", taskTitle: "Do the thing" });
    });
    await waitFor(() => expect(screen.getByTestId("task-choice")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("task-choice-start-fresh"));

    await waitFor(() => expect(screen.queryByTestId("task-choice")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("session-view")).toBeInTheDocument());
    expect(screen.getByTestId("session-view").dataset.taskId).toBe("task-9");
  });

  it("still queues a task launch during the still-loading registry race, then resolves to the minimal task choice once the match is known", async () => {
    const registry = deferredRegistryResponse();
    stubFetch(registry.promise);

    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);

    act(() => {
      requestBrowserLaunch({ taskId: "task-9", taskTitle: "Do the thing" });
    });
    expect(screen.queryByTestId("session-view")).not.toBeInTheDocument();
    expect(screen.queryByTestId("task-choice")).not.toBeInTheDocument();

    registry.resolve([liveHereRowForTask("task-9")]);

    await waitFor(() => expect(screen.getByTestId("task-choice")).toBeInTheDocument());
    expect(screen.queryByTestId("chooser")).not.toBeInTheDocument();
    expect(screen.queryByTestId("session-view")).not.toBeInTheDocument();
  });
});

// Card eaa55290 (Nick's field report, 2026-08-17): "no way to tell another
// session is already active on this board" — Nick ran two terminal tabs on
// the same board at once with no indication either existed, only noticing
// via one tab's own internal narration text. The persistent badge below is
// driven by `liveSessionsElsewhereOnThisBoard` (chooser-data.ts, unit-tested
// there); this suite covers it wired into the actual dock bar, which is
// ALWAYS rendered (collapsed and expanded both show the same top bar — only
// the body below it toggles).
describe("TerminalDock — another-session-here badge (card eaa55290)", () => {
  /** A registry fetch stub whose `/api/terminal/session/list` response
   * changes across calls (`sequence[n]`, clamped to the last entry) and
   * whose `/api/terminal/session/reattach` always fails — the same
   * `void refreshRegistry()`-on-failure fallback the "Bug A" retry tests
   * above exercise, reused here as the trigger for a live registry update. */
  function stubRegistrySequenceWithFailingReattach(sequence: ChooserRegistryRow[][]) {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url === "/api/terminal/session/list") {
          const rows = sequence[Math.min(call, sequence.length - 1)];
          call += 1;
          return Promise.resolve({ ok: true, json: async () => ({ sessions: rows }) });
        }
        if (url === "/api/terminal/session/reattach") {
          return Promise.resolve({ ok: false, json: async () => ({ error: "Session ended" }) });
        }
        return Promise.resolve({ ok: false, json: async () => ({}) });
      }),
    );
  }

  it("stays hidden when no session is live on this board", async () => {
    stubFetch(Promise.resolve([]));
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);

    await waitFor(() => expect(screen.getByTestId("session-view")).toBeInTheDocument());
    expect(screen.queryByText(/tabs? .* open here/)).not.toBeInTheDocument();
  });

  it("stays hidden when the only live session here is this tab's own", async () => {
    rememberLastTabSid("own-sid");
    stubFetch(Promise.resolve([{ ...liveHereRow(), sid: "own-sid" }]));
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);

    await waitFor(() => expect(screen.getByTestId("chooser")).toBeInTheDocument());
    expect(screen.queryByText(/tabs? .* open here/)).not.toBeInTheDocument();
  });

  it("shows singular copy for exactly one other live session on this board", async () => {
    rememberLastTabSid("own-sid");
    stubFetch(
      Promise.resolve([
        { ...liveHereRow(), sid: "own-sid" },
        { ...liveHereRow(), sid: "other-sid" },
      ]),
    );
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);

    await waitFor(() => expect(screen.getByText("Another tab is open here")).toBeInTheDocument());
    // Never worded as a stranger's session — Phase 1 is same-user-only (the
    // investigation step confirmed terminal_sessions RLS is owner-only).
    expect(screen.queryByText(/someone else/i)).not.toBeInTheDocument();
  });

  it("shows a count for 2+ other live sessions on this board", async () => {
    rememberLastTabSid("own-sid");
    stubFetch(
      Promise.resolve([
        { ...liveHereRow(), sid: "own-sid" },
        { ...liveHereRow(), sid: "other-sid-1" },
        { ...liveHereRow(), sid: "other-sid-2" },
      ]),
    );
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);

    await waitFor(() => expect(screen.getByText("2 other tabs are open here")).toBeInTheDocument());
  });

  it("never counts a live session on a DIFFERENT board", async () => {
    rememberLastTabSid("own-sid");
    stubFetch(Promise.resolve([{ ...liveHereRow(), sid: "own-sid" }, liveElsewhereRow()]));
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);

    await waitFor(() => expect(screen.getByTestId("chooser")).toBeInTheDocument());
    expect(screen.queryByText(/tabs? .* open here/)).not.toBeInTheDocument();
  });

  it("updates reactively — appears once a registry refresh reveals a 2nd live session here", async () => {
    rememberLastTabSid("own-sid");
    const ownRow = { ...liveHereRow(), sid: "own-sid" };
    const otherRow = { ...liveHereRow(), sid: "other-sid" };
    stubRegistrySequenceWithFailingReattach([[ownRow], [ownRow, otherRow]]);

    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);

    await waitFor(() => expect(screen.getByTestId("chooser")).toBeInTheDocument());
    expect(screen.queryByText(/tabs? .* open here/)).not.toBeInTheDocument();

    // Force a registry refresh via the same fallback `performReattach`'s
    // failure path already triggers (see the Bug A retry tests above) —
    // clicking "Reconnect here" on the sole (own) live-here row, whose
    // reattach is stubbed to fail, so the dock's own `refreshRegistry()`
    // runs and picks up the 2nd row.
    fireEvent.click(screen.getByTestId("chooser-reconnect-here-own-sid"));

    await waitFor(() => expect(screen.getByText("Another tab is open here")).toBeInTheDocument());
  });
});

// Cross-board resume fix (bug 62e57071, Sentinel's investigation): resuming
// a Recent row belonging to a DIFFERENT board used to mint a session under
// WHICHEVER board's dock happened to be open, carrying the foreign row's
// task/cwd along with it. These pin the fix at both origination points
// (the general chooser's Resume, and the task-launch-skip-chooser's recent
// arm) — same-board resumes must mint exactly as before (no navigation, no
// extra click) — plus the `?resume=<sid>` pickup a cross-board navigation
// lands on.
describe("TerminalDock — cross-board resume (bug 62e57071)", () => {
  it("chooser Resume on a SAME-board Recent row mints locally, unchanged — no navigation", async () => {
    stubFetch(Promise.resolve([recentRowHere()]));
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);

    await waitFor(() => expect(screen.getByTestId("chooser")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId(`chooser-resume-${recentRowHere().sid}`));

    await waitFor(() => expect(screen.getByTestId("session-view")).toBeInTheDocument());
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it("chooser Resume on a CROSS-board Recent row navigates to that row's own board instead of minting here", async () => {
    stubFetch(Promise.resolve([recentRowElsewhere()]));
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);

    await waitFor(() => expect(screen.getByTestId("chooser")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId(`chooser-resume-${recentRowElsewhere().sid}`));

    expect(mockRouterPush).toHaveBeenCalledWith(
      `/ideas/idea-OTHER/board?resume=${encodeURIComponent(recentRowElsewhere().sid)}`,
    );
    // Nothing minted locally under this (wrong) board.
    expect(screen.queryByTestId("session-view")).not.toBeInTheDocument();
  });

  it("the task-choice recent arm mints locally for a SAME-board task match, unchanged", async () => {
    stubFetch(Promise.resolve([recentRowForTask("task-9")]));
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);

    act(() => {
      requestBrowserLaunch({ taskId: "task-9", taskTitle: "Do the thing" });
    });
    await waitFor(() => expect(screen.getByTestId("task-choice")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("task-choice-reconnect"));

    await waitFor(() => expect(screen.getByTestId("session-view")).toBeInTheDocument());
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it("the task-choice recent arm ALSO navigates for a cross-board task match, instead of minting here (propagation: closes the 2nd origination point)", async () => {
    stubFetch(Promise.resolve([recentRowForTaskElsewhere("task-9")]));
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);

    act(() => {
      requestBrowserLaunch({ taskId: "task-9", taskTitle: "Do the thing" });
    });
    await waitFor(() => expect(screen.getByTestId("task-choice")).toBeInTheDocument());
    expect(screen.getByTestId("task-choice").dataset.matchKind).toBe("recent");

    fireEvent.click(screen.getByTestId("task-choice-reconnect"));

    expect(mockRouterPush).toHaveBeenCalledWith(
      `/ideas/idea-OTHER/board?resume=${encodeURIComponent(recentRowForTaskElsewhere("task-9").sid)}`,
    );
    expect(screen.queryByTestId("session-view")).not.toBeInTheDocument();
  });

  it("landing with ?resume=<sid> mints the matching Recent row from THIS board's own (idea-unscoped) registry fetch, with no chooser shown", async () => {
    mockSearchParams.current = new URLSearchParams({ resume: recentRowHere().sid });
    stubFetch(Promise.resolve([recentRowHere()]));
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);

    await waitFor(() => expect(screen.getByTestId("session-view")).toBeInTheDocument());
    expect(screen.queryByTestId("chooser")).not.toBeInTheDocument();
  });

  it("landing with ?resume=<sid> for a row that's no longer in the registry surfaces a toast instead of silently doing nothing", async () => {
    mockSearchParams.current = new URLSearchParams({ resume: "sid-long-gone" });
    stubFetch(Promise.resolve([]));
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/expired/)));
    // An empty registry is also "empty-launch" (F1's unchanged idle P1 slot)
    // — that pristine tab is expected here (never a resume-mint carrying the
    // vanished row's data), so only its shape is asserted, not its absence.
    expect(screen.getByTestId("session-view").dataset.taskId).toBe("");
  });

  // Perpetuation fix (Sentinel's finding — "perpetuates a mis-file forever"):
  // an already-mounted tab's OWN "Resume this conversation" button must
  // obey the same board-correctness the chooser/task-choice Resume actions
  // above do, or a session that was ever mis-filed onto the wrong board
  // keeps re-minting under that same wrong board every time someone clicks
  // Resume on it — this is the PERPETUATION point, not just the origination
  // point the tests above cover. QA mutation-tested `handleResumeEndedSession`
  // by gutting its routing decision to an unconditional mint; that mutation
  // survived every other test in this suite untouched, so this test exists
  // specifically to kill it.
  it("an already-mounted tab's own Resume navigates to the entry's own board when it differs from the current one — never an in-place mint", async () => {
    stubFetch(Promise.resolve([]));
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);

    // The dock auto-seeds one pristine tab for an empty registry (F1) — its
    // `entry.ideaId` starts unset (createPristineEntry never sets it). A
    // board-level launch carrying a FOREIGN `ideaId` reuses that pristine
    // slot (mintAndDeliver's pristine-reuse path), giving this tab a
    // recorded board that differs from the one currently open — exactly the
    // "already mis-filed" precondition this fix exists for.
    await waitFor(() => expect(screen.getByTestId("session-view")).toBeInTheDocument());
    act(() => {
      requestBrowserLaunch({ ideaId: "idea-OTHER" });
    });
    await waitFor(() => expect(screen.getByTestId("session-view").dataset.ideaId).toBe("idea-OTHER"));
    expect(screen.getAllByTestId("session-view")).toHaveLength(1); // reused the pristine slot, no 2nd tab

    const key = screen.getByTestId("session-view").dataset.key;
    fireEvent.click(screen.getByTestId(`resume-ended-${key}`));

    expect(mockRouterPush).toHaveBeenCalledWith(
      `/ideas/idea-OTHER/board?resume=${encodeURIComponent("sid-ended-own-tab")}`,
    );
    // Never minted a 2nd tab in place under the wrong (currently open) board.
    expect(screen.getAllByTestId("session-view")).toHaveLength(1);
  });

  it("an already-mounted tab's own Resume mints in place (no navigation) when its recorded board matches the current one", async () => {
    stubFetch(Promise.resolve([]));
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);

    await waitFor(() => expect(screen.getByTestId("session-view")).toBeInTheDocument());
    // Same setup as the cross-board test above, but the launch's `ideaId`
    // matches the currently-open board this time.
    act(() => {
      requestBrowserLaunch({ ideaId: "idea-1" });
    });
    await waitFor(() => expect(screen.getByTestId("session-view").dataset.ideaId).toBe("idea-1"));

    const key = screen.getByTestId("session-view").dataset.key;
    fireEvent.click(screen.getByTestId(`resume-ended-${key}`));

    expect(mockRouterPush).not.toHaveBeenCalled();
    // A genuine local mint happened (never a silent no-op) — this board's
    // own dock delivered the resume itself instead of navigating away. This
    // test never puts the tab into a reported "ended" state (see the
    // dedicated reclaim test just below for that), so mintAndDeliver's
    // reclaim check can't match and it falls through to appending — the
    // pristine slot was already used by the `requestBrowserLaunch` above,
    // so this is a genuine 2nd tab.
    await waitFor(() => expect(screen.getAllByTestId("session-view")).toHaveLength(2));
  });

  // Card df29b85e (field report 22 Aug 2026): "Resuming an ended terminal
  // session correctly mints a NEW session, but the dock always opens it in a
  // NEW tab, leaving the dead tab behind." Same setup as the test just
  // above — same-board resume — but this one first drives the tab into a
  // reported "session-ended" state with the SAME sid the "Resume this
  // conversation" button fires (`report-ended-own-sid-${key}`, see the stub's
  // doc), so `mintAndDeliver`'s ended-tab reclaim (`findReclaimableEndedSlot`)
  // has what it needs to take this exact tab over instead of appending a
  // sibling next to it.
  it("an already-mounted tab's own Resume reclaims that SAME tab in place — never leaves the dead tab behind (card df29b85e)", async () => {
    stubFetch(Promise.resolve([]));
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);

    await waitFor(() => expect(screen.getByTestId("session-view")).toBeInTheDocument());
    act(() => {
      requestBrowserLaunch({ ideaId: "idea-1" });
    });
    await waitFor(() => expect(screen.getByTestId("session-view").dataset.ideaId).toBe("idea-1"));

    const key = screen.getByTestId("session-view").dataset.key;
    fireEvent.click(screen.getByTestId(`report-ended-own-sid-${key}`));
    fireEvent.click(screen.getByTestId(`resume-ended-${key}`));

    // Still exactly one tab, and it's the SAME tab (same key) — reclaimed in
    // place, not replaced by a new one leaving the ended tab behind.
    expect(screen.getAllByTestId("session-view")).toHaveLength(1);
    expect(screen.getByTestId("session-view").dataset.key).toBe(key);
  });
});

// Nick's field report, 2026-08-19. From an ENDED session he clicked "View my
// other sessions" and got the "My sessions" popup — which filters to
// `status === "active"` by construction (terminal-my-sessions-panel.tsx's
// `running` memo), so it can never contain the ended/resumable rows the
// link's own wording promises. The list he wanted — "Recent — ended in the
// last 48h", with a per-row Resume — lives in the CHOOSER, and until now the
// only way to reach it was the toolbar's Launch Claude Code.
//
// `onCapExceeded` keeps pointing at the My sessions panel on purpose: a cap
// refusal genuinely IS about what's running, so that list is the right one
// there. Only the ended panel's browse link moved.
describe("TerminalDock — ended panel's 'View my other sessions' opens the chooser, not the running-only panel (Nick's field report 2026-08-19)", () => {
  async function openFirstTabViaChooser() {
    await waitFor(() => expect(screen.getByTestId("chooser")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("chooser-start-new"));
    await waitFor(() => expect(screen.getByTestId("session-view")).toBeInTheDocument());
  }

  it("opens the chooser overlay — the list that actually has resumable ended sessions in it", async () => {
    // A recent ENDED row is exactly what the old wiring could never show.
    stubFetch(Promise.resolve([recentRowForTask("task-9")]));
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);

    await openFirstTabViaChooser();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("view-my-other-sessions"));

    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    // The whole point: the ended row is present and offers Resume.
    expect(screen.getByTestId("chooser-resume-sid-recent-task-9")).toBeInTheDocument();
  });

  it("never mints a session just for looking", async () => {
    stubFetch(Promise.resolve([recentRowForTask("task-9")]));
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);

    await openFirstTabViaChooser();
    fireEvent.click(screen.getByTestId("view-my-other-sessions"));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    expect(screen.getAllByTestId("session-view")).toHaveLength(1);
    expect(sessionViewUnmountSpy).not.toHaveBeenCalled();
  });

  it("is dismissible — browsing has no pending launch to resolve, so Escape closes it", async () => {
    stubFetch(Promise.resolve([recentRowForTask("task-9")]));
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);

    await openFirstTabViaChooser();
    fireEvent.click(screen.getByTestId("view-my-other-sessions"));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape", code: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // Backed out of, not acted on — no new tab, and the open one is intact.
    expect(screen.getAllByTestId("session-view")).toHaveLength(1);
    expect(sessionViewUnmountSpy).not.toHaveBeenCalled();
  });

  it("a LAUNCH-opened overlay can be escaped too (Nick, 2026-08-19) — and abandoning it launches nothing", async () => {
    stubFetch(Promise.resolve([liveElsewhereRow()]));
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);

    await openFirstTabViaChooser();
    act(() => {
      requestBrowserLaunch();
    });
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape", code: "Escape" });

    // Nothing is minted until a click inside the chooser, so backing out of a
    // fired launch is free — and a dialog with no exit is a trap, whatever
    // the launch was supposed to resolve to.
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // Backed out, not acted on: no new tab, and the open one is untouched.
    expect(screen.getAllByTestId("session-view")).toHaveLength(1);
  });

  it("the launch overlay also offers an explicit Close, not just the corner X", async () => {
    stubFetch(Promise.resolve([liveElsewhereRow()]));
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);

    await openFirstTabViaChooser();
    act(() => {
      requestBrowserLaunch();
    });
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /^Close$/ }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getAllByTestId("session-view")).toHaveLength(1);
  });

  it("resuming an ended session from the browse overlay closes it and launches with that row's own folder and conversation", async () => {
    const ended = { ...recentRowForTask("task-9"), claudeSessionId: "claude-conv-xyz" };
    stubFetch(Promise.resolve([ended]));
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);

    await openFirstTabViaChooser();
    fireEvent.click(screen.getByTestId("view-my-other-sessions"));
    await waitFor(() => expect(screen.getByTestId("chooser-resume-sid-recent-task-9")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("chooser-resume-sid-recent-task-9"));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getAllByTestId("session-view")).toHaveLength(2));
    // Carries the ended row's task through, so the resumed tab is the same
    // piece of work — not a blank session in the same folder.
    const taskIds = screen.getAllByTestId("session-view").map((el) => el.dataset.taskId);
    expect(taskIds).toContain("task-9");
  });
});

// Nick's follow-up, 2026-08-19: "why do we have this brand new popup, rather
// than it just switching to show all this in the terminal panel?" The
// chooser already renders IN the panel — but the rule was `sessions.length
// === 0`, i.e. "no tabs at all", so an ended tab was enough to force the
// overlay. The overlay's actual purpose is protecting a LIVE terminal
// underneath (swapping the body would tear down its xterm instance, socket
// and scrollback); an ended tab has none of that to protect. The rule is now
// liveness, not tab count.
describe("TerminalDock — browsing renders IN the panel when nothing is running, overlay only when a live tab needs protecting (Nick's follow-up 2026-08-19)", () => {
  async function openFirstTabViaChooser() {
    await waitFor(() => expect(screen.getByTestId("chooser")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("chooser-start-new"));
    await waitFor(() => expect(screen.getByTestId("session-view")).toBeInTheDocument());
    return screen.getByTestId("session-view").dataset.key as string;
  }

  /** Drives the (stubbed) tab to a genuine "session-ended" status, the state
   * Nick was actually in when he followed the link. Synchronous — fireEvent
   * flushes the resulting setState — and it needs no assertion of its own:
   * every caller then asserts on the panel-vs-overlay branch, which only
   * takes the panel route if this actually landed. */
  function endTab(key: string) {
    fireEvent.click(screen.getByTestId(`report-ended-${key}`));
  }

  it("browsing from an ENDED tab renders the chooser in the panel — no dialog at all", async () => {
    stubFetch(Promise.resolve([recentRowForTask("task-9")]));
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);

    const key = await openFirstTabViaChooser();
    endTab(key);

    fireEvent.click(screen.getByTestId("view-my-other-sessions"));

    await waitFor(() => expect(screen.getByTestId("chooser")).toBeInTheDocument());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // Same list, same actions — it's the panel that changed, not the content.
    expect(screen.getByTestId("chooser-resume-sid-recent-task-9")).toBeInTheDocument();
  });

  it("keeps the ended tab MOUNTED underneath so 'Back to terminal' returns to its scrollback, not an empty terminal", async () => {
    stubFetch(Promise.resolve([recentRowForTask("task-9")]));
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);

    const key = await openFirstTabViaChooser();
    endTab(key);
    fireEvent.click(screen.getByTestId("view-my-other-sessions"));
    await waitFor(() => expect(screen.getByTestId("chooser")).toBeInTheDocument());

    // Hidden by CSS, never torn down — the ended panel promises "The
    // scrollback above is kept", and unmounting would break that promise the
    // moment someone glanced at their session list.
    expect(sessionViewUnmountSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId("session-view")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Back to terminal/ }));

    await waitFor(() => expect(screen.queryByTestId("chooser")).not.toBeInTheDocument());
    expect(sessionViewUnmountSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId("session-view").dataset.key).toBe(key);
  });

  it("still uses the OVERLAY while a tab is live — the panel must not be swapped out from under a running terminal", async () => {
    stubFetch(Promise.resolve([recentRowForTask("task-9")]));
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);

    // Tab left at its default (never reported ended) — the dock reads that as
    // live, exactly like a connected or still-connecting session.
    await openFirstTabViaChooser();

    fireEvent.click(screen.getByTestId("view-my-other-sessions"));

    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Back to terminal/ })).not.toBeInTheDocument();
  });

  it("a LAUNCH still overlays even with every tab ended — but it can be escaped", async () => {
    stubFetch(Promise.resolve([liveElsewhereRow()]));
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);

    const key = await openFirstTabViaChooser();
    endTab(key);

    act(() => {
      requestBrowserLaunch();
    });

    // A launch still gets the overlay (it sits on top of a body that is about
    // to be replaced anyway) — but it is no longer a dead end.
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape", code: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("resuming from the in-panel list works the same as from the overlay", async () => {
    stubFetch(Promise.resolve([recentRowForTask("task-9")]));
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);

    const key = await openFirstTabViaChooser();
    endTab(key);
    fireEvent.click(screen.getByTestId("view-my-other-sessions"));
    await waitFor(() => expect(screen.getByTestId("chooser-resume-sid-recent-task-9")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("chooser-resume-sid-recent-task-9"));

    await waitFor(() => expect(screen.getAllByTestId("session-view")).toHaveLength(2));
    const taskIds = screen.getAllByTestId("session-view").map((el) => el.dataset.taskId);
    expect(taskIds).toContain("task-9");
    // The list gave way to the terminal again once acted on.
    expect(screen.queryByTestId("chooser")).not.toBeInTheDocument();
  });

  it("Start New Session from an ended tab's own browse link takes over that tab instead of opening a second one (bug report 2026-08-23)", async () => {
    stubFetch(Promise.resolve([recentRowForTask("task-9")]));
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);

    const key = await openFirstTabViaChooser();
    endTab(key);
    fireEvent.click(screen.getByTestId("view-my-other-sessions"));
    await waitFor(() => expect(screen.getByTestId("chooser-start-new")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("chooser-start-new"));

    await waitFor(() => expect(screen.queryByTestId("chooser")).not.toBeInTheDocument());
    // Reclaimed the SAME tab in place — not a sibling next to its corpse.
    expect(screen.getAllByTestId("session-view")).toHaveLength(1);
    expect(screen.getByTestId("session-view").dataset.key).toBe(key);
  });
});

describe("TerminalDock — resize handle hidden while the active tab is popped out (card 534d2049, AC3 rework)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the drag handle for an expanded, docked session, then hides it the moment that session pops out", async () => {
    stubFetch(Promise.resolve([]));
    // jsdom has no real window.open — stand in a bare object `openPopoutWindow`
    // (popout-channel.ts) can set `.opener = null` on without throwing, so
    // `handlePopOut` proceeds past its popup-blocked guard exactly like a real
    // successful pop-out.
    vi.spyOn(window, "open").mockReturnValue({ opener: {} } as unknown as Window);

    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);
    await waitFor(() => expect(screen.getByTestId("session-view")).toBeInTheDocument());
    const key = screen.getByTestId("session-view").dataset.key as string;

    fireEvent.click(screen.getByRole("button", { name: "Expand terminal panel" }));
    expect(screen.getByTestId("terminal-dock-resize-handle")).toBeInTheDocument();

    // `handlePopOut` bails out silently unless the tab already carries a
    // minted sessionId + browserToken — give it one before popping out.
    fireEvent.click(screen.getByTestId(`report-connected-${key}`));
    fireEvent.click(screen.getByTestId(`pop-out-${key}`));

    // There is nothing to resize once the active face is the compact
    // placeholder (terminal-session-view.tsx) — a live handle over it would
    // invite a drag with no terminal body underneath.
    expect(screen.queryByTestId("terminal-dock-resize-handle")).not.toBeInTheDocument();
  });
});

// Split-view focus-sync defect fix (task df7a0134, QA rework — category-1,
// blocks-release). QA's finding: real DOM keyboard focus could diverge from
// the "Typing here"/"Watching" indicator — nothing in the previous
// implementation listened for focus arriving anywhere OTHER than a click,
// and native Tab order could walk straight into the "Watching" pane's real
// input, since nothing constrained its tabIndex either. These tests render
// BOTH panes (via the mock TerminalSessionView's `paneFocused`/`grabFocus`/
// `onPaneFocusChange` stand-ins above — real xterm/focus wiring is covered
// directly in use-terminal-session.test.ts) and assert the DOCK's own
// state — `focusedSide` + the new `keyboardLive` ground truth — follows
// SIMULATED real focus/blur events, not just clicks, including the exact
// Tab-into-the-watching-pane path from QA's repro.
describe("TerminalDock — split view keyboard-focus sync (defect fix, task df7a0134)", () => {
  /** Mints a 2nd local tab via the chooser's "Start new" (mirrors
   * `openFirstTabViaChooser` above, generalised to N tabs) — the only way to
   * reach 2+ eligible sessions without relying on the bug that describe
   * block covers. Returns every session's key, in mint order. */
  async function mintTwoSessions(): Promise<[string, string]> {
    await waitFor(() => expect(screen.getByTestId("chooser")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("chooser-start-new"));
    await waitFor(() => expect(screen.getByTestId("session-view")).toBeInTheDocument());
    const firstKey = screen.getByTestId("session-view").dataset.key as string;

    act(() => {
      requestBrowserLaunch();
    });
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("chooser-start-new"));
    await waitFor(() => expect(screen.getAllByTestId("session-view")).toHaveLength(2));

    const keys = screen.getAllByTestId("session-view").map((el) => el.dataset.key as string);
    const secondKey = keys.find((k) => k !== firstKey) as string;
    return [firstKey, secondKey];
  }

  function enterSplitView() {
    fireEvent.click(screen.getByRole("button", { name: "Split view: show two sessions side by side" }));
  }

  function indicatorTextFor(key: string): string {
    return screen.getByTestId(`pane-indicator-${key}`).textContent ?? "";
  }

  function findFocused(keys: [string, string]): string {
    const [a, b] = keys;
    if (indicatorTextFor(a) === "Typing here") return a;
    if (indicatorTextFor(b) === "Typing here") return b;
    throw new Error("neither pane reports 'Typing here'");
  }

  it("entering split view marks exactly one pane 'Typing here' and removes the OTHER pane's input from native Tab order (tabIndex -1) — the fix for QA's exact repro", async () => {
    stubFetch(Promise.resolve([liveElsewhereRow()]));
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);
    const [keyA, keyB] = await mintTwoSessions();

    enterSplitView();
    await waitFor(() => expect(screen.getByTestId(`pane-indicator-${keyA}`)).toBeInTheDocument());

    const focused = findFocused([keyA, keyB]);
    const watching = focused === keyA ? keyB : keyA;
    expect(indicatorTextFor(watching)).toBe("Watching");

    // The invariant the defect broke: the pane the indicator calls "Typing
    // here" must be the ONLY one a native Tab press can reach. `tabIndex=-1`
    // excludes an element from sequential navigation entirely (it stays
    // reachable by click/chord, which use `.focus()` directly).
    expect((screen.getByTestId(`pane-input-${focused}`) as HTMLInputElement).tabIndex).toBe(0);
    expect((screen.getByTestId(`pane-input-${watching}`) as HTMLInputElement).tabIndex).toBe(-1);
  });

  it("real focus landing on the 'Watching' pane's input — exactly what native Tab does now that it CAN reach it, or anything else that moves DOM focus there — flips the indicator instead of leaving it lying", async () => {
    stubFetch(Promise.resolve([liveElsewhereRow()]));
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);
    const [keyA, keyB] = await mintTwoSessions();

    enterSplitView();
    await waitFor(() => expect(screen.getByTestId(`pane-indicator-${keyA}`)).toBeInTheDocument());
    const focused = findFocused([keyA, keyB]);
    const watching = focused === keyA ? keyB : keyA;

    // Simulates real DOM focus arriving on the watching pane's input with NO
    // click involved — before this fix, nothing was listening for this at
    // all, so `focusedSide` (and the indicator) would have kept claiming the
    // OTHER pane was "Typing here" while this one genuinely held the
    // keyboard. This is the class of bug QA reproduced with a real Tab press.
    fireEvent.focus(screen.getByTestId(`pane-input-${watching}`));

    await waitFor(() => expect(indicatorTextFor(watching)).toBe("Typing here"));
    expect(indicatorTextFor(focused)).toBe("Watching");
  });

  it("focus leaving BOTH panes (a blur with no followup focus — click elsewhere on the page, window blur) clears 'Typing here' from both, never leaving a stale claim", async () => {
    stubFetch(Promise.resolve([liveElsewhereRow()]));
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);
    const [keyA, keyB] = await mintTwoSessions();

    enterSplitView();
    await waitFor(() => expect(screen.getByTestId(`pane-indicator-${keyA}`)).toBeInTheDocument());
    const focused = findFocused([keyA, keyB]);

    // No pane refocuses afterwards — mirrors clicking outside the dock
    // entirely, or the browser window itself losing focus.
    fireEvent.blur(screen.getByTestId(`pane-input-${focused}`));

    await waitFor(() => {
      expect(indicatorTextFor(keyA)).toBe("Watching");
      expect(indicatorTextFor(keyB)).toBe("Watching");
    });
  });

  it("a focus move BETWEEN the two panes (blur old, focus new — the same tick, exactly like the browser does it) never dips through a false 'neither focused' state", async () => {
    stubFetch(Promise.resolve([liveElsewhereRow()]));
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);
    const [keyA, keyB] = await mintTwoSessions();

    enterSplitView();
    await waitFor(() => expect(screen.getByTestId(`pane-indicator-${keyA}`)).toBeInTheDocument());
    const focused = findFocused([keyA, keyB]);
    const other = focused === keyA ? keyB : keyA;

    // Native focus changes fire blur(old) then focus(new) synchronously in
    // the same tick — mirrored here in one `act`, the same way the real
    // browser (and jsdom's own focus() implementation) would deliver them.
    act(() => {
      fireEvent.blur(screen.getByTestId(`pane-input-${focused}`));
      fireEvent.focus(screen.getByTestId(`pane-input-${other}`));
    });

    expect(indicatorTextFor(other)).toBe("Typing here");
    expect(indicatorTextFor(focused)).toBe("Watching");
  });
});

// Requirements v3 (task eda6598b, docs/design-terminal-split-view.html §10):
// side by side supports EXACTLY 2 or 3 panes, all-or-nothing — every open
// dock session gets a pane, or the dock is entirely plain tabs.
describe("TerminalDock — a 3rd terminal gets its own pane (task eda6598b, D8/D3)", () => {
  /** Mints N local tabs via the chooser's "Start new", one at a time. */
  async function mintSessions(count: number): Promise<string[]> {
    await waitFor(() => expect(screen.getByTestId("chooser")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("chooser-start-new"));
    await waitFor(() => expect(screen.getByTestId("session-view")).toBeInTheDocument());

    for (let i = 1; i < count; i++) {
      act(() => {
        requestBrowserLaunch();
      });
      await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
      fireEvent.click(screen.getByTestId("chooser-start-new"));
      await waitFor(() => expect(screen.getAllByTestId("session-view")).toHaveLength(i + 1));
    }
    return screen.getAllByTestId("session-view").map((el) => el.dataset.key as string);
  }

  function enterSplitView() {
    fireEvent.click(screen.getByRole("button", { name: /^Split view/ }));
  }

  it("2 sessions in split, then opening a 3rd gives it its own pane automatically and takes focus (D8)", async () => {
    stubFetch(Promise.resolve([liveElsewhereRow()]));
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);
    const [keyA, keyB] = await mintSessions(2);
    enterSplitView();
    await waitFor(() => expect(screen.getByTestId(`pane-indicator-${keyA}`)).toBeInTheDocument());

    act(() => {
      requestBrowserLaunch();
    });
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("chooser-start-new"));
    await waitFor(() => expect(screen.getAllByTestId("session-view")).toHaveLength(3));

    const keys = screen.getAllByTestId("session-view").map((el) => el.dataset.key as string);
    const keyC = keys.find((k) => k !== keyA && k !== keyB) as string;

    // All THREE sessions get a pane at once — never 2 panes + a 3rd tab
    // sitting out (the banned state D2 exists to prevent).
    await waitFor(() => {
      expect(screen.getByTestId(`pane-indicator-${keyA}`)).toBeInTheDocument();
      expect(screen.getByTestId(`pane-indicator-${keyB}`)).toBeInTheDocument();
      expect(screen.getByTestId(`pane-indicator-${keyC}`)).toBeInTheDocument();
    });
    // The new 3rd pane takes focus (D8).
    expect(screen.getByTestId(`pane-indicator-${keyC}`).textContent).toBe("Typing here");
  });

  it("a 4th session forces the WHOLE dock to plain tabs — no partial pane state survives (D3)", async () => {
    stubFetch(Promise.resolve([liveElsewhereRow()]));
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);
    await mintSessions(3);
    enterSplitView();
    await waitFor(() => expect(screen.getAllByTestId(/^pane-indicator-/)).toHaveLength(3));

    act(() => {
      requestBrowserLaunch();
    });
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("chooser-start-new"));
    await waitFor(() => expect(screen.getAllByTestId("session-view")).toHaveLength(4));

    // No pane survives — the dock is entirely plain tabs.
    await waitFor(() => expect(screen.queryAllByTestId(/^pane-indicator-/)).toHaveLength(0));
    expect(screen.getAllByText(/fits up to 3 terminals/).length).toBeGreaterThan(0);
    // The split toggle stays pressed — the preference is kept, not cleared.
    expect(screen.getByRole("button", { name: /^Split view/ })).toHaveAttribute("aria-pressed", "true");
  });
});

// Task 9f30ae15 (Nick's field report, 2026-08-22): with several tabs open,
// confirming "End session?" on the tab he meant to close ended a DIFFERENT
// one. The re-investigation proved the tab→session key mapping is correct —
// `actionsMapRef.current.get(key)?.end()` (requestClose, terminal-dock.tsx)
// always resolves the CLICKED tab's own session — and pinned the cause on
// the confirm/rename UI's old `flex-1`/`max-w-[300px]` growth: arming
// instantly reflowed the whole 110-190px tab strip, and since a click
// resolves at MOUSEUP, that reflow could land the confirm click on a
// NEIGHBOUR tab's button. The fix removes the growth entirely — arming and
// renaming now cause zero layout shift, full stop — plus two secondary
// hardenings (disarm on switching tabs, ~5s auto-expiry). These tests port
// the investigation's close-mapping proof permanently and cover the new
// zero-reflow invariant and the hardening behaviours.
describe("TerminalDock — wrong-tab-closes-on-confirm fix (task 9f30ae15)", () => {
  /** Mints 3 live tabs via the same chooser-overlay "Start new" flow
   * `mintTwoSessions` (above) uses, one step further — a live-elsewhere row
   * means the FIRST mint goes through the chooser, and every subsequent
   * `requestBrowserLaunch()` re-opens it as an overlay over the already-open
   * tab(s) rather than auto-minting silently, matching real multi-tab usage. */
  async function mintThreeSessions(): Promise<[string, string, string]> {
    await waitFor(() => expect(screen.getByTestId("chooser")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("chooser-start-new"));
    await waitFor(() => expect(screen.getByTestId("session-view")).toBeInTheDocument());
    const firstKey = screen.getByTestId("session-view").dataset.key as string;

    act(() => {
      requestBrowserLaunch();
    });
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("chooser-start-new"));
    await waitFor(() => expect(screen.getAllByTestId("session-view")).toHaveLength(2));

    act(() => {
      requestBrowserLaunch();
    });
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("chooser-start-new"));
    await waitFor(() => expect(screen.getAllByTestId("session-view")).toHaveLength(3));

    const keys = screen.getAllByTestId("session-view").map((el) => el.dataset.key as string);
    const [secondKey, thirdKey] = keys.filter((k) => k !== firstKey);
    return [firstKey, secondKey, thirdKey];
  }

  function tabContainer(key: string): HTMLElement {
    const el = document.getElementById(`terminal-tab-${key}`);
    if (!el) throw new Error(`tab element not found for key ${key}`);
    return el;
  }

  /** First × click — arms the confirm (never ends on its own). */
  function armClose(key: string) {
    fireEvent.click(within(tabContainer(key)).getByRole("button", { name: /^(End session and close tab|Close tab):/ }));
  }

  /** Second click, on an ALREADY-armed tab's ✓ — the actual end. */
  function confirmClose(key: string) {
    fireEvent.click(within(tabContainer(key)).getByRole("button", { name: /^Confirm end session:/ }));
  }

  function cancelArmedClose(key: string) {
    fireEvent.click(within(tabContainer(key)).getByRole("button", { name: "Cancel" }));
  }

  it("closing the MIDDLE of 3 live tabs ends exactly that tab's session — arm+confirm never lands on a neighbour", async () => {
    stubFetch(Promise.resolve([liveElsewhereRow()]));
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);
    const [keyA, keyB, keyC] = await mintThreeSessions();

    // Captured before the close removes keyB's entry (and with it, its
    // registry row) — the SAME spy instances requestClose's `end()` call
    // must resolve to.
    const endA = registeredActionsByKey.get(keyA)!.end;
    const endB = registeredActionsByKey.get(keyB)!.end;
    const endC = registeredActionsByKey.get(keyC)!.end;

    armClose(keyB);
    confirmClose(keyB);

    expect(endB).toHaveBeenCalledTimes(1);
    expect(endA).not.toHaveBeenCalled();
    expect(endC).not.toHaveBeenCalled();

    await waitFor(() => {
      const remaining = screen.getAllByTestId("session-view").map((el) => el.dataset.key);
      expect(remaining).toEqual(expect.arrayContaining([keyA, keyC]));
      expect(remaining).not.toContain(keyB);
    });
  });

  it("arming 'End session?' causes NO layout shift — the armed tab keeps its exact class list, siblings are untouched", async () => {
    stubFetch(Promise.resolve([liveElsewhereRow()]));
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);
    const [keyA, keyB, keyC] = await mintThreeSessions();

    const before = { a: tabContainer(keyA).className, b: tabContainer(keyB).className, c: tabContainer(keyC).className };

    armClose(keyB);
    expect(within(tabContainer(keyB)).getByText("End session?")).toBeInTheDocument();

    // The invariant: zero layout shift for EVERY tab, including the armed
    // one — jsdom can't measure pixels, so this asserts at the class list
    // itself, which is what used to carry the growth (`flex-1`,
    // `max-w-[300px]`) that reflowed the strip.
    expect(tabContainer(keyA).className).toBe(before.a);
    expect(tabContainer(keyB).className).toBe(before.b);
    expect(tabContainer(keyC).className).toBe(before.c);
    expect(tabContainer(keyB).className).not.toMatch(/flex-1|max-w-\[300px\]/);
  });

  it("opening the rename editor causes NO layout shift either — same invariant as arming close", async () => {
    stubFetch(Promise.resolve([liveElsewhereRow()]));
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);
    const [keyA, keyB, keyC] = await mintThreeSessions();

    // The pencil only renders on the ACTIVE tab (design §2) — whichever tab
    // that is here, rename it and check every tab's class list.
    const activeTab = screen.getByRole("tab", { selected: true });
    const activeKey = activeTab.id.replace("terminal-tab-", "");
    const before = { a: tabContainer(keyA).className, b: tabContainer(keyB).className, c: tabContainer(keyC).className };

    fireEvent.click(within(activeTab).getByRole("button", { name: /^Rename session/ }));
    expect(within(activeTab).getByLabelText("Session name")).toBeInTheDocument();

    expect(tabContainer(keyA).className).toBe(before.a);
    expect(tabContainer(keyB).className).toBe(before.b);
    expect(tabContainer(keyC).className).toBe(before.c);
    expect(tabContainer(activeKey).className).not.toMatch(/flex-1|max-w-\[300px\]/);
  });

  it("✕ cancels an armed confirm — the tab and its session both survive, untouched", async () => {
    stubFetch(Promise.resolve([liveElsewhereRow()]));
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);
    const [, keyB] = await mintThreeSessions();
    const endB = registeredActionsByKey.get(keyB)!.end;

    armClose(keyB);
    cancelArmedClose(keyB);

    expect(endB).not.toHaveBeenCalled();
    expect(within(tabContainer(keyB)).queryByText("End session?")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("session-view")).toHaveLength(3);
  });

  it("Escape on an armed tab cancels the confirm without ending the session", async () => {
    stubFetch(Promise.resolve([liveElsewhereRow()]));
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);
    const [, keyB] = await mintThreeSessions();
    const endB = registeredActionsByKey.get(keyB)!.end;

    armClose(keyB);
    fireEvent.keyDown(tabContainer(keyB), { key: "Escape", code: "Escape" });

    expect(endB).not.toHaveBeenCalled();
    expect(within(tabContainer(keyB)).queryByText("End session?")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("session-view")).toHaveLength(3);
  });

  it("activating a DIFFERENT tab disarms a stale confirm — the next click on the armed tab's × re-arms it, it does not end it", async () => {
    stubFetch(Promise.resolve([liveElsewhereRow()]));
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);
    const [keyA, keyB] = await mintThreeSessions();
    const endB = registeredActionsByKey.get(keyB)!.end;

    armClose(keyB);
    expect(within(tabContainer(keyB)).getByText("End session?")).toBeInTheDocument();

    // Switching to a different tab — the exact secondary hazard the
    // investigation flagged: a forgotten arm sitting behind the ×, ready to
    // be mistaken for a fresh first click later.
    fireEvent.click(tabContainer(keyA));
    expect(within(tabContainer(keyB)).queryByText("End session?")).not.toBeInTheDocument();

    // The next click on B's × is a FIRST click again (re-arm), not the
    // confirming second click.
    armClose(keyB);
    expect(within(tabContainer(keyB)).getByText("End session?")).toBeInTheDocument();
    expect(endB).not.toHaveBeenCalled();
  });

  it("an armed confirm auto-expires after ~5s if left untouched, disarming without ending the session", async () => {
    stubFetch(Promise.resolve([liveElsewhereRow()]));
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);
    const [, keyB] = await mintThreeSessions();
    const endB = registeredActionsByKey.get(keyB)!.end;

    // Fake timers scoped to just the arm+expire step (every mint above
    // already resolved its own real-timer waitFors) — this file has a
    // flaky-timeout history, so real async work and fake-timer advances are
    // kept apart rather than interleaved.
    vi.useFakeTimers();
    try {
      armClose(keyB);
      expect(within(tabContainer(keyB)).getByText("End session?")).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(5000);
      });

      expect(within(tabContainer(keyB)).queryByText("End session?")).not.toBeInTheDocument();
      expect(endB).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not expire an armed confirm before ~5s has elapsed", async () => {
    stubFetch(Promise.resolve([liveElsewhereRow()]));
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);
    const [, keyB] = await mintThreeSessions();

    vi.useFakeTimers();
    try {
      armClose(keyB);
      act(() => {
        vi.advanceTimersByTime(4000);
      });
      expect(within(tabContainer(keyB)).getByText("End session?")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

// Bug fix (last-tab-close auto-relaunch, Nick's field report): closing the
// dock's LAST remaining tab replaces `sessions` with a fresh pristine entry
// (B8, "back to the P1 idle state") reusing the exact same shape/launchSeq:0
// as a genuine page-load pristine entry — which normally auto-connects a
// paired browser the instant the dock is expanded. Since the user just
// explicitly ended their only session (the dock is still expanded — that's
// how they saw the × to click), that replacement entry must NOT also satisfy
// `autoConnectWhenExpanded`, or ending a session silently reconnects into a
// brand-new one within the same render pass.
describe("TerminalDock — ending the last tab does not auto-relaunch a fresh session", () => {
  function tabContainer(key: string): HTMLElement {
    const el = document.getElementById(`terminal-tab-${key}`);
    if (!el) throw new Error(`tab element not found for key ${key}`);
    return el;
  }

  it("closing the dock's only live tab returns to the idle pristine slot WITHOUT auto-connecting", async () => {
    stubFetch(Promise.resolve([]));
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);

    // The dock auto-seeds its usual page-load pristine tab (empty-launch
    // decision) — unchanged P1 behaviour: it DOES want auto-connect.
    await waitFor(() => expect(screen.getByTestId("session-view")).toBeInTheDocument());
    const firstKey = screen.getByTestId("session-view").dataset.key as string;
    expect(screen.getByTestId("session-view").dataset.autoConnectWhenExpanded).toBe("true");

    // Bring it to a LIVE status so requestClose treats × as "end this
    // session" (armed confirm) rather than a bare, already-over close.
    fireEvent.click(screen.getByTestId(`report-connected-${firstKey}`));

    // Expand the dock (clicking the tab does this in the real component) —
    // the bug only manifests while the dock is visibly open.
    fireEvent.click(tabContainer(firstKey));

    // First × click arms the confirm; second confirms and actually ends it.
    fireEvent.click(
      within(tabContainer(firstKey)).getByRole("button", { name: /^(End session and close tab|Close tab):/ }),
    );
    fireEvent.click(within(tabContainer(firstKey)).getByRole("button", { name: /^Confirm end session:/ }));

    // Back to exactly one tab (the pristine slot reused, B8) — but this one
    // must report `autoConnectWhenExpanded: false`, unlike the very first
    // pristine entry above.
    await waitFor(() => expect(screen.getAllByTestId("session-view")).toHaveLength(1));
    const secondEntry = screen.getByTestId("session-view");
    expect(secondEntry.dataset.key).not.toBe(firstKey); // a genuinely fresh entry, not the same tab
    expect(secondEntry.dataset.autoConnectWhenExpanded).toBe("false");
  });
});

// Multi-terminal reload restore (Nick's field report 2026-08-22): two dock
// tabs open → hard refresh → only one came back, and the orphaned live
// session was then mislabelled "open in another tab". The tab now remembers
// EVERY sid it holds (session-snapshot.ts's readTabSids) and instant-continue
// reattaches each one.
describe("TerminalDock — multi-terminal reload restore", () => {
  it("reattaches EVERY remembered live sid on load, with no 'other tabs' strip and no chooser", async () => {
    rememberTabSid("own-sid-1");
    rememberTabSid("own-sid-2");
    saveSessionSnapshot("own-sid-1", { data: "one\r\n", truncated: false });
    saveSessionSnapshot("own-sid-2", { data: "two\r\n", truncated: false });
    const reattached: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        if (url === "/api/terminal/session/list") {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              sessions: [
                { ...liveHereRow(), sid: "own-sid-1" },
                { ...liveHereRow(), sid: "own-sid-2" },
              ],
            }),
          });
        }
        if (url === "/api/terminal/session/reattach") {
          const sid = (JSON.parse(String(init?.body)) as { sid: string }).sid;
          reattached.push(sid);
          return Promise.resolve({
            ok: true,
            json: async () => ({ sessionId: sid, browserToken: `token-${sid}` }),
          });
        }
        return Promise.resolve({ ok: false, json: async () => ({}) });
      }),
    );

    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);

    await waitFor(() => expect(screen.getAllByTestId("session-view")).toHaveLength(2));
    expect(reattached.sort()).toEqual(["own-sid-1", "own-sid-2"]);
    expect(screen.queryByText(/tabs? .* open here/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("chooser")).not.toBeInTheDocument();
  });

  it("skips a remembered sid whose session has since ended, still restoring the rest", async () => {
    rememberTabSid("own-sid-1");
    rememberTabSid("own-sid-2");
    saveSessionSnapshot("own-sid-1", { data: "one\r\n", truncated: false });
    saveSessionSnapshot("own-sid-2", { data: "two\r\n", truncated: false });
    const reattached: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        if (url === "/api/terminal/session/list") {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              sessions: [
                { ...liveHereRow(), sid: "own-sid-1" },
                {
                  ...liveHereRow(),
                  sid: "own-sid-2",
                  status: "ended",
                  endedAt: new Date().toISOString(),
                },
              ],
            }),
          });
        }
        if (url === "/api/terminal/session/reattach") {
          const sid = (JSON.parse(String(init?.body)) as { sid: string }).sid;
          reattached.push(sid);
          return Promise.resolve({
            ok: true,
            json: async () => ({ sessionId: sid, browserToken: `token-${sid}` }),
          });
        }
        return Promise.resolve({ ok: false, json: async () => ({}) });
      }),
    );

    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);

    await waitFor(() => expect(screen.getAllByTestId("session-view")).toHaveLength(1));
    expect(reattached).toEqual(["own-sid-1"]);
  });
});
