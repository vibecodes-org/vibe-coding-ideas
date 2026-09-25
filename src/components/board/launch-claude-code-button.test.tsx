import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import {
  DropdownMenu,
  DropdownMenuContent,
} from "@/components/ui/dropdown-menu";

// Radix DropdownMenu's Popper positioning uses ResizeObserver, which jsdom lacks
// (same stub used in task-edit-dialog.test.tsx for the Radix Checkbox case).
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

const mediaMatches = vi.fn(() => true);
vi.mock("@/hooks/use-media-query", () => ({
  useMediaQuery: () => mediaMatches(),
}));

const mockCapture = vi.fn();
vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: mockCapture }),
}));

const mockIsBrowserLaunchAvailable = vi.fn(() => true);
const mockRequestBrowserLaunch = vi.fn();
vi.mock("@/lib/terminal/launch-mode", () => ({
  isBrowserLaunchAvailable: () => mockIsBrowserLaunchAvailable(),
  requestBrowserLaunch: (payload: unknown) => mockRequestBrowserLaunch(payload),
}));

const mockRelayBaseUrl = vi.fn(() => "ws://127.0.0.1:8787");
vi.mock("@/lib/terminal/connection", () => ({
  isTerminalEnabled: () => true,
  relayBaseUrl: () => mockRelayBaseUrl(),
}));

const mockFetchHelperStatus = vi.fn();
vi.mock("@/lib/terminal/helper-row", () => ({
  fetchHelperStatus: () => mockFetchHelperStatus(),
}));

// The launch-time re-read of the recorded folders (Nick, 3 Sep 2026 — see
// resolveFreshLaunch in the component). Resolves to null by default ("read
// failed, keep the snapshot"); individual tests override it.
const mockListRecordedProjectPaths = vi.fn(
  async (_ideaId: string): Promise<{ hostname: string; absolute_path: string }[] | null> => null
);
vi.mock("@/actions/launch-path", () => ({
  listRecordedProjectPaths: (ideaId: string) => mockListRecordedProjectPaths(ideaId),
  saveManualProjectPath: vi.fn(),
}));

// Card c4c27987 (Option A) — the remembered-agent hook is mocked so each
// test controls the label/menu state directly, independent of the hook's
// own module-level cache and server round-trips (those get their own tests
// in use-viewer-terminal-agent.test.ts).
const mockRememberedAgent = vi.fn<() => "claude" | "codex" | undefined>(() => "claude");
const mockPersistViewerTerminalAgent = vi.fn(
  async (agent: "claude" | "codex", _opts?: { source?: "picker" | "footer" | "undo" }) => agent
);
vi.mock("@/hooks/use-viewer-terminal-agent", () => ({
  useViewerTerminalAgent: () => mockRememberedAgent(),
  persistViewerTerminalAgent: (agent: "claude" | "codex", opts?: { source?: "picker" | "footer" | "undo" }) =>
    mockPersistViewerTerminalAgent(agent, opts),
}));

import { LaunchClaudeCodeButton } from "./launch-claude-code-button";
import { buildGuideBootstrapStep, type CompactPromptEssentials } from "@/lib/launch-claude-code";

/**
 * jsdom's `window.location.assign` isn't spy-able directly (its property
 * descriptor isn't configurable), so swap in a plain object with the real
 * Location's properties plus a spy-able `assign`, then restore the original.
 */
function stubLocationAssign() {
  const original = window.location;
  const assign = vi.fn();
  Object.defineProperty(window, "location", {
    value: Object.assign(Object.create(Object.getPrototypeOf(original) as object), original, { assign }),
    configurable: true,
    writable: true,
  });
  return {
    assign,
    restore: () => {
      Object.defineProperty(window, "location", {
        value: original,
        configurable: true,
        writable: true,
      });
    },
  };
}

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mediaMatches.mockReturnValue(true); // desktop
  mockIsBrowserLaunchAvailable.mockReturnValue(true);
  mockRelayBaseUrl.mockReturnValue("ws://127.0.0.1:8787");
  mockFetchHelperStatus.mockResolvedValue(null);
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ helperToken: "helper-tok" }) });
  mockRememberedAgent.mockReturnValue("claude");
  mockPersistViewerTerminalAgent.mockImplementation(async (agent) => agent);
});

/** Renders the task-menu-item variant inside a real, always-open DropdownMenu
 * (matching how task-card-menu.tsx hosts it), so the items land in the DOM via
 * Radix's portal. */
