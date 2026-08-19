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
      cwd: null,
      claudeSessionId: null,
      readOnly: false,
      inputEnabled: true,
      platform: { os: "mac", isAppleSilicon: true, supported: true, downloadLabel: "Download", downloadUrl: null },
      paired: true,
      xtermReady: true,
      containerRef,
      pairingTimedOut: false,
      actions: mockActions(),
    };
  });
}

// Card cbe60db5 rework 10 (stuck-pairing watchdog, 2026-08-14 incident):
// installs the mock hook in the "legacy-waiting" condition
// (status: "waiting-to-pair", launchPhase: "idle") with a caller-supplied
// `pairingTimedOut` — standing in for whatever the real hook's watchdog
// effect (use-terminal-session.test.ts covers that timing logic directly)
// decided. This file only checks TerminalSessionView renders the right
// body for a given `pairingTimedOut` value and wires Retry correctly.
function installMockWaitingSession(pairingTimedOut: boolean) {
  const actions = mockActions();
  mockedUseTerminalSession.mockImplementation((): UseTerminalSessionResult => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    lastContainerRef = containerRef;
    return {
      state: {
        status: "waiting-to-pair",
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
      cwd: null,
      claudeSessionId: null,
      readOnly: false,
      inputEnabled: false,
      platform: { os: "mac", isAppleSilicon: true, supported: true, downloadLabel: "Download", downloadUrl: null },
      paired: true,
      xtermReady: true,
      containerRef,
      pairingTimedOut,
      actions,
    };
  });
  return actions;
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
      cwd: null,
      claudeSessionId: null,
      readOnly: false,
      inputEnabled: false,
      platform: { os: "mac", isAppleSilicon: true, supported: true, downloadLabel: "Download", downloadUrl: null },
      paired: true,
      xtermReady: true,
      containerRef,
      pairingTimedOut: false,
      actions: mockActions(),
    };
  });
}

// Card cbe60db5 rework 9 (Bug A): installs the mock hook in a "session-ended"
// state with a caller-supplied endedReason/cwd/claudeSessionId, standing in
// for the ended session's own resume bookkeeping (use-terminal-session.ts's
// `sessionCwd`/`claudeSessionId`) — this file never reaches into the real
// reducer/socket, it only checks TerminalSessionView renders the right
// Resume-vs-Launch-again branch for a given state.
function installMockEndedSession(
  overrides: Partial<TerminalConnectionState> & { cwd?: string | null; claudeSessionId?: string | null } = {},
) {
  const { cwd = null, claudeSessionId = null, ...stateOverrides } = overrides;
  mockedUseTerminalSession.mockImplementation((): UseTerminalSessionResult => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    lastContainerRef = containerRef;
    return {
      state: {
        status: "session-ended",
        sessionId: "sess-1",
        errorKind: null,
        endedReason: "idle",
        closeCode: 1000,
        closeReason: null,
        ...stateOverrides,
      },
      launchPhase: "idle",
      peerDegraded: false,
      helperVersion: null,
      pair: { sessionId: "sess-1", bridgeToken: "bridge-tok", browserToken: "browser-tok" },
      cwd,
      claudeSessionId,
      readOnly: false,
      inputEnabled: false,
      platform: { os: "mac", isAppleSilicon: true, supported: true, downloadLabel: "Download", downloadUrl: null },
      paired: true,
      xtermReady: true,
      containerRef,
      pairingTimedOut: false,
      actions: mockActions(),
    };
  });
}

function baseEntry(): SessionEntry {
  return { key: "tab-1", origin: "toolbar", createdAt: Date.now(), launchSeq: 0, launchPayload: null };
}

