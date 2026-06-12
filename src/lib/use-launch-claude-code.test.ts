import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// `toast` is callable (the neutral nudge) AND has .error/.success.
const toastFn = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: Object.assign((...a: unknown[]) => toastFn(...a), {
    error: (...a: unknown[]) => toastError(...a),
    success: (...a: unknown[]) => toastSuccess(...a),
  }),
}));

// Capture router.push so we can assert the post-launch board navigation.
const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { useLaunchClaudeCode } from "./use-launch-claude-code";
import { mcpEndpoint } from "./launch-claude-code";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") || "https://vibecodes.co.uk";

// The deep link is fired via a hidden <a>.click() (NOT window.location.assign,
// which would cancel the router.push). Spy on the anchor click + capture the
// raw href it was given (getAttribute, not .href, to avoid jsdom URL mangling).
let clickSpy: ReturnType<typeof vi.spyOn>;
let lastHref: string;
beforeEach(() => {
  vi.useFakeTimers();
  lastHref = "";
  clickSpy = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(function (this: HTMLAnchorElement) {
      lastHref = this.getAttribute("href") ?? "";
    });
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  clickSpy.mockRestore();
  vi.clearAllMocks();
});

describe("useLaunchClaudeCode — launch deep link", () => {
  it("fires a compact claude-cli:// deep link carrying the MCP setup + this idea's board", () => {
    const { result } = renderHook(() =>
      useLaunchClaudeCode({ ideaId: "idea-123", ideaTitle: "Recipe App" })
    );

    act(() => result.current.launch());

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(lastHref.startsWith("claude-cli://open?")).toBe(true);

    const q = decodeURIComponent(lastHref.split("q=")[1].split("&")[0]);
    // MCP auto-setup is always present (this is what connects the user).
    expect(q).toContain(`claude mcp add -s local --transport http vibecodes-remote ${mcpEndpoint(APP_URL)}`);
    // And it picks up THIS idea's board via get_board (not get_my_tasks).
    expect(q).toContain("idea_id idea-123");
    expect(q).toContain("get_board");
    expect(q).toContain("Recipe App");
  });

  it("navigates to this idea's board after firing the deep link", () => {
    const { result } = renderHook(() =>
      useLaunchClaudeCode({ ideaId: "idea-123", ideaTitle: "Recipe App" })
    );

    act(() => result.current.launch());

    expect(clickSpy).toHaveBeenCalledTimes(1); // deep link fired (via anchor, not location.assign)
    expect(pushMock).toHaveBeenCalledWith("/ideas/idea-123/board"); // then routed to the board
  });

  it("does NOT navigate when the browser blocks the scheme (click throws)", () => {
    clickSpy.mockImplementation(() => {
      throw new Error("blocked");
    });
    const { result } = renderHook(() =>
      useLaunchClaudeCode({ ideaId: "idea-1", ideaTitle: "T" })
    );

    act(() => result.current.launch());

    expect(pushMock).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      "Your browser blocked the launch",
      expect.objectContaining({
        action: expect.objectContaining({ label: "Copy command" }),
      })
    );
  });

  it("includes the repo slug when the idea has a github_url", () => {
    const { result } = renderHook(() =>
      useLaunchClaudeCode({
        ideaId: "idea-9",
        ideaTitle: "Repo idea",
        ideaGithubUrl: "https://github.com/acme/widgets",
      })
    );

    act(() => result.current.launch());
    expect(lastHref).toContain("repo=acme%2Fwidgets");
  });

  it("shows the neutral fallback nudge when the scheme race times out (no blur, still focused)", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const { result } = renderHook(() =>
      useLaunchClaudeCode({ ideaId: "idea-1", ideaTitle: "T" })
    );

    act(() => result.current.launch());
    act(() => {
      vi.advanceTimersByTime(1300);
    });
    expect(toastFn).toHaveBeenCalledWith(
      "Opening Claude Code…",
      expect.objectContaining({
        action: expect.objectContaining({ label: "Copy command" }),
      })
    );
  });

  it("does NOT show the fallback nudge when the page hides (handler took over)", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const { result } = renderHook(() =>
      useLaunchClaudeCode({ ideaId: "idea-1", ideaTitle: "T" })
    );

    act(() => result.current.launch());
    act(() => {
      window.dispatchEvent(new Event("blur"));
      vi.advanceTimersByTime(1300);
    });
    expect(toastFn).not.toHaveBeenCalled();
  });

  it("guards against double-launch within the race window", () => {
    const { result } = renderHook(() =>
      useLaunchClaudeCode({ ideaId: "idea-1", ideaTitle: "T" })
    );

    act(() => {
      result.current.launch();
      result.current.launch();
    });
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });
});

describe("useLaunchClaudeCode — copy command", () => {
  it("copies a `claude` launch command containing the (verbose) bootstrap prompt", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() =>
      useLaunchClaudeCode({ ideaId: "idea-77", ideaTitle: "Copy me" })
    );

    await act(async () => {
      await result.current.copyCommand();
    });

    expect(writeText).toHaveBeenCalledTimes(1);
    const cmd = writeText.mock.calls[0][0] as string;
    expect(cmd).toContain("claude ");
    expect(cmd).toContain("idea_id: idea-77");
    expect(toastSuccess).toHaveBeenCalledWith(
      "Launch command copied — paste it in your terminal"
    );
  });
});
