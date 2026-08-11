// Regression net for fix/terminal-popout-host-mounted: bring-back used to
// leave the dock terminal blank and input-dead because the poppedOut branch
// early-returned a DIFFERENT tree (the placeholder only), unmounting the
// xterm host div (`containerRef`) along with everything else. The hook's
// xterm.js `Terminal` instance survives that unmount detached from any DOM
// node, so nothing re-attaches on bring-back — buffer frozen, socket writing
// invisibly, keyboard handler unreachable.
//
// `useTerminalSession` itself is mocked out entirely (it owns xterm.js/
// WebSocket/posthog wiring already covered by use-terminal-session.test.ts)
// so this file can focus purely on TerminalSessionView's own render
// structure: does the host div's DOM node survive a poppedOut toggle, and is
// visibility driven by CSS (`hidden`/`aria-hidden`) rather than mount/unmount?
//
// The mock hook calls a real `useRef` for `containerRef` — since it's invoked
// in the same hook slot on every render of the SAME component instance,
// React preserves that ref object across re-renders exactly like the real
// hook would. Capturing `containerRef.current` (the actual DOM node React
// assigns the ref to) lets the tests assert real node identity, not just
// object-reference stability of the ref container.

import { useRef } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type {
  UseTerminalSessionResult,
  TerminalSessionActions,
} from "./use-terminal-session";
import { RELAY_CLOSE, PREEMPTED_CLOSE_REASON, type TerminalConnectionState } from "@/lib/terminal/connection";

vi.mock("./use-terminal-session", () => ({
  useTerminalSession: vi.fn(),
}));

import { useTerminalSession } from "./use-terminal-session";
import { TerminalSessionView } from "./terminal-session-view";
import type { SessionEntry } from "./terminal-tabs";

const mockedUseTerminalSession = vi.mocked(useTerminalSession);

// Captured on every mock hook invocation so tests can read the DOM node
// React actually attached to `containerRef` after a render.
let lastContainerRef: React.RefObject<HTMLDivElement | null> | null = null;

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

