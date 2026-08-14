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
// This file is a FOCUSED harness for that one race, not a full dock test
// suite (no existing terminal-dock test file to extend — see the card).
// `TerminalSessionView` / `TerminalMySessionsPanel` / `TerminalSessionChooser`
// are stubbed so the test can assert purely on "did a session tab get
// minted" vs. "did the chooser render", without pulling in the real hook's
// xterm/WebSocket machinery — that machinery is already covered by
// terminal-session-view.test.tsx and use-terminal-session.test.ts.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, waitFor } from "@testing-library/react";
import type { ChooserRegistryRow } from "@/lib/terminal/chooser-data";

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

// Renders just enough of a real TerminalSessionView for the test to see HOW
// MANY tabs actually got minted, and with what payload — the real component
// (and the hook underneath it) is exercised elsewhere.
vi.mock("./terminal-session-view", () => ({
  TerminalSessionView: ({ entry }: { entry: { key: string; taskId?: string } }) => (
    <div data-testid="session-view" data-key={entry.key} data-task-id={entry.taskId ?? ""} />
  ),
  dockStatusMeta: () => ({ label: "Terminal", Icon: () => null, className: "" }),
}));

vi.mock("./terminal-my-sessions-panel", () => ({
  TerminalMySessionsPanel: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("./terminal-session-chooser", () => ({
  TerminalSessionChooser: () => <div data-testid="chooser" />,
}));

import { TerminalDock } from "./terminal-dock";
import { requestBrowserLaunch } from "@/lib/terminal/launch-mode";

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
 * against) is wired to the caller-controlled deferred promise. */
function stubFetch(registryPromise: Promise<ChooserRegistryRow[]>) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url === "/api/terminal/session/list") {
        return registryPromise.then((sessions) => ({ ok: true, json: async () => ({ sessions }) }));
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

    act(() => {
      requestBrowserLaunch({ taskId: "task-9", taskTitle: "Do the thing" });
    });

    // The pristine slot is reused in place — still exactly one tab, now
    // carrying the task launch (never a 2nd tab).
    await waitFor(() => expect(screen.getByTestId("session-view").dataset.taskId).toBe("task-9"));
    expect(screen.getAllByTestId("session-view")).toHaveLength(1);
  });
});
