// Focused regression coverage for the My sessions panel's "Update now" flow
// (card cc74a067 design §3 flows A/D). No test file previously existed for
// this component; this one exists specifically because the flow moved out
// into a shared hook (src/lib/terminal/use-helper-update-flow.ts) so the
// session chooser's own "Update now" (terminal-session-chooser.tsx) could
// drive the exact same sequence — Nick's binding decision: "both buttons
// need to stop the old version first". These tests pin the panel's own
// behaviour so that extraction is provably a no-op here: confirm-before-end
// when sessions are live, straight-to-quiesce when they aren't, the
// quiesce-times-out-but-still-downloads edge case, and the stale
// "Ready to update" notice getting cleared on the popover's next open.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { TerminalMySessionsPanel } from "./terminal-my-sessions-panel";
import type { HelperStatus } from "@/lib/terminal/helper-row";
import { TERMINAL_HELPER_DOWNLOAD_URL } from "@/lib/terminal/platform";

// Radix Popover uses ResizeObserver, which jsdom lacks (same stub used
// elsewhere for Radix-positioned surfaces, e.g. label-picker.test.tsx).
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: vi.fn() }),
}));

afterEach(cleanup);

interface MockSession {
  sid: string;
  ideaId: string;
  ideaTitle: string | null;
  taskId: string | null;
  taskTitle: string | null;
  machineLabel: string | null;
  cwd: string | null;
  createdAt: string;
  status: "active" | "ended";
  endedAt: string | null;
  displayName: string | null;
}

function mockSession(sid: string, overrides: Partial<MockSession> = {}): MockSession {
  return {
    sid,
    ideaId: "idea-1",
    ideaTitle: "VibeCodes",
    taskId: null,
    taskTitle: null,
    machineLabel: "Nick's MacBook",
    cwd: "~/projects/vibecodes",
    createdAt: new Date().toISOString(),
    status: "active",
    endedAt: null,
    displayName: null,
    ...overrides,
  };
}

function helperStatus(overrides: Partial<HelperStatus> = {}): HelperStatus {
  return {
    connected: true,
    version: "0.1.0", // old enough that the update nudge (and its button) render
    machineLabel: null,
    alwaysOn: false,
    stoppedUnexpectedly: false,
    lastEventAt: null,
    ...overrides,
  };
}

let assignSpy: ReturnType<typeof vi.fn>;
let originalLocation: Location;
let fetchMock: ReturnType<typeof vi.fn>;
let sessionsResponse: MockSession[];
let statusQueue: HelperStatus[];
let defaultStatus: HelperStatus;

