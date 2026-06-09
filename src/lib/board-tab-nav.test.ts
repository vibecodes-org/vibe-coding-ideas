import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { switchBoardTab } from "./board-tab-nav";

describe("switchBoardTab", () => {
  let pushStateSpy: ReturnType<typeof vi.spyOn>;
  let dispatchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // jsdom provides history + location; start from a clean board URL.
    window.history.pushState(null, "", "/ideas/abc/board");
    pushStateSpy = vi.spyOn(window.history, "pushState");
    dispatchSpy = vi.spyOn(window, "dispatchEvent");
  });

  afterEach(() => {
    pushStateSpy.mockRestore();
    dispatchSpy.mockRestore();
  });

  it("pushes ?tab=workflows and dispatches a popstate event", () => {
    switchBoardTab("workflows");

    expect(pushStateSpy).toHaveBeenCalledTimes(1);
    const url = pushStateSpy.mock.calls[0][2] as string;
    expect(url).toContain("tab=workflows");

    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    const event = dispatchSpy.mock.calls[0][0] as Event;
    expect(event).toBeInstanceOf(PopStateEvent);
    expect(event.type).toBe("popstate");
  });

  it("pushes ?tab=agents for the agents tab", () => {
    switchBoardTab("agents");

    const url = pushStateSpy.mock.calls[0][2] as string;
    expect(url).toContain("tab=agents");
  });

  it("removes the tab param entirely when switching back to board", () => {
    window.history.pushState(null, "", "/ideas/abc/board?tab=workflows");
    pushStateSpy.mockClear();

    switchBoardTab("board");

    const url = pushStateSpy.mock.calls[0][2] as string;
    expect(url).not.toContain("tab=");
    // Still dispatches so the listener re-syncs to the board tab.
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
  });
});
