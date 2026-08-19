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
import { render, screen, cleanup, act, waitFor, fireEvent } from "@testing-library/react";
import { useEffect } from "react";
import type {
  ChooserRegistryRow,
  ChooserLiveRow,
  ChooserRecentRow,
  ChooserSections,
  TaskSessionMatch,
} from "@/lib/terminal/chooser-data";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/ideas/idea-1/board",
  useSearchParams: () => new URLSearchParams(),
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

// Renders just enough of a real TerminalSessionView for the test to see HOW
// MANY tabs actually got minted, and with what payload — the real component
// (and the hook underneath it) is exercised elsewhere.
vi.mock("./terminal-session-view", () => ({
  TerminalSessionView: ({
    entry,
    onBrowseSessions,
  }: {
    entry: { key: string; taskId?: string };
    onBrowseSessions?: () => void;
  }) => {
    useEffect(() => {
      sessionViewMountSpy(entry.key);
      return () => sessionViewUnmountSpy(entry.key);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return (
      <div data-testid="session-view" data-key={entry.key} data-task-id={entry.taskId ?? ""}>
        {/* Stands in for the ended panel's "View my other sessions" link —
            the real panel only renders it on the session-ended view, which
            needs the whole xterm/socket machinery this stub deliberately
            omits. What matters here is WHERE the dock points the callback. */}
        {onBrowseSessions && (
          <button data-testid="view-my-other-sessions" onClick={onBrowseSessions}>
            View my other sessions
          </button>
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
import { rememberLastTabSid } from "@/lib/terminal/session-snapshot";
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
    createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    status: "ended",
    endedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1h ago — well within 48h
  };
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_TERMINAL_ENABLED", "true");
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
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

  it("still traps a LAUNCH-opened overlay (forced choice, unchanged) — the dismissal relaxation is scoped to browsing", async () => {
    stubFetch(Promise.resolve([liveElsewhereRow()]));
    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);

    await openFirstTabViaChooser();
    act(() => {
      requestBrowserLaunch();
    });
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape", code: "Escape" });

    // A fired launch must resolve to exactly one outcome — Escape must not
    // silently swallow it.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
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