beforeEach(() => {
  vi.useFakeTimers();
  originalLocation = window.location;
  assignSpy = vi.fn();
  // jsdom's `window.location.assign` isn't spy-able directly — swap in a
  // plain object carrying the real Location's properties plus a spy-able
  // `assign` (same idiom as launch-claude-code-button.test.tsx).
  Object.defineProperty(window, "location", {
    value: Object.assign(Object.create(Object.getPrototypeOf(originalLocation) as object), originalLocation, {
      assign: assignSpy,
    }),
    configurable: true,
    writable: true,
  });

  sessionsResponse = [];
  statusQueue = [];
  defaultStatus = helperStatus();
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === "/api/terminal/session/list") {
      return Promise.resolve({ ok: true, json: async () => ({ sessions: sessionsResponse }) } as Response);
    }
    if (url === "/api/terminal/helper/status") {
      const next = statusQueue.shift() ?? defaultStatus;
      return Promise.resolve({ ok: true, json: async () => next } as Response);
    }
    if (url === "/api/terminal/session/end" || url === "/api/terminal/helper/command") {
      return Promise.resolve({ ok: true, json: async () => ({ delivered: true }) } as Response);
    }
    return Promise.reject(new Error(`unexpected fetch: ${url} ${init?.method ?? ""}`));
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  Object.defineProperty(window, "location", { value: originalLocation, configurable: true, writable: true });
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function renderPanel(open = true) {
  const onOpenChange = vi.fn();
  const utils = render(
    <TerminalMySessionsPanel open={open} onOpenChange={onOpenChange}>
      <button>My sessions</button>
    </TerminalMySessionsPanel>,
  );
  return { ...utils, onOpenChange };
}

/** Waits for the initial `load()` (session list + helper status) to settle. */
async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

/**
 * Advances the fake clock in the SAME 500ms increments the quiesce poll
 * itself waits between checks, up to `maxTicks` — a single large
 * `advanceTimersByTimeAsync` jump can race ahead of the fetch mock's own
 * microtask hop through the extra Popover/Portal render layers and stall
 * mid-loop, so step through it instead (bounded — stops once the download
 * fires, never spins the full 25 ticks in the settling-immediately case).
 */
async function pollUntilDownload(maxTicks = 25) {
  for (let i = 0; i < maxTicks && assignSpy.mock.calls.length === 0; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
  }
}

describe("TerminalMySessionsPanel — Update now (shared quiesce-then-download flow)", () => {
  it("no live sessions: Update now skips the confirm, quiesces (no end-all call), then downloads", async () => {
    sessionsResponse = [];
    renderPanel();
    await flush(); // the initial load() consumes the default (connected) status

    statusQueue = [helperStatus({ connected: false })]; // the quiesce poll's first check
    fireEvent.click(screen.getByRole("button", { name: "Update now" }));
    expect(screen.queryByText("Update the helper?")).not.toBeInTheDocument();

    await pollUntilDownload();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/terminal/helper/command",
      expect.objectContaining({ body: JSON.stringify({ cmd: "quiesce" }) }),
    );
    expect(fetchMock).not.toHaveBeenCalledWith("/api/terminal/session/end", expect.anything());
    expect(assignSpy).toHaveBeenCalledWith(TERMINAL_HELPER_DOWNLOAD_URL);
    expect(screen.getByText(/Ready to update/)).toBeInTheDocument();
  });

  it("live sessions: Update now confirms first, ends every session, then quiesces and downloads", async () => {
    sessionsResponse = [mockSession("s1"), mockSession("s2")];
    renderPanel();
    await flush(); // the initial load() consumes the default (connected) status

    fireEvent.click(screen.getByRole("button", { name: "Update now" }));
    expect(screen.getByText("Update the helper?")).toBeInTheDocument();
    expect(screen.getByText(/Your 2 running sessions will end first/)).toBeInTheDocument();

    statusQueue = [helperStatus({ connected: false })]; // the quiesce poll's first check
    const preConfirmCalls = fetchMock.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "End sessions & update" }));
    await pollUntilDownload();

    expect(fetchMock.mock.calls.length).toBeGreaterThan(preConfirmCalls);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/terminal/session/end",
      expect.objectContaining({ body: JSON.stringify({ all: true }) }),
    );
    expect(assignSpy).toHaveBeenCalledWith(TERMINAL_HELPER_DOWNLOAD_URL);
  });

  it("Not now cancels the confirm without touching the network", async () => {
    sessionsResponse = [mockSession("s1")];
    renderPanel();
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Update now" }));
    expect(screen.getByText("Update the helper?")).toBeInTheDocument();
    const callsBeforeCancel = fetchMock.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByText("Update the helper?")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.length).toBe(callsBeforeCancel);
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it("quiesce-timeout: the poll never settles, but the flow still proceeds and downloads regardless", async () => {
    sessionsResponse = [];
    // statusQueue stays empty -> every poll reports still-connected (the
    // default `defaultStatus`), so the deadline branch is what fires.
    renderPanel();
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Update now" }));
    for (let i = 0; i < 25 && assignSpy.mock.calls.length === 0; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
    }

    expect(assignSpy).toHaveBeenCalledWith(TERMINAL_HELPER_DOWNLOAD_URL);
    expect(screen.getByText(/The helper is taking a moment to close/)).toBeInTheDocument();
  });

  it("a stale 'Ready to update' notice is cleared the next time the popover opens", async () => {
    sessionsResponse = [];
    const { rerender, onOpenChange } = renderPanel();
    await flush(); // the initial load() consumes the default (connected) status

    statusQueue = [helperStatus({ connected: false })]; // the quiesce poll's first check
    fireEvent.click(screen.getByRole("button", { name: "Update now" }));
    await pollUntilDownload();
    expect(screen.getByText(/Ready to update/)).toBeInTheDocument();
    void onOpenChange; // popover's own open state is owned by the caller in this component

    // Close, then reopen — the panel's own state (this component, not
    // PopoverContent) survives the close, so the stale notice must be
    // cleared by the dedicated reset effect rather than lingering forever.
    rerender(
      <TerminalMySessionsPanel open={false} onOpenChange={vi.fn()}>
        <button>My sessions</button>
      </TerminalMySessionsPanel>,
    );
    statusQueue = [helperStatus({ connected: true })];
    rerender(
      <TerminalMySessionsPanel open onOpenChange={vi.fn()}>
        <button>My sessions</button>
      </TerminalMySessionsPanel>,
    );
    await flush();

    expect(screen.queryByText(/Ready to update/)).not.toBeInTheDocument();
  });
});

