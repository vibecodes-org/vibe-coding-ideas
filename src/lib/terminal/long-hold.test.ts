import { describe, it, expect } from "vitest";
import {
  supportsLongHold,
  reconnectBackoffMs,
  shouldShowLongWait,
  LONG_WAIT_NOTICE_MS,
} from "./connection";
import { reconnectCopy } from "./reconnect-copy";

describe("supportsLongHold (card f4be2981)", () => {
  it("is true from 0.3.34 up and false for older, missing or malformed versions", () => {
    expect(supportsLongHold("0.3.34")).toBe(true);
    expect(supportsLongHold("0.3.40")).toBe(true);
    expect(supportsLongHold("1.0.0")).toBe(true);
    expect(supportsLongHold("0.3.33")).toBe(false);
    expect(supportsLongHold(null)).toBe(false);
    expect(supportsLongHold(undefined)).toBe(false);
    expect(supportsLongHold("garbage")).toBe(false);
  });
});

describe("reconnectBackoffMs", () => {
  const zero = () => 0;
  it("caps at 8s for old helpers and 30s for long-hold ones", () => {
    expect(reconnectBackoffMs(10, false, zero)).toBe(8000);
    expect(reconnectBackoffMs(10, true, zero)).toBe(30_000);
    expect(reconnectBackoffMs(0, true, zero)).toBe(1000);
    expect(reconnectBackoffMs(3, true, zero)).toBe(8000);
  });
});

describe("shouldShowLongWait", () => {
  const base = { waitingSince: 0, now: LONG_WAIT_NOTICE_MS + 1, visible: true, online: true, browserLinkUp: true };
  it("shows after 3 minutes of waiting with the page visible and our own link up", () => {
    expect(shouldShowLongWait(base)).toBe(true);
  });
  it("does not show before 3 minutes, or when not waiting", () => {
    expect(shouldShowLongWait({ ...base, now: LONG_WAIT_NOTICE_MS })).toBe(false);
    expect(shouldShowLongWait({ ...base, waitingSince: null })).toBe(false);
  });
  it("does not show when hidden, offline, or the browser's own link is down", () => {
    expect(shouldShowLongWait({ ...base, visible: false })).toBe(false);
    expect(shouldShowLongWait({ ...base, online: false })).toBe(false);
    expect(shouldShowLongWait({ ...base, browserLinkUp: false })).toBe(false);
  });
});

describe("reconnectCopy", () => {
  it("normal wording keeps the session promise and offers Reconnect now only", () => {
    const c = reconnectCopy(false);
    expect(c.text).toMatch(/kept/i);
    expect(c.showEndSession).toBe(false);
  });
  it("long-wait wording says still waiting and offers End session", () => {
    const c = reconnectCopy(true);
    expect(c.title).toMatch(/Still waiting for your Mac/);
    expect(c.showEndSession).toBe(true);
  });
});
