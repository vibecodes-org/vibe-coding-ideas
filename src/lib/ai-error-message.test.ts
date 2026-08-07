import { describe, it, expect } from "vitest";
import {
  aiErrorMessage,
  AI_TIMEOUT_MESSAGE,
  AI_FALLBACK_MESSAGE,
} from "./ai-error-message";

describe("aiErrorMessage", () => {
  it("maps TimeoutError to the friendly timeout message", () => {
    const err = new Error("The operation was aborted due to timeout");
    err.name = "TimeoutError";
    expect(aiErrorMessage(err)).toBe(AI_TIMEOUT_MESSAGE);
  });

  it("maps AbortError to the friendly timeout message", () => {
    const err = new Error("This operation was aborted");
    err.name = "AbortError";
    expect(aiErrorMessage(err)).toBe(AI_TIMEOUT_MESSAGE);
  });

  it("passes provider/SDK messages through verbatim (the diagnostic gold)", () => {
    expect(
      aiErrorMessage(new Error("Your credit balance is too low to access the Anthropic API."))
    ).toBe("Your credit balance is too low to access the Anthropic API.");
    expect(
      aiErrorMessage(new Error("No object generated: response did not match schema."))
    ).toBe("No object generated: response did not match schema.");
  });

  it("redacts anything matching an Anthropic API key", () => {
    const message = aiErrorMessage(
      new Error("Invalid API key provided: sk-ant-api03-AbC123-xyz. Check your settings.")
    );
    expect(message).not.toContain("sk-ant-");
    expect(message).toContain("[redacted]");
    expect(message).toContain("Invalid API key provided");
  });

  it("caps very long messages at ~300 chars", () => {
    const message = aiErrorMessage(new Error("x".repeat(1000)));
    expect(message.length).toBeLessThanOrEqual(300);
    expect(message.endsWith("…")).toBe(true);
  });

  it("falls back to the generic message for non-Error values", () => {
    expect(aiErrorMessage("string failure")).toBe(AI_FALLBACK_MESSAGE);
    expect(aiErrorMessage(undefined)).toBe(AI_FALLBACK_MESSAGE);
    expect(aiErrorMessage({ message: "not an Error instance" })).toBe(AI_FALLBACK_MESSAGE);
  });

  it("falls back to the generic message for an Error with an empty message", () => {
    expect(aiErrorMessage(new Error("   "))).toBe(AI_FALLBACK_MESSAGE);
  });

  it("never includes a stack trace (only err.message is read)", () => {
    const err = new Error("Something failed");
    expect(aiErrorMessage(err)).toBe("Something failed");
    expect(aiErrorMessage(err)).not.toContain("at ");
  });
});