describe("TerminalMySessionsPanel — rename (card 3bf262ac)", () => {
  it("hides the pencil entirely when no onRenameSession is supplied", async () => {
    sessionsResponse = [mockSession("sid-1", { taskTitle: "Fix login redirect loop" })];
    renderPanel();
    await flush();
    expect(screen.queryByRole("button", { name: /rename session/i })).not.toBeInTheDocument();
  });

  it("renaming calls onRenameSession(sid, next) and shows the new name immediately (optimistic)", async () => {
    sessionsResponse = [mockSession("sid-1", { taskTitle: "Fix login redirect loop", displayName: null })];
    const onRenameSession = vi.fn().mockResolvedValue({ ok: true, displayName: "Auth spike" });
    render(
      <TerminalMySessionsPanel open onOpenChange={vi.fn()} onRenameSession={onRenameSession}>
        <button>My sessions</button>
      </TerminalMySessionsPanel>,
    );
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Rename session: Fix login redirect loop" }));
    const input = screen.getByRole("textbox", { name: "Session name" });
    fireEvent.change(input, { target: { value: "Auth spike" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByText("Auth spike")).toBeInTheDocument();
    expect(onRenameSession).toHaveBeenCalledWith("sid-1", "Auth spike");
  });

  it("reverts to the previous name when the persist call fails — typed intent isn't silently kept as truth", async () => {
    sessionsResponse = [mockSession("sid-1", { taskTitle: "Fix login redirect loop" })];
    const onRenameSession = vi.fn().mockResolvedValue({ ok: false });
    render(
      <TerminalMySessionsPanel open onOpenChange={vi.fn()} onRenameSession={onRenameSession}>
        <button>My sessions</button>
      </TerminalMySessionsPanel>,
    );
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Rename session: Fix login redirect loop" }));
    const input = screen.getByRole("textbox", { name: "Session name" });
    fireEvent.change(input, { target: { value: "Auth spike" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await flush();

    expect(screen.getByText("Fix login redirect loop")).toBeInTheDocument();
    expect(screen.queryByText("Auth spike")).not.toBeInTheDocument();
  });

  it("hides Reconnect/End on the row being renamed — one job at a time (design §3b)", async () => {
    sessionsResponse = [mockSession("sid-1", { taskTitle: "Fix login redirect loop" })];
    render(
      <TerminalMySessionsPanel open onOpenChange={vi.fn()} onRenameSession={vi.fn()} onReconnect={vi.fn()}>
        <button>My sessions</button>
      </TerminalMySessionsPanel>,
    );
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Rename session: Fix login redirect loop" }));
    expect(screen.queryByRole("button", { name: /^End session/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Reconnect/ })).not.toBeInTheDocument();
  });

  it("Escape cancels without calling onRenameSession", async () => {
    sessionsResponse = [mockSession("sid-1", { taskTitle: "Fix login redirect loop" })];
    const onRenameSession = vi.fn();
    render(
      <TerminalMySessionsPanel open onOpenChange={vi.fn()} onRenameSession={onRenameSession}>
        <button>My sessions</button>
      </TerminalMySessionsPanel>,
    );
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Rename session: Fix login redirect loop" }));
    const input = screen.getByRole("textbox", { name: "Session name" });
    fireEvent.change(input, { target: { value: "discard me" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(onRenameSession).not.toHaveBeenCalled();
    expect(screen.getByText("Fix login redirect loop")).toBeInTheDocument();
  });
});
