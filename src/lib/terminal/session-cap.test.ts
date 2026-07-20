import { describe, it, expect } from "vitest";
import {
  DEFAULT_TERMINAL_SESSION_CAP,
  DEFAULT_TERMINAL_MINT_RATE_LIMIT,
  getTerminalSessionCap,
  getServerTerminalSessionCap,
  getTerminalMintRateLimit,
  newSessionTooltip,
  isCapRefusalMessage,
  capReachedToastCopy,
  capRefusalMessage,
  RATE_LIMIT_MESSAGE,
  CAP_REFUSAL_CODE,
  RATE_LIMIT_CODE,
} from "./session-cap";

describe("getTerminalSessionCap", () => {
  it("defaults to 5 when the env var is unset", () => {
    expect(getTerminalSessionCap(undefined)).toBe(5);
    expect(DEFAULT_TERMINAL_SESSION_CAP).toBe(5);
  });

  it("uses a positive integer override verbatim", () => {
    expect(getTerminalSessionCap("3")).toBe(3);
    expect(getTerminalSessionCap("10")).toBe(10);
  });

  it("falls back to the default for zero, negative, or non-numeric values", () => {
    expect(getTerminalSessionCap("0")).toBe(DEFAULT_TERMINAL_SESSION_CAP);
    expect(getTerminalSessionCap("-1")).toBe(DEFAULT_TERMINAL_SESSION_CAP);
    expect(getTerminalSessionCap("abc")).toBe(DEFAULT_TERMINAL_SESSION_CAP);
    expect(getTerminalSessionCap("")).toBe(DEFAULT_TERMINAL_SESSION_CAP);
    expect(getTerminalSessionCap("3.5")).toBe(DEFAULT_TERMINAL_SESSION_CAP);
  });

  it("tolerates surrounding whitespace", () => {
    expect(getTerminalSessionCap("  7  ")).toBe(7);
  });
});

describe("newSessionTooltip", () => {
  it("templates the configured cap into the honesty copy", () => {
    expect(newSessionTooltip(5)).toBe(
      "New terminal — runs on your computer. Each session uses real resources. Up to 5 at once.",
    );
    expect(newSessionTooltip(3)).toContain("Up to 3 at once.");
  });

  it("defaults to the resolved env cap when called with no argument", () => {
    expect(newSessionTooltip()).toContain(`Up to ${DEFAULT_TERMINAL_SESSION_CAP} at once.`);
  });
});

describe("isCapRefusalMessage", () => {
  it("recognises the documented refusal shapes", () => {
    expect(isCapRefusalMessage("You already have 5 terminals running")).toBe(true);
    expect(isCapRefusalMessage("You already have 3 terminal running")).toBe(true);
    expect(isCapRefusalMessage("Terminal session cap reached")).toBe(true);
    expect(isCapRefusalMessage("Too many active terminal sessions")).toBe(true);
  });

  it("does not misclassify unrelated failures", () => {
    expect(isCapRefusalMessage("Not authenticated")).toBe(false);
    expect(isCapRefusalMessage("Idea not found")).toBe(false);
    expect(isCapRefusalMessage(undefined)).toBe(false);
    expect(isCapRefusalMessage(null)).toBe(false);
    expect(isCapRefusalMessage("")).toBe(false);
  });
});

describe("capReachedToastCopy", () => {
  it("templates the cap number into the title, never hardcoding it", () => {
    expect(capReachedToastCopy(5)).toEqual({
      title: "You already have 5 terminals running",
      description: "That's the limit for now. End one to start another.",
    });
    expect(capReachedToastCopy(3).title).toBe("You already have 3 terminals running");
  });
});

describe("getServerTerminalSessionCap", () => {
  it("reads a SEPARATE env var from the client cap, same default", () => {
    expect(getServerTerminalSessionCap(undefined)).toBe(DEFAULT_TERMINAL_SESSION_CAP);
    expect(getServerTerminalSessionCap("2")).toBe(2);
    expect(getServerTerminalSessionCap("0")).toBe(DEFAULT_TERMINAL_SESSION_CAP);
    expect(getServerTerminalSessionCap("nope")).toBe(DEFAULT_TERMINAL_SESSION_CAP);
  });
});

describe("getTerminalMintRateLimit", () => {
  it("defaults to 10 and tolerates the same malformed inputs as the cap", () => {
    expect(getTerminalMintRateLimit(undefined)).toBe(10);
    expect(DEFAULT_TERMINAL_MINT_RATE_LIMIT).toBe(10);
    expect(getTerminalMintRateLimit("4")).toBe(4);
    expect(getTerminalMintRateLimit("-3")).toBe(DEFAULT_TERMINAL_MINT_RATE_LIMIT);
    expect(getTerminalMintRateLimit("junk")).toBe(DEFAULT_TERMINAL_MINT_RATE_LIMIT);
  });
});

describe("capRefusalMessage", () => {
  it("templates the cap and pluralises correctly, matching the design copy", () => {
    expect(capRefusalMessage(5)).toBe(
      "You already have 5 terminals running — end one to start another.",
    );
    expect(capRefusalMessage(1)).toBe(
      "You already have 1 terminal running — end one to start another.",
    );
  });

  it("is recognised by isCapRefusalMessage", () => {
    expect(isCapRefusalMessage(capRefusalMessage(5))).toBe(true);
  });
});

describe("rate-limit copy stays distinct from the cap refusal (binding note)", () => {
  it("never mentions ending a session", () => {
    expect(RATE_LIMIT_MESSAGE.toLowerCase()).not.toContain("end");
    expect(RATE_LIMIT_MESSAGE).toBe("You're starting terminals too fast — wait a moment and try again.");
  });

  it("is never misclassified as a cap refusal", () => {
    expect(isCapRefusalMessage(RATE_LIMIT_MESSAGE)).toBe(false);
  });
});

describe("error codes", () => {
  it("are the exact strings the client branches on", () => {
    expect(CAP_REFUSAL_CODE).toBe("cap_exceeded");
    expect(RATE_LIMIT_CODE).toBe("rate_limited");
  });
});