function renderMenuItem(
  overrides: {
    taskId?: string;
    recordedProjectPaths?: import("@/lib/launch-claude-code").RecordedProjectPath[];
  } = {}
) {
  render(
    <DropdownMenu open onOpenChange={() => {}}>
      <DropdownMenuContent>
        <LaunchClaudeCodeButton
          variant="task-menu-item"
          ideaId="idea-1"
          ideaTitle="Idea One"
          ideaGithubUrl={null}
          taskId={overrides.taskId ?? "task-123"}
          taskTitle="Do the thing"
          recordedProjectPaths={overrides.recordedProjectPaths}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

describe("LaunchClaudeCodeButton — task-menu-item variant (browser launch item)", () => {
  it("renders both items, terminal first, with the Beta pill on the browser item, when the flag is on (desktop)", () => {
    renderMenuItem();

    const items = screen.getAllByRole("menuitem");
    // Codex support (implementation slice 2): the Claude items keep their
    // exact positions; two Codex twins follow (design §7b).
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveTextContent("Launch in Claude Code");
    expect(items[1]).toHaveTextContent("Launch in browser terminal");
    expect(items[1]).toHaveTextContent("Beta");
    expect(items[2]).toHaveTextContent("Launch in Codex");
    expect(items[3]).toHaveTextContent("Launch Codex in browser terminal");
    expect(items[3]).toHaveTextContent("Beta");
  });

  it("clicking the browser item calls requestBrowserLaunch and does not navigate", async () => {
    const location = stubLocationAssign();

    renderMenuItem();
    fireEvent.click(screen.getByRole("menuitem", { name: /Launch in browser terminal/i }));

    await waitFor(() => expect(mockRequestBrowserLaunch).toHaveBeenCalledTimes(1));
    expect(location.assign).not.toHaveBeenCalled();

    location.restore();
  });

  it("carries the task id in the browser-launch payload", async () => {
    renderMenuItem({ taskId: "task-abc-789" });
    fireEvent.click(screen.getByRole("menuitem", { name: /Launch in browser terminal/i }));

    await waitFor(() => expect(mockRequestBrowserLaunch).toHaveBeenCalledTimes(1));
    const payload = mockRequestBrowserLaunch.mock.calls[0][0] as {
      essentials: { head: string; tail: string };
    };
    const promptText = `${payload.essentials.head}\n${payload.essentials.tail}`;
    expect(promptText).toContain("task-abc-789");
  });

  it("carries an EXPLICIT agent:'claude' in the browser-launch payload (regression: an explicit Claude choice must not be dropped to undefined, which the dock reads as 'remembered pick' and defaults to Codex)", async () => {
    renderMenuItem({ taskId: "task-abc-789" });
    fireEvent.click(screen.getByRole("menuitem", { name: /Launch in browser terminal/i }));

    await waitFor(() => expect(mockRequestBrowserLaunch).toHaveBeenCalledTimes(1));
    const payload = mockRequestBrowserLaunch.mock.calls[0][0] as { agent?: string };
    expect(payload.agent).toBe("claude");
  });

  it("carries agent:'codex' when launching Codex in the browser", async () => {
    renderMenuItem({ taskId: "task-abc-789" });
    fireEvent.click(screen.getByRole("menuitem", { name: /Launch Codex in browser terminal/i }));

    await waitFor(() => expect(mockRequestBrowserLaunch).toHaveBeenCalledTimes(1));
    const payload = mockRequestBrowserLaunch.mock.calls[0][0] as { agent?: string };
    expect(payload.agent).toBe("codex");
  });

  // Nick, 3 Sep 2026: the board page's recorded-folder list is a one-shot SSR
  // snapshot. A folder the agent recorded during the PREVIOUS session on this
  // page was invisible to the next launch until a reload, so that launch went
  // out as a "new project" (no cwd, mkdir prompt) — and the longer prompt
  // then cost it the task step. The click now re-reads the folders first.
  describe("launch-time re-read of the recorded folders", () => {
    it("re-reads the recorded folders on click and launches into a folder the page snapshot didn't have", async () => {
      mockListRecordedProjectPaths.mockResolvedValueOnce([
        { hostname: "Nicks-MacBook-Pro.local", absolute_path: "/Users/nickball/projects/favourites" },
      ]);
      renderMenuItem(); // no recordedProjectPaths prop at all — the stale-page shape
      fireEvent.click(screen.getByRole("menuitem", { name: /Launch in browser terminal/i }));

      await waitFor(() => expect(mockRequestBrowserLaunch).toHaveBeenCalledTimes(1));
      expect(mockListRecordedProjectPaths).toHaveBeenCalledWith("idea-1");
      const payload = mockRequestBrowserLaunch.mock.calls[0][0] as {
        cwd?: string;
        essentials: { head: string; tail: string; directoryEcho?: string };
      };
      expect(payload.cwd).toBe("/Users/nickball/projects/favourites");
      // Existing-folder prompt, not the create-new one.
      expect(payload.essentials.head).not.toContain("mkdir");
      expect(payload.essentials.directoryEcho).toContain("/Users/nickball/projects/favourites");
    });

    it("falls back to the page snapshot when the re-read fails, and still launches", async () => {
      mockListRecordedProjectPaths.mockRejectedValueOnce(new Error("offline"));
      renderMenuItem();
      fireEvent.click(screen.getByRole("menuitem", { name: /Launch in browser terminal/i }));

      await waitFor(() => expect(mockRequestBrowserLaunch).toHaveBeenCalledTimes(1));
      const payload = mockRequestBrowserLaunch.mock.calls[0][0] as { cwd?: string };
      expect(payload.cwd).toBeUndefined();
    });

    it("the terminal-window launch re-reads too, and carries the fresh folder as cwd", async () => {
      const location = stubLocationAssign();
      mockListRecordedProjectPaths.mockResolvedValueOnce([
        { hostname: "Nicks-MacBook-Pro.local", absolute_path: "/Users/nickball/projects/favourites" },
      ]);
      renderMenuItem();
      fireEvent.click(screen.getByRole("menuitem", { name: /^Launch in Claude Code/i }));

      await waitFor(() => expect(location.assign).toHaveBeenCalledTimes(1));
      const link = location.assign.mock.calls[0][0] as string;
      expect(link).toContain(`cwd=${encodeURIComponent("/Users/nickball/projects/favourites")}`);
      location.restore();
    });
  });

  it("renders only the terminal item, with no Beta text, when the flag is off", () => {
    mockIsBrowserLaunchAvailable.mockReturnValue(false);
    renderMenuItem();

    const items = screen.getAllByRole("menuitem");
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent("Launch in Claude Code");
    expect(screen.queryByText("Beta")).toBeNull();
    expect(screen.queryByText(/Launch in browser terminal/i)).toBeNull();
  });

  it("terminal item's onSelect is unchanged: clicking it does not call requestBrowserLaunch", async () => {
    const location = stubLocationAssign();

    renderMenuItem();
    fireEvent.click(screen.getByRole("menuitem", { name: "Launch in Claude Code" }));

    await waitFor(() => expect(location.assign).toHaveBeenCalledTimes(1));
    expect(mockRequestBrowserLaunch).not.toHaveBeenCalled();

    location.restore();
  });

  // Task b563f4da: fresh browser launches carry the agent-guide step, matched
  // to the chosen agent; the terminal-window launch (claude-cli://) doesn't.
  it.each([
    { name: /Launch in browser terminal/i, agent: "claude" as const },
    { name: /Launch Codex in browser terminal/i, agent: "codex" as const },
  ])("the $agent browser payload carries that agent's guide step, with the task id", async ({ name, agent }) => {
    renderMenuItem({ taskId: "task-abc-789" });
    fireEvent.click(screen.getByRole("menuitem", { name }));

    await waitFor(() => expect(mockRequestBrowserLaunch).toHaveBeenCalledTimes(1));
    const payload = mockRequestBrowserLaunch.mock.calls[0][0] as { essentials: CompactPromptEssentials };
    expect(payload.essentials.guideStep).toBe(buildGuideBootstrapStep(agent));
    expect(payload.essentials.headSteps).toContain(buildGuideBootstrapStep(agent));
    expect(payload.essentials.packed?.guideStep).toBe(buildGuideBootstrapStep(agent));
    expect(payload.essentials.work).toContain("task-abc-789");
  });

  it("the terminal-window (claude-cli://) launch does not carry the guide step", async () => {
    const location = stubLocationAssign();

    renderMenuItem();
    fireEvent.click(screen.getByRole("menuitem", { name: "Launch in Claude Code" }));

    await waitFor(() => expect(location.assign).toHaveBeenCalledTimes(1));
    const url = location.assign.mock.calls[0][0] as string;
    expect(decodeURIComponent(url)).not.toContain("checkout root");
    expect(decodeURIComponent(url)).not.toContain("AGENTS.md");

    location.restore();
  });
});

/** Renders the "board" variant, which owns its own split-button + dropdown
 * (unlike task-menu-item, it isn't hosted inside an external DropdownMenu). */
function renderBoardButton(overrides: {
  ideaGithubUrl?: string | null;
  recordedProjectPaths?: import("@/lib/launch-claude-code").RecordedProjectPath[];
} = {}) {
  render(
    <LaunchClaudeCodeButton
      variant="board"
      ideaId="idea-1"
      ideaTitle="Idea One"
      ideaGithubUrl={overrides.ideaGithubUrl ?? null}
      recordedProjectPaths={overrides.recordedProjectPaths}
    />
  );
}

describe("LaunchClaudeCodeButton — board variant dropdown path line", () => {
  it("shows the recorded path for a repo-backed idea (fix: cwd is no longer dropped just because a repo is attached)", () => {
    renderBoardButton({
      ideaGithubUrl: "https://github.com/acme/widgets",
      recordedProjectPaths: [{ hostname: "nick-mbp", absolute_path: "/Users/nick/projects/widgets" }],
    });

    const trigger = screen.getByRole("button", { name: "More ways to launch" });
    fireEvent.pointerDown(trigger, { button: 0, pointerId: 1 });
    fireEvent.click(trigger);

    expect(screen.getByText("This machine — nick-mbp")).toBeInTheDocument();
    expect(screen.getByText("/Users/nick/projects/widgets")).toBeInTheDocument();
  });

  it("shows no path line for a repo-backed idea with no recorded path (first-launch/clone flow)", () => {
    renderBoardButton({ ideaGithubUrl: "https://github.com/acme/widgets" });

    const trigger = screen.getByRole("button", { name: "More ways to launch" });
    fireEvent.pointerDown(trigger, { button: 0, pointerId: 1 });
    fireEvent.click(trigger);

    expect(screen.queryByText(/This machine/)).toBeNull();
  });
});

// ── claude-cli:// isolation advisory wiring (board task 48eb844b) ──────────
//
// claude-cli:// (this button's terminal-window launch, via window.location.assign)
// is a third-party handler with no --worktree-flag plumbing, so the advisory
// note has to ride the prompt TEXT it fires. vibecodes:// (the "in the
// browser" item, via requestBrowserLaunch) already gets a REAL --worktree
// flag from the dock reading `essentials.isolate` — it must NOT also get the
// redundant text.
describe("LaunchClaudeCodeButton — isolation advisory only on the claude-cli:// destination", () => {
  const recordedProjectPaths = [
    { hostname: "nick-mbp", absolute_path: "/Users/nick/projects/widgets" },
  ];

  function decodeQ(url: string): string {
    const match = url.match(/[?&]q=([^&]*)/);
    return match ? decodeURIComponent(match[1]) : "";
  }

  it("terminal-window launch (claude-cli://) fires a link whose prompt contains the isolation note", async () => {
    const location = stubLocationAssign();
    renderBoardButton({
      ideaGithubUrl: "https://github.com/acme/widgets",
      recordedProjectPaths,
    });

    fireEvent.click(screen.getByRole("button", { name: /Launch Claude Code/i }));

    await waitFor(() => expect(location.assign).toHaveBeenCalledTimes(1));
    const url = location.assign.mock.calls[0][0] as string;
    expect(decodeQ(url)).toContain("git worktree add");

    location.restore();
  });

  it("in-browser launch (vibecodes://) payload carries isolate:true but NO isolation note text (the dock fires the real --worktree flag instead)", async () => {
    renderBoardButton({
      ideaGithubUrl: "https://github.com/acme/widgets",
      recordedProjectPaths,
    });

    const trigger = screen.getByRole("button", { name: "More ways to launch" });
    fireEvent.pointerDown(trigger, { button: 0, pointerId: 1 });
    fireEvent.click(trigger);
    // Codex support (implementation slice 2): the dropdown now has TWO "In
    // the browser" items (Claude Code, then Codex — design §13) — the first
    // is Claude's, which this test targets.
    fireEvent.click(screen.getAllByRole("menuitem", { name: /In the browser/i })[0]);

    await waitFor(() => expect(mockRequestBrowserLaunch).toHaveBeenCalledTimes(1));
    const payload = mockRequestBrowserLaunch.mock.calls[0][0] as {
      essentials: { head: string; tail: string; isolate?: boolean };
    };
    expect(payload.essentials.isolate).toBe(true);
    const promptText = `${payload.essentials.head}\n${payload.essentials.tail}`;
    expect(promptText).not.toContain("git worktree add");
  });
});

// ── Desktop Codex — "Launch in Codex" (implementation slice 3, FR-11–FR-14) ──

describe("LaunchClaudeCodeButton — desktop Codex (\"Launch in Codex\")", () => {
  const MACHINE_IDENTITY_KEY = "vc:term:machine";
  const recordedProjectPaths = [{ hostname: "nick-mbp", absolute_path: "/Users/nick/projects/widgets" }];

  afterEach(() => {
    window.localStorage.removeItem(MACHINE_IDENTITY_KEY);
  });

  /** A resolvable cwd needs a recorded path AND a matching "this machine"
   *  identity — set both so resolveFreshLaunch finds a real folder (FR-12
   *  requires an existing folder; see the "no folder recorded" test below
   *  for the other branch). */
  function clickLaunchInCodex(withKnownFolder: boolean) {
    window.localStorage.setItem(MACHINE_IDENTITY_KEY, withKnownFolder ? "nick-mbp" : "some-other-machine");
    renderMenuItem({ recordedProjectPaths: withKnownFolder ? recordedProjectPaths : [] });
    fireEvent.click(screen.getByRole("menuitem", { name: /Launch in Codex/i }));
  }

  it("fires a vibecodes://open-terminal link with agent=codex when the helper reports codex installed", async () => {
    mockFetchHelperStatus.mockResolvedValue({
      connected: true,
      version: "99.0.0", // future-proof: a "current-enough" helper regardless of the min-version bump
      machineLabel: null,
      alwaysOn: false,
      stoppedUnexpectedly: false,
      lastEventAt: null,
      codexInstalled: true,
      claudeInstalled: true,
    });
    const location = stubLocationAssign();

    clickLaunchInCodex(true);

    await waitFor(() => expect(location.assign).toHaveBeenCalledTimes(1));
    const url = location.assign.mock.calls[0][0] as string;
    expect(url.startsWith("vibecodes://open-terminal?")).toBe(true);
    expect(url).toContain("agent=codex");
    expect(url).toContain("helperToken=");
    expect(url).not.toContain("session=");
    expect(global.fetch).toHaveBeenCalledWith("/api/terminal/helper/token", { method: "POST" });
    // Task b563f4da is scoped to browser launches: the Terminal-window Codex
    // launch keeps its existing prompt, with no guide step.
    expect(new URL(url).searchParams.get("prompt") ?? "").not.toContain("checkout root");

    location.restore();
  });

  it("helper idle/unknown (null status) STILL fires the link when a folder is known — the launch cold-launches the sleeping helper", async () => {
    // Regression: the helper sleeps when idle, so it is usually NOT connected
    // at click time. A null/disconnected status must NOT block — firing the
    // vibecodes://open-terminal link is what wakes the helper (which then runs
    // its own codex/version checks). Blocking here made "Launch in Codex" a
    // no-op whenever the helper wasn't already running.
    mockFetchHelperStatus.mockResolvedValue(null);
    const location = stubLocationAssign();

    clickLaunchInCodex(true);

    await waitFor(() => expect(location.assign).toHaveBeenCalledTimes(1));
    const url = location.assign.mock.calls[0][0] as string;
    expect(url.startsWith("vibecodes://open-terminal?")).toBe(true);
    expect(url).toContain("agent=codex");

    location.restore();
  });

  it("helper too old: shows an update toast, never fires a link", async () => {
    mockFetchHelperStatus.mockResolvedValue({
      connected: true,
      version: "0.1.0",
      machineLabel: null,
      alwaysOn: false,
      stoppedUnexpectedly: false,
      lastEventAt: null,
      codexInstalled: true,
      claudeInstalled: true,
    });
    const location = stubLocationAssign();

    clickLaunchInCodex(false);

    await waitFor(() => expect(mockCapture).toHaveBeenCalledWith("launch_claude_code_clicked", expect.anything()));
    expect(location.assign).not.toHaveBeenCalled();

    location.restore();
  });

  it("codex reported missing: shows the not-installed toast with an install link, never fires a link", async () => {
    mockFetchHelperStatus.mockResolvedValue({
      connected: true,
      version: "99.0.0", // future-proof: a "current-enough" helper regardless of the min-version bump
      machineLabel: null,
      alwaysOn: false,
      stoppedUnexpectedly: false,
      lastEventAt: null,
      codexInstalled: false,
      claudeInstalled: true,
    });
    const location = stubLocationAssign();

    clickLaunchInCodex(false);

    await waitFor(() => expect(mockCapture).toHaveBeenCalledWith("launch_claude_code_clicked", expect.anything()));
    expect(location.assign).not.toHaveBeenCalled();

    location.restore();
  });

  it("unknown codex-installed state (older helper, null) does NOT block the launch (unknown reads as enabled)", async () => {
    mockFetchHelperStatus.mockResolvedValue({
      connected: true,
      version: "99.0.0", // future-proof: a "current-enough" helper regardless of the min-version bump
      machineLabel: null,
      alwaysOn: false,
      stoppedUnexpectedly: false,
      lastEventAt: null,
      codexInstalled: null,
      claudeInstalled: null,
    });
    const location = stubLocationAssign();

    clickLaunchInCodex(true);

    await waitFor(() => expect(location.assign).toHaveBeenCalledTimes(1));
    const url = location.assign.mock.calls[0][0] as string;
    expect(url).toContain("agent=codex");

    location.restore();
  });

  it("no folder known: opens the pick-a-folder dialog instead of firing a folder-less launch (FR-12)", async () => {
    mockFetchHelperStatus.mockResolvedValue({
      connected: true,
      version: "99.0.0", // future-proof: a "current-enough" helper regardless of the min-version bump
      machineLabel: null,
      alwaysOn: false,
      stoppedUnexpectedly: false,
      lastEventAt: null,
      codexInstalled: true,
      claudeInstalled: true,
    });
    const location = stubLocationAssign();

    clickLaunchInCodex(false);

    // The dialog (rendered by LaunchPathDialog) opens instead of a link firing.
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    expect(location.assign).not.toHaveBeenCalled();

    location.restore();
  });
});

// ── Card c4c27987 (Option A): primary button follows the remembered agent ──

function openBoardMenu() {
  const trigger = screen.getByRole("button", { name: "More ways to launch" });
  fireEvent.pointerDown(trigger, { button: 0, pointerId: 1 });
  fireEvent.click(trigger);
}

describe("LaunchClaudeCodeButton — board primary label follows the remembered agent (AC-1/2)", () => {
  it("remembered agent claude (new account default): label 'Launch Claude Code'", () => {
    mockRememberedAgent.mockReturnValue("claude");
    renderBoardButton();
    expect(screen.getByRole("button", { name: /Launch Claude Code/i })).toBeInTheDocument();
  });

  it("remembered agent codex: label 'Launch Codex', tooltip set", () => {
    mockRememberedAgent.mockReturnValue("codex");
    renderBoardButton();
    const button = screen.getByRole("button", { name: /Launch Codex/i });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute("title", "Opens a Terminal window on this Mac");
  });

  it("loading (hook returns undefined): renders the Claude label, no spinner/skeleton", () => {
    mockRememberedAgent.mockReturnValue(undefined);
    renderBoardButton();
    expect(screen.getByRole("button", { name: /Launch Claude Code/i })).toBeInTheDocument();
  });

  it("terminal flag off: always Claude Code regardless of the remembered agent", () => {
    mockIsBrowserLaunchAvailable.mockReturnValue(false);
    mockRememberedAgent.mockReturnValue("codex");
    renderBoardButton();
    expect(screen.getByRole("button", { name: /Launch Claude Code/i })).toBeInTheDocument();
    openBoardMenu();
    expect(screen.getByRole("menuitem", { name: /Open in Claude Code/i })).toBeInTheDocument();
    expect(screen.queryByText("Your default")).toBeNull();
    expect(screen.queryByText(/Default agent:/)).toBeNull();
  });

  it("Claude primary click: launch URL is byte-identical to today (deep_link, claude-cli://)", async () => {
    mockRememberedAgent.mockReturnValue("claude");
    const location = stubLocationAssign();
    renderBoardButton();
    fireEvent.click(screen.getByRole("button", { name: /Launch Claude Code/i }));
    await waitFor(() => expect(location.assign).toHaveBeenCalledTimes(1));
    expect((location.assign.mock.calls[0][0] as string).startsWith("claude-cli://open?")).toBe(true);
    expect(mockCapture).toHaveBeenCalledWith(
      "launch_claude_code_clicked",
      expect.objectContaining({ method: "deep_link", agent: "claude" })
    );
    location.restore();
  });

  it("Codex primary click (folder known): fires the Codex terminal-window launch, not Claude's", async () => {
    mockRememberedAgent.mockReturnValue("codex");
    mockFetchHelperStatus.mockResolvedValue({
      connected: true,
      version: "99.0.0",
      machineLabel: null,
      alwaysOn: false,
      stoppedUnexpectedly: false,
      lastEventAt: null,
      codexInstalled: true,
      claudeInstalled: true,
    });
    window.localStorage.setItem("vc:term:machine", "nick-mbp");
    const location = stubLocationAssign();
    renderBoardButton({
      recordedProjectPaths: [{ hostname: "nick-mbp", absolute_path: "/Users/nick/projects/widgets" }],
    });
    fireEvent.click(screen.getByRole("button", { name: /Launch Codex/i }));
    await waitFor(() => expect(location.assign).toHaveBeenCalledTimes(1));
    const url = location.assign.mock.calls[0][0] as string;
    expect(url.startsWith("vibecodes://open-terminal?")).toBe(true);
    expect(url).toContain("agent=codex");
    window.localStorage.removeItem("vc:term:machine");
    location.restore();
  });

  it("Codex primary click with NO recorded folder: opens the folder dialog, then continues the SAME Codex launch after Save (AC-4)", async () => {
    const { saveManualProjectPath } = await import("@/actions/launch-path");
    vi.mocked(saveManualProjectPath).mockResolvedValue({
      ok: true,
      recorded: { hostname: "nick-mbp", absolute_path: "/Users/nick/projects/widgets" },
    });
    mockRememberedAgent.mockReturnValue("codex");
    mockFetchHelperStatus.mockResolvedValue({
      connected: true,
      version: "99.0.0",
      machineLabel: null,
      alwaysOn: false,
      stoppedUnexpectedly: false,
      lastEventAt: null,
      codexInstalled: true,
      claudeInstalled: true,
    });
    const location = stubLocationAssign();
    renderBoardButton();

    fireEvent.click(screen.getByRole("button", { name: /Launch Codex/i }));
    const dialog = await screen.findByRole("dialog");
    expect(location.assign).not.toHaveBeenCalled();

    const input = within(dialog).getByRole("textbox");
    fireEvent.change(input, { target: { value: "/Users/nick/projects/widgets" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Save & launch/i }));

    await waitFor(() => expect(location.assign).toHaveBeenCalledTimes(1));
    const url = location.assign.mock.calls[0][0] as string;
    expect(url.startsWith("vibecodes://open-terminal?")).toBe(true);
    expect(url).toContain("agent=codex");
    location.restore();
  });

  it("Codex dialog (no folder) closes via Escape and fires nothing (never-trap rule)", async () => {
    mockRememberedAgent.mockReturnValue("codex");
    mockFetchHelperStatus.mockResolvedValue({
      connected: true,
      version: "99.0.0",
      machineLabel: null,
      alwaysOn: false,
      stoppedUnexpectedly: false,
      lastEventAt: null,
      codexInstalled: true,
      claudeInstalled: true,
    });
    const location = stubLocationAssign();
    renderBoardButton();
    fireEvent.click(screen.getByRole("button", { name: /Launch Codex/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(location.assign).not.toHaveBeenCalled();
    location.restore();
  });

  it("chevron aria-label is 'More ways to launch'", () => {
    renderBoardButton();
    expect(screen.getByRole("button", { name: "More ways to launch" })).toBeInTheDocument();
  });
});

describe("LaunchClaudeCodeButton — board menu: remembered-agent group order + chip (AC-6/7/8/9)", () => {
  it("Claude remembered: Claude group first with the 'Your default' chip, Codex group second, no chip", () => {
    mockRememberedAgent.mockReturnValue("claude");
    renderBoardButton();
    openBoardMenu();

    const groups = screen.getAllByRole("group");
    expect(groups.length).toBeGreaterThanOrEqual(2);
    expect(within(groups[0]).getByText("Claude Code")).toBeInTheDocument();
    expect(within(groups[0]).getByText("Your default")).toBeInTheDocument();
    expect(within(groups[1]).getByText("Codex")).toBeInTheDocument();
    expect(within(groups[1]).queryByText("Your default")).toBeNull();
  });

  it("Codex remembered: Codex group first with the chip, Claude group second, footer flips", () => {
    mockRememberedAgent.mockReturnValue("codex");
    renderBoardButton();
    openBoardMenu();

    const groups = screen.getAllByRole("group");
    expect(within(groups[0]).getByText("Codex")).toBeInTheDocument();
    expect(within(groups[0]).getByText("Your default")).toBeInTheDocument();
    expect(within(groups[1]).getByText("Claude Code")).toBeInTheDocument();
    expect(screen.getByText("Codex", { selector: "b" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Switch to Claude Code/i })).toBeInTheDocument();
  });

  it("each agent item launches exactly that agent and never writes the remembered preference (PR #281 posture)", async () => {
    mockRememberedAgent.mockReturnValue("claude");
    mockFetchHelperStatus.mockResolvedValue({
      connected: true,
      version: "99.0.0",
      machineLabel: null,
      alwaysOn: false,
      stoppedUnexpectedly: false,
      lastEventAt: null,
      codexInstalled: true,
      claudeInstalled: true,
    });
    renderBoardButton();
    openBoardMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: /Codex,In the browser/i }));
    await waitFor(() => expect(mockRequestBrowserLaunch).toHaveBeenCalledWith(expect.objectContaining({ agent: "codex" })));
    expect(mockPersistViewerTerminalAgent).not.toHaveBeenCalled();
  });

  it("footer text is correct and the Switch link is keyboard reachable", () => {
    mockRememberedAgent.mockReturnValue("claude");
    renderBoardButton();
    openBoardMenu();
    expect(screen.getByText(/Default agent:/)).toBeInTheDocument();
    const link = screen.getByRole("menuitem", { name: /Switch to Codex/i });
    expect(link).toBeInTheDocument();
    expect(link.tagName).toBe("DIV");
  });

  it("Switch updates the preference (no launch) and re-renders the primary label", async () => {
    mockRememberedAgent.mockReturnValue("claude");
    mockPersistViewerTerminalAgent.mockImplementation(async (agent) => {
      mockRememberedAgent.mockReturnValue(agent);
      return agent;
    });
    const location = stubLocationAssign();
    renderBoardButton();
    openBoardMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: /Switch to Codex/i }));

    await waitFor(() =>
      expect(mockPersistViewerTerminalAgent).toHaveBeenCalledWith("codex", { source: "footer" })
    );
    expect(location.assign).not.toHaveBeenCalled();
    location.restore();
  });

  it("Switch save failure: shows an error toast and changes nothing", async () => {
    mockRememberedAgent.mockReturnValue("claude");
    mockPersistViewerTerminalAgent.mockRejectedValue(new Error("network"));
    renderBoardButton();
    openBoardMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: /Switch to Codex/i }));

    await waitFor(() =>
      expect(mockPersistViewerTerminalAgent).toHaveBeenCalledWith("codex", { source: "footer" })
    );
    // The mocked hook never actually flips (mockRememberedAgent is untouched
    // by a rejected persist), so the primary label is still Claude Code.
    expect(screen.getByRole("button", { name: /Launch Claude Code/i })).toBeInTheDocument();
  });

  it("Copy launch command is agent-aware; Claude's shell output is byte-for-byte unchanged", async () => {
    mockRememberedAgent.mockReturnValue("claude");
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderBoardButton();
    openBoardMenu();
    expect(screen.getByText("For Claude Code")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: /Copy launch command/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const command = writeText.mock.calls[0][0] as string;
    expect(command).toMatch(/(^|&& )claude /);
    expect(command).not.toContain("codex");
  });

  it("Copy launch command for Codex uses the codex binary", async () => {
    mockRememberedAgent.mockReturnValue("codex");
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderBoardButton();
    openBoardMenu();
    expect(screen.getByText("For Codex")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: /Copy launch command/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const command = writeText.mock.calls[0][0] as string;
    expect(command).toMatch(/(^|&& )codex /);
  });

  it("Install guide is agent-aware with sub-lines and opens in a new tab", () => {
    mockRememberedAgent.mockReturnValue("claude");
    renderBoardButton();
    openBoardMenu();
    expect(screen.getByText("Claude Code docs")).toBeInTheDocument();
    const link = screen.getByRole("menuitem", { name: /Install guide/i });
    expect(link).toHaveAttribute("target", "_blank");

    cleanup();
    mockRememberedAgent.mockReturnValue("codex");
    renderBoardButton();
    openBoardMenu();
    expect(screen.getByText("Codex CLI docs")).toBeInTheDocument();
  });
});

describe("LaunchClaudeCodeButton — mobile task-card menu (variant task-menu-item, !isDesktop) (AC-18)", () => {
  beforeEach(() => {
    mediaMatches.mockReturnValue(false); // phone
  });

  it("shows the explanation line and a working, ≥44px Copy-command item — never a launch", async () => {
    mockRememberedAgent.mockReturnValue("claude");
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const location = stubLocationAssign();
    renderMenuItem();

    expect(screen.getByText("Launching runs on your Mac, so it isn't available here.")).toBeInTheDocument();
    const copyItem = screen.getByRole("menuitem", { name: /Copy Claude Code command for this task/i });
    expect(copyItem.className).toContain("min-h-11");
    expect(screen.getByText("Paste it into Terminal on your Mac")).toBeInTheDocument();

    fireEvent.click(copyItem);
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(location.assign).not.toHaveBeenCalled();
    location.restore();
  });

  it("copies the remembered agent's command (Codex)", () => {
    mockRememberedAgent.mockReturnValue("codex");
    renderMenuItem();
    expect(screen.getByText("Copy Codex command for this task")).toBeInTheDocument();
  });
});
