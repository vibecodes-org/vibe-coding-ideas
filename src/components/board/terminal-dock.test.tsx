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
  TerminalSessionView: ({ entry }: { entry: { key: string; taskId?: string } }) => {
    useEffect(() => {
      sessionViewMountSpy(entry.key);
      return () => sessionViewUnmountSpy(entry.key);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return <div data-testid="session-view" data-key={entry.key} data-task-id={entry.taskId ?? ""} />;
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

import { TerminalDock } from "./terminal-dock";
import { requestBrowserLaunch } from "@/lib/terminal/launch-mode";
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

  it("routes a raced launch into the chooser (never a blind mint) once the resolved decision has something to choose between", async () => {
    const registry = deferredRegistryResponse();
    stubFetch(registry.promise);

    render(<TerminalDock ideaId="idea-1" ideaTitle="My Idea" ideaGithubUrl={null} />);

    act(() => {
      requestBrowserLaunch({ taskId: "task-9", taskTitle: "Do the thing" });
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
