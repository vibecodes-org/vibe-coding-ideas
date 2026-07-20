import { describe, it, expect } from "vitest";
import {
  popoutChannelName,
  generatePopoutNonce,
  parsePopoutChannelMessage,
  reduceDockHandshake,
  INITIAL_DOCK_HANDSHAKE_STATE,
  isPreemptedClose,
  hasPopoutHandoffTimedOut,
  POPOUT_HANDOFF_TIMEOUT_MS,
  type PopoutPayload,
} from "./popout-channel";
import { RELAY_CLOSE } from "./connection";

const PAYLOAD: PopoutPayload = {
  sid: "sid-123",
  browserToken: "tok-abc",
  relayUrl: "wss://relay.example",
  ideaId: "idea-1",
  ideaTitle: "Recipe Saver",
  label: "Add pagination to the recipe list",
  identity: "Recipe Saver · session sid-123",
  readOnly: false,
};

describe("popoutChannelName", () => {
  it("namespaces the nonce so it can't collide with anything else on the origin", () => {
    expect(popoutChannelName("abc123")).toBe("vibecodes:terminal-popout:abc123");
  });
});

describe("generatePopoutNonce", () => {
  it("returns a non-empty, URL-hash-safe string", () => {
    const nonce = generatePopoutNonce();
    expect(nonce.length).toBeGreaterThan(8);
    expect(nonce).toMatch(/^[a-z0-9]+$/i);
  });

  it("never repeats across calls", () => {
    const seen = new Set(Array.from({ length: 50 }, () => generatePopoutNonce()));
    expect(seen.size).toBe(50);
  });
});

describe("parsePopoutChannelMessage", () => {
  it("parses a ready message", () => {
    expect(parsePopoutChannelMessage({ type: "ready" })).toEqual({ type: "ready" });
  });

  it("parses a closed message", () => {
    expect(parsePopoutChannelMessage({ type: "closed" })).toEqual({ type: "closed" });
  });

  it("parses a well-formed payload message", () => {
    expect(parsePopoutChannelMessage({ type: "payload", payload: PAYLOAD })).toEqual({
      type: "payload",
      payload: PAYLOAD,
    });
  });

  it("rejects a payload message missing a required field", () => {
    const { sid: _sid, ...rest } = PAYLOAD;
    expect(parsePopoutChannelMessage({ type: "payload", payload: rest })).toBeNull();
  });

  it("rejects a payload message with the wrong type for readOnly", () => {
    expect(
      parsePopoutChannelMessage({ type: "payload", payload: { ...PAYLOAD, readOnly: "false" } }),
    ).toBeNull();
  });

  it.each([undefined, null, 42, "hello", [], { type: "unknown" }, { no_type: true }])(
    "returns null for garbage input %#",
    (input) => {
      expect(parsePopoutChannelMessage(input)).toBeNull();
    },
  );
});

describe("reduceDockHandshake", () => {
  it("sends the payload on the first ready message", () => {
    const result = reduceDockHandshake(INITIAL_DOCK_HANDSHAKE_STATE, { type: "ready" });
    expect(result).toEqual({ state: "payload-sent", action: "send-payload" });
  });

  it("ignores a repeated ready once the payload has already been sent (retry-safe)", () => {
    const result = reduceDockHandshake("payload-sent", { type: "ready" });
    expect(result).toEqual({ state: "payload-sent", action: "none" });
  });

  it("always reattaches on a closed message, regardless of handshake phase", () => {
    expect(reduceDockHandshake("waiting-for-ready", { type: "closed" })).toEqual({
      state: "waiting-for-ready",
      action: "reattach",
    });
    expect(reduceDockHandshake("payload-sent", { type: "closed" })).toEqual({
      state: "payload-sent",
      action: "reattach",
    });
  });

  it("ignores a stray payload message on the dock's own channel", () => {
    const result = reduceDockHandshake(INITIAL_DOCK_HANDSHAKE_STATE, {
      type: "payload",
      payload: PAYLOAD,
    });
    expect(result).toEqual({ state: INITIAL_DOCK_HANDSHAKE_STATE, action: "none" });
  });
});

describe("isPreemptedClose", () => {
  it("is true only for the relay's DUP_BROWSER close code", () => {
    expect(isPreemptedClose(RELAY_CLOSE.DUP_BROWSER)).toBe(true);
    expect(RELAY_CLOSE.DUP_BROWSER).toBe(4001);
  });

  it("is false for every other close code, including the sibling DUP_BRIDGE", () => {
    expect(isPreemptedClose(RELAY_CLOSE.DUP_BRIDGE)).toBe(false);
    expect(isPreemptedClose(1000)).toBe(false);
    expect(isPreemptedClose(1006)).toBe(false);
    expect(isPreemptedClose(null)).toBe(false);
  });
});

describe("hasPopoutHandoffTimedOut", () => {
  it("is false before the timeout elapses", () => {
    expect(hasPopoutHandoffTimedOut(1000, 1000 + POPOUT_HANDOFF_TIMEOUT_MS - 1)).toBe(false);
  });

  it("is true once the timeout elapses (inclusive boundary)", () => {
    expect(hasPopoutHandoffTimedOut(1000, 1000 + POPOUT_HANDOFF_TIMEOUT_MS)).toBe(true);
  });

  it("is true well past the timeout", () => {
    expect(hasPopoutHandoffTimedOut(1000, 1000 + POPOUT_HANDOFF_TIMEOUT_MS * 3)).toBe(true);
  });

  it("supports a custom timeout", () => {
    expect(hasPopoutHandoffTimedOut(0, 500, 1000)).toBe(false);
    expect(hasPopoutHandoffTimedOut(0, 1000, 1000)).toBe(true);
  });
});
