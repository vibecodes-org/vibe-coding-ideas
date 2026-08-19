import { describe, it, expect } from "vitest";
import { isAuthCheckUnavailable } from "./auth-error";

describe("isAuthCheckUnavailable", () => {
  it("is false when there is no error at all (the question was answered: no session)", () => {
    expect(isAuthCheckUnavailable(null)).toBe(false);
    expect(isAuthCheckUnavailable(undefined)).toBe(false);
  });

  it("is false for a genuine missing session", () => {
    expect(
      isAuthCheckUnavailable({ name: "AuthSessionMissingError", status: 400, message: "Auth session missing!" }),
    ).toBe(false);
  });

  it("is false for a rejected/expired token (4xx — answered, and the answer is no)", () => {
    expect(isAuthCheckUnavailable({ name: "AuthApiError", status: 401, message: "invalid JWT" })).toBe(false);
    expect(isAuthCheckUnavailable({ name: "AuthApiError", status: 403, message: "bad_jwt" })).toBe(false);
    expect(
      isAuthCheckUnavailable({ name: "AuthApiError", status: 400, message: "Invalid Refresh Token: Already Used" }),
    ).toBe(false);
  });

  it("is true for a retryable fetch failure by name, whatever status it carries", () => {
    expect(
      isAuthCheckUnavailable({ name: "AuthRetryableFetchError", status: 0, message: "fetch failed" }),
    ).toBe(true);
    expect(
      isAuthCheckUnavailable({ name: "AuthRetryableFetchError", status: 503, message: "unavailable" }),
    ).toBe(true);
  });

  it("is true when the status is missing or zero (a thrown fetch never got a status)", () => {
    expect(isAuthCheckUnavailable({ name: "TypeError", message: "fetch failed" })).toBe(true);
    expect(isAuthCheckUnavailable({ name: "AuthUnknownError", status: 0, message: "write ETIMEDOUT" })).toBe(true);
  });

  it("is true for a 5xx from the auth service", () => {
    expect(isAuthCheckUnavailable({ name: "AuthApiError", status: 500, message: "internal" })).toBe(true);
    expect(isAuthCheckUnavailable({ name: "AuthApiError", status: 502, message: "bad gateway" })).toBe(true);
  });
});