function renderView(poppedOut: boolean, onRetryReconnect?: (sid: string) => void) {
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
      onRetryReconnect={onRetryReconnect}
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

function renderEndedView(
  onResumeEndedSession: (payload: unknown) => void = vi.fn(),
  onBrowseSessions?: () => void,
) {
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
      onResumeEndedSession={onResumeEndedSession}
      onBrowseSessions={onBrowseSessions}
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

// Card cbe60db5 rework 9 (Bug A, Nick's field test 2026-08-14): a timed-out
// session's only option used to be a blind "Launch again" mint, with no way
// back to the conversation that just ended. These pin the new "Resume this
// conversation" primary action for the non-user endings we know a
// cwd/claudeSessionId for, its graceful fallback when we don't, and that a
// deliberate user End never offers it.
describe("TerminalSessionView — session-ended resume (Bug A)", () => {
  it("offers Resume as the primary action for an idle ending with a known cwd + claudeSessionId, wired with the exact-conversation payload shape", () => {
    const onResumeEndedSession = vi.fn();
    installMockEndedSession({
      endedReason: "idle",
      cwd: "/Users/nick/projects/vibe-coding-ideas",
      claudeSessionId: "claude-conv-abc",
    });
    renderEndedView(onResumeEndedSession);

    const resumeButton = screen.getByRole("button", { name: /Resume this conversation/ });
    fireEvent.click(resumeButton);
    expect(onResumeEndedSession).toHaveBeenCalledWith({
      resume: undefined,
      resumeId: "claude-conv-abc",
      cwd: "/Users/nick/projects/vibe-coding-ideas",
      taskId: undefined,
      taskTitle: undefined,
    });

    // The blind mint stays available too, but relabelled so it's never
    // confused with Resume.
    expect(screen.getByRole("button", { name: /Start fresh/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Launch again$/ })).not.toBeInTheDocument();
  });

  it("falls back to the legacy --continue shape (resume:true, no resumeId) when only cwd is known", () => {
    const onResumeEndedSession = vi.fn();
    installMockEndedSession({
      endedReason: "max-duration",
      cwd: "/Users/nick/projects/vibe-coding-ideas",
      claudeSessionId: null,
    });
    renderEndedView(onResumeEndedSession);

    fireEvent.click(screen.getByRole("button", { name: /Resume this conversation/ }));
    expect(onResumeEndedSession).toHaveBeenCalledWith({
      resume: true,
      resumeId: undefined,
      cwd: "/Users/nick/projects/vibe-coding-ideas",
      taskId: undefined,
      taskTitle: undefined,
    });
  });

  it("hides Resume entirely and keeps the plain 'Launch again' button when no cwd is known (legacy pre-0.3.3 session)", () => {
    installMockEndedSession({ endedReason: "idle", cwd: null, claudeSessionId: null });
    renderEndedView();

    expect(screen.queryByRole("button", { name: /Resume this conversation/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Launch again$/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Start fresh/ })).not.toBeInTheDocument();
  });

  it("never offers Resume for a deliberate user-initiated end, even with a known cwd + claudeSessionId", () => {
    installMockEndedSession({
      endedReason: "user",
      cwd: "/Users/nick/projects/vibe-coding-ideas",
      claudeSessionId: "claude-conv-abc",
    });
    renderEndedView();

    expect(screen.queryByRole("button", { name: /Resume this conversation/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Launch again$/ })).toBeInTheDocument();
  });

  // Bug cbe60db5-followup-2 (low-medium): the ended panel had no path to a
  // user's other live/recent sessions in either button configuration
  // (Resume+Start-fresh, or Launch-again-alone). The callback it fires is
  // deliberately NOT onCapExceeded's "My sessions" trigger any more (Nick's
  // field report 2026-08-19) — that panel is running-only, so it could never
  // show the ended sessions this link's wording promises. The dock now points
  // it at the chooser; see terminal-dock.test.tsx for that half.
  it("renders a 'View my other sessions' link that calls onBrowseSessions, alongside the Resume+Start-fresh buttons", () => {
    const onBrowseSessions = vi.fn();
    installMockEndedSession({
      endedReason: "idle",
      cwd: "/Users/nick/projects/vibe-coding-ideas",
      claudeSessionId: "claude-conv-abc",
    });
    renderEndedView(vi.fn(), onBrowseSessions);

    const link = screen.getByRole("button", { name: /View my other sessions/ });
    fireEvent.click(link);
    expect(onBrowseSessions).toHaveBeenCalledTimes(1);
  });

  it("also renders the link alongside the plain 'Launch again' button (no cwd known)", () => {
    const onBrowseSessions = vi.fn();
    installMockEndedSession({ endedReason: "idle", cwd: null, claudeSessionId: null });
    renderEndedView(vi.fn(), onBrowseSessions);

    expect(screen.getByRole("button", { name: /View my other sessions/ })).toBeInTheDocument();
  });

  it("omits the link entirely when onBrowseSessions isn't wired (matches the optional-callback-gated-UI pattern used elsewhere in this file)", () => {
    installMockEndedSession({
      endedReason: "idle",
      cwd: "/Users/nick/projects/vibe-coding-ideas",
      claudeSessionId: "claude-conv-abc",
    });
    renderEndedView();

    expect(screen.queryByRole("button", { name: /View my other sessions/ })).not.toBeInTheDocument();
  });
});

// Card cbe60db5 rework 10 (stuck-pairing watchdog, 2026-08-14 incident): a
// session stuck on "Waiting for your machine to attach" (legacy-waiting)
// used to have no timeout at all. Once the hook's watchdog reports
// `pairingTimedOut`, the body must swap to the existing TimeoutPanel's
// "returning" copy — reusing it exactly, not the open-ended waiting panel.
// The watchdog's OWN timing (does it actually fire after RECONNECT_GRACE_MS,
// does the opt-out manual flow ever arm it) is covered in
// use-terminal-session.test.ts; this file only checks the presentational
// swap and the Retry wiring, same division of labour as every other view
// test in here.
//
// Reconnect-relaunch fix: Retry used to be wired to a blind fresh
// connect({autoLaunch:true}) — minting an entirely unrelated NEW session
// instead of re-attempting the one stuck on screen. It's now wired to
// `onRetryReconnect` (terminal-dock.tsx's performReattach, the SAME reattach
// flow "My sessions"/chooser Reconnect use) with a defensive fallback to the
// old connect() behaviour for a caller that doesn't wire it.
describe("TerminalSessionView — stuck-pairing watchdog timeout panel", () => {
  it("shows the normal 'Waiting for your machine to attach' panel while pairingTimedOut is false", () => {
    installMockWaitingSession(false);
    renderView(false);

    expect(screen.getByText("Waiting for your machine to attach")).toBeInTheDocument();
    expect(screen.queryByText("Couldn’t reach the helper on this Mac")).not.toBeInTheDocument();
  });

  it("swaps to the TimeoutPanel's 'returning' copy once pairingTimedOut is true, wiring Retry to re-attempt the ORIGINAL sid", () => {
    const actions = installMockWaitingSession(true);
    const onRetryReconnect = vi.fn();
    renderView(false, onRetryReconnect);

    // The existing "returning" variant's copy, reused exactly — not the
    // open-ended legacy-waiting text.
    expect(screen.getByText("Couldn’t reach the helper on this Mac")).toBeInTheDocument();
    expect(screen.queryByText("Waiting for your machine to attach")).not.toBeInTheDocument();
    expect(screen.queryByText("Didn’t connect yet")).not.toBeInTheDocument();

    const retry = screen.getByRole("button", { name: /Retry/ });
    fireEvent.click(retry);
    // The stuck session's own sid ("sess-1", installMockWaitingSession's pair)
    // — never a blind fresh mint, which orphans the stuck session and burns a
    // new cap slot for no reason (the bug this fixes).
    expect(onRetryReconnect).toHaveBeenCalledWith("sess-1");
    expect(actions.connect).not.toHaveBeenCalled();
    expect(actions.reconnectNow).not.toHaveBeenCalled();
  });

  it("falls back to a fresh connect({autoLaunch:true}) when no reattach handler is wired (defensive)", () => {
    const actions = installMockWaitingSession(true);
    renderView(false); // no onRetryReconnect passed

    const retry = screen.getByRole("button", { name: /Retry/ });
    fireEvent.click(retry);
    expect(actions.connect).toHaveBeenCalledWith({ autoLaunch: true });
  });
});