function installMockSession() {
  mockedUseTerminalSession.mockImplementation((): UseTerminalSessionResult => {
    // Same hook slot every render of the same fiber → React hands back the
    // SAME ref object it did last render, exactly like the real hook.
    const containerRef = useRef<HTMLDivElement | null>(null);
    lastContainerRef = containerRef;
    return {
      state: {
        status: "connected",
        sessionId: "sess-1",
        errorKind: null,
        endedReason: null,
        closeCode: null,
        closeReason: null,
      },
      launchPhase: "idle",
      peerDegraded: false,
      helperVersion: null,
      pair: { sessionId: "sess-1", bridgeToken: "bridge-tok", browserToken: "browser-tok" },
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

// Card cbe60db5 rework 6: installs the mock hook in an "error" state with a
// caller-supplied closeCode/closeReason, standing in for whatever
// isSameOwnerPreemptedClose (connection.ts) needs to discriminate a same-owner
// takeover from a genuine attach-rejection — this file never reaches into the
// real reducer/socket (that's use-terminal-session.test.ts / connection.test.ts);
// it only checks TerminalSessionView renders the right branch for a given state.
function installMockErrorSession(state: Partial<TerminalConnectionState> = {}) {
  mockedUseTerminalSession.mockImplementation((): UseTerminalSessionResult => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    lastContainerRef = containerRef;
    return {
      state: {
        status: "error",
        sessionId: "sess-1",
        errorKind: "duplicate",
        endedReason: null,
        closeCode: RELAY_CLOSE.DUP_BROWSER,
        closeReason: null,
        ...state,
      },
      launchPhase: "idle",
      peerDegraded: false,
      helperVersion: null,
      pair: { sessionId: "sess-1", bridgeToken: "bridge-tok", browserToken: "browser-tok" },
      readOnly: false,
      inputEnabled: false,
      platform: { os: "mac", isAppleSilicon: true, supported: true, downloadLabel: "Download", downloadUrl: null },
      paired: true,
      xtermReady: true,
      containerRef,
      actions: mockActions(),
    };
  });
}

function baseEntry(): SessionEntry {
  return { key: "tab-1", origin: "toolbar", createdAt: Date.now(), launchSeq: 0, launchPayload: null };
}

function renderView(poppedOut: boolean) {
  return render(
    <TerminalSessionView
      entry={baseEntry()}
      descriptor={{ ideaId: "idea-1", ideaTitle: "My Idea", ideaGithubUrl: null }}
      label="Session 1"
      isActive
      expanded
      onRequestExpand={vi.fn()}
      autoConnectWhenExpanded={false}
      onReportSummary={vi.fn()}
      onRegisterActions={vi.fn()}
      onAnnounce={vi.fn()}
      poppedOut={poppedOut}
      onBringBack={vi.fn()}
    />,
  );
}

function renderErrorView(onReconnectTakenOver: (sid: string) => void = vi.fn()) {
  return render(
    <TerminalSessionView
      entry={baseEntry()}
      descriptor={{ ideaId: "idea-1", ideaTitle: "My Idea", ideaGithubUrl: null }}
      label="Session 1"
      isActive
      expanded
      onRequestExpand={vi.fn()}
      autoConnectWhenExpanded={false}
      onReportSummary={vi.fn()}
      onRegisterActions={vi.fn()}
      onAnnounce={vi.fn()}
      onReconnectTakenOver={onReconnectTakenOver}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  lastContainerRef = null;
});

describe("TerminalSessionView — pop-out host mounting", () => {
  it("preserves the terminal host element's identity across a poppedOut true→false toggle", () => {
    installMockSession();
    const { rerender } = renderView(false);
    const hostBeforePopout = lastContainerRef?.current;
    expect(hostBeforePopout).not.toBeNull();

    rerender(
      <TerminalSessionView
        entry={baseEntry()}
        descriptor={{ ideaId: "idea-1", ideaTitle: "My Idea", ideaGithubUrl: null }}
        label="Session 1"
        isActive
        expanded
        onRequestExpand={vi.fn()}
        autoConnectWhenExpanded={false}
        onReportSummary={vi.fn()}
        onRegisterActions={vi.fn()}
        onAnnounce={vi.fn()}
        poppedOut
        onBringBack={vi.fn()}
      />,
    );
    const hostWhilePoppedOut = lastContainerRef?.current;

    rerender(
      <TerminalSessionView
        entry={baseEntry()}
        descriptor={{ ideaId: "idea-1", ideaTitle: "My Idea", ideaGithubUrl: null }}
        label="Session 1"
        isActive
        expanded
        onRequestExpand={vi.fn()}
        autoConnectWhenExpanded={false}
        onReportSummary={vi.fn()}
        onRegisterActions={vi.fn()}
        onAnnounce={vi.fn()}
        poppedOut={false}
        onBringBack={vi.fn()}
      />,
    );
    const hostAfterBringBack = lastContainerRef?.current;

    // The bug this guards against: the old poppedOut early-return replaced
    // the whole subtree, so the host div was a genuinely NEW DOM node after
    // every toggle. It must now be the SAME node throughout.
    expect(hostWhilePoppedOut).toBe(hostBeforePopout);
    expect(hostAfterBringBack).toBe(hostBeforePopout);
  });

  it("keeps the host div in the document (merely hidden) while poppedOut, and shows the placeholder", () => {
    installMockSession();
    renderView(true);

    expect(screen.getByText("Popped out")).toBeInTheDocument();
    expect(
      screen.getByText(/This session is open in another window/),
    ).toBeInTheDocument();

    const host = lastContainerRef?.current ?? null;
    expect(host).not.toBeNull();
    // Still mounted in the document...
    expect(document.body.contains(host)).toBe(true);
    // ...but under an ancestor the component has explicitly hidden.
    expect(host?.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it("shows the host (not hidden) and hides the placeholder once poppedOut is false", () => {
    installMockSession();
    renderView(false);

    const host = lastContainerRef?.current ?? null;
    expect(host).not.toBeNull();
    expect(document.body.contains(host)).toBe(true);
    // Nothing between the host and the outer (visible, active-tab) wrapper is
    // aria-hidden — the normal body is the one showing.
    expect(host?.closest('[aria-hidden="true"]')).toBeNull();

    // The placeholder text is still in the DOM (never unmounted — see the
    // component's "always mounted, CSS hidden" idiom) but sits behind an
    // aria-hidden wrapper.
    const placeholder = screen.getByText("Popped out");
    expect(placeholder.closest('[aria-hidden="true"]')).not.toBeNull();
  });
});

// Card cbe60db5 rework 6 (Nick's field-test item 4): the abandoned tab a
// same-owner reconnect took over used to show the alarming, wrongly-worded
// "This session is already open elsewhere" error. These pin the calm branch
// to the discriminated "takeover" state only, and confirm the genuine
// attach-rejection error is completely unchanged.
describe("TerminalSessionView — same-owner takeover state", () => {
  it("renders the calm 'Taken over' state — no Error text — and wires Reconnect here to the sid", () => {
    const onReconnectTakenOver = vi.fn();
    installMockErrorSession({ closeCode: RELAY_CLOSE.DUP_BROWSER, closeReason: PREEMPTED_CLOSE_REASON });
    renderErrorView(onReconnectTakenOver);

    expect(screen.getByText("This session was taken over in another tab.")).toBeInTheDocument();
    // The header pill: a neutral "Taken over" label, never the rose "Error".
    expect(screen.getAllByText("Taken over").length).toBeGreaterThan(0);
    expect(screen.queryByText("Error")).not.toBeInTheDocument();
    expect(screen.queryByText(/already open elsewhere/)).not.toBeInTheDocument();

    // Exactly one action, and it reattaches THIS sid via the reconnect/
    // take-over flow — not "Try again" (that button belongs to the honest
    // error state only).
    expect(screen.queryByText("Try again")).not.toBeInTheDocument();
    const button = screen.getByRole("button", { name: /Reconnect here/ });
    fireEvent.click(button);
    expect(onReconnectTakenOver).toHaveBeenCalledWith("sess-1");
  });

  it("keeps the genuine attach-rejection error state and copy unchanged — no takeover framing", () => {
    const onReconnectTakenOver = vi.fn();
    // Same 4001 code, but the relay's real "someone else already has this"
    // rejection reason — not the same-owner preemption signal.
    installMockErrorSession({ closeCode: RELAY_CLOSE.DUP_BROWSER, closeReason: "session already attached (single-attach)" });
    renderErrorView(onReconnectTakenOver);

    expect(screen.getByText("This session is already open elsewhere")).toBeInTheDocument();
    expect(
      screen.getByText("Another browser tab is already attached to this session. Close it, then launch again."),
    ).toBeInTheDocument();
    expect(screen.getByText("Error")).toBeInTheDocument();
    expect(screen.queryByText("Taken over")).not.toBeInTheDocument();
    expect(screen.queryByText(/taken over in another tab/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reconnect here/ })).not.toBeInTheDocument();

    // The existing "Try again" affordance is untouched.
    const tryAgain = screen.getByRole("button", { name: /Try again/ });
    fireEvent.click(tryAgain);
    expect(onReconnectTakenOver).not.toHaveBeenCalled();
  });

  it("also treats a missing close reason (older relay / raw abnormal close) as the honest error, not a guess", () => {
    installMockErrorSession({ closeCode: RELAY_CLOSE.DUP_BROWSER, closeReason: null });
    renderErrorView();

    expect(screen.getByText("This session is already open elsewhere")).toBeInTheDocument();
    expect(screen.queryByText("Taken over")).not.toBeInTheDocument();
  });
});
