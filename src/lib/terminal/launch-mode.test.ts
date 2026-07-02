import { describe, it, expect, vi } from "vitest";
import {
  type BrowserLaunchPayload,
  launchModeOptions,
  isBrowserLaunchAvailable,
  requestBrowserLaunch,
  subscribeBrowserLaunch,
} from "./launch-mode";

describe("launchModeOptions", () => {
  it("flag OFF → only the terminal-window mode (in-browser item not rendered)", () => {
    expect(launchModeOptions(false)).toEqual(["terminal-window"]);
    expect(isBrowserLaunchAvailable(false)).toBe(false);
  });

  it("flag ON → terminal-window (default, first) then browser", () => {
    const opts = launchModeOptions(true);
    expect(opts).toEqual(["terminal-window", "browser"]);
    // terminal-window is always present and always first — the existing default
    // action is never moved or removed by enabling the flag.
    expect(opts[0]).toBe("terminal-window");
    expect(isBrowserLaunchAvailable(true)).toBe(true);
  });
});

describe("launch bus payload (bootstrap-prompt transport)", () => {
  it("delivers the compact-prompt parts AND the launch cwd from the button to the dock", () => {
    const handler = vi.fn<(payload?: BrowserLaunchPayload) => void>();
    const unsubscribe = subscribeBrowserLaunch(handler);
    const payload: BrowserLaunchPayload = {
      promptHead: "Set up VibeCodes…\n\n1. connect\n",
      promptTail: "2. work the task",
      cwd: "/Users/me/projects/my-idea",
    };
    requestBrowserLaunch(payload);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(payload);
    unsubscribe();
  });

  it("cwd is optional — a payload without one arrives without one", () => {
    const handler = vi.fn<(payload?: BrowserLaunchPayload) => void>();
    const unsubscribe = subscribeBrowserLaunch(handler);
    requestBrowserLaunch({ promptHead: "h", promptTail: "t" });
    expect(handler).toHaveBeenCalledWith({ promptHead: "h", promptTail: "t" });
    expect(handler.mock.calls[0][0]?.cwd).toBeUndefined();
    unsubscribe();
  });

  it("a payload-less request still fires, with an undefined payload (dock builds its own prompt)", () => {
    const handler = vi.fn<(payload?: BrowserLaunchPayload) => void>();
    const unsubscribe = subscribeBrowserLaunch(handler);
    requestBrowserLaunch();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(undefined);
    unsubscribe();
  });

  it("unsubscribe stops delivery", () => {
    const handler = vi.fn();
    const unsubscribe = subscribeBrowserLaunch(handler);
    unsubscribe();
    requestBrowserLaunch({ promptHead: "h", promptTail: "t" });
    expect(handler).not.toHaveBeenCalled();
  });
});
