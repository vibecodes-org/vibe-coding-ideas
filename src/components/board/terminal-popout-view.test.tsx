// Regression net for card 101bbb2d: the popped-out window used to sit on the
// calm "Brought back to the dock — you can close this window" screen forever,
// leaving Nick to close it by hand. It's opened BY SCRIPT (window.open in the
// dock), so `window.close()` from its own script is browser-permitted; this
// file pins that TerminalPopoutView actually calls it, on a delay, once
// `broughtBack` (this window's own 4001 preempted close) is true — and that a
// browser refusing the close leaves the fallback screen's Close button intact.
//
// `useTerminalSession` is mocked out entirely, same idiom as
// terminal-session-view.test.tsx — this file only cares about
// TerminalPopoutView's own effect wiring, not xterm/WebSocket internals.

import { useRef } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { UseTerminalSessionResult, TerminalSessionActions } from "./use-terminal-session";
import { RELAY_CLOSE } from "@/lib/terminal/connection";
import { BROUGHT_BACK_AUTO_CLOSE_MS } from "@/lib/terminal/popout-channel";
import type { PopoutPayload } from "@/lib/terminal/popout-channel";

vi.mock("./use-terminal-session", () => ({
  useTerminalSession: vi.fn(),
}));

import { useTerminalSession } from "./use-terminal-session";
import { TerminalPopoutView } from "./terminal-popout-view";

const mockedUseTerminalSession = vi.mocked(useTerminalSession);

const PAYLOAD: PopoutPayload = {
  sid: "sid-1",
  browserToken: "tok",
  relayUrl: "wss://relay.example",
  ideaId: "idea-1",
  ideaTitle: "Recipe Saver",
  label: "Session 1",
  identity: "Recipe Saver · session sid-1",
  readOnly: false,
};

function mockActions(): TerminalSessionActions {
  return {
    connect: vi.fn(),
    beginBrowserLaunch: vi.fn(),
    launchFromBus: vi.fn(),
    reconnectNow: vi.fn(),
    end: vi.fn(),
    setReadOnly: vi.fn(),
    copyBridgeCommand: vi.fn(),
    refreshView: vi.fn(),
    serializeNow: vi.fn(),
    restoreBuffer: vi.fn(),
  };
}

/** `status: "error"` + `closeCode: RELAY_CLOSE.DUP_BROWSER` is exactly `isPreemptedClose` — the "brought back to the dock" case. */
function installMockSession(status: "connected" | "error", closeCode: number | null) {
  mockedUseTerminalSession.mockImplementation((): UseTerminalSessionResult => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    return {
      state: { status, sessionId: "sess-1", errorKind: null, endedReason: null, closeCode, closeReason: null },
      launchPhase: "idle",
      peerDegraded: false,
      helperVersion: null,
      pair: { sessionId: "sess-1", bridgeToken: "bridge-tok", browserToken: "browser-tok" },
      cwd: null,
      claudeSessionId: null,
      readOnly: false,
      inputEnabled: true,
      platform: { os: "mac", isAppleSilicon: true, supported: true, downloadLabel: "Download", downloadUrl: null },
      paired: true,
      xtermReady: true,
      containerRef,
      actions: mockActions(),
    };
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TerminalPopoutView — auto-close on bring-back", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not close the window while merely connected", () => {
    installMockSession("connected", null);
    const closeSpy = vi.spyOn(window, "close").mockImplementation(() => {});
    render(<TerminalPopoutView payload={PAYLOAD} />);

    vi.advanceTimersByTime(BROUGHT_BACK_AUTO_CLOSE_MS * 2);
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it("shows the fallback screen immediately, then calls window.close() after the delay once brought back", () => {
    installMockSession("error", RELAY_CLOSE.DUP_BROWSER);
    const closeSpy = vi.spyOn(window, "close").mockImplementation(() => {});
    render(<TerminalPopoutView payload={PAYLOAD} />);

    // The calm fallback copy is on screen from the first render — it's also
    // what's visible during the delay, not just what's left if closing fails.
    expect(screen.getByText("Brought back to the dock")).toBeInTheDocument();
    expect(closeSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(BROUGHT_BACK_AUTO_CLOSE_MS);
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it("leaves the fallback screen (and its Close button) intact when the browser refuses the scripted close", () => {
    installMockSession("error", RELAY_CLOSE.DUP_BROWSER);
    vi.spyOn(window, "close").mockImplementation(() => {
      throw new Error("scripts may not close this window");
    });
    render(<TerminalPopoutView payload={PAYLOAD} />);

    expect(() => vi.advanceTimersByTime(BROUGHT_BACK_AUTO_CLOSE_MS)).not.toThrow();
    expect(screen.getByText("Brought back to the dock")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close window" })).toBeInTheDocument();
  });
});
