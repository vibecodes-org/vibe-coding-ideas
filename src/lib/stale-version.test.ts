import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockToast } = vi.hoisted(() => {
  const fn = vi.fn() as ReturnType<typeof vi.fn> & { error: ReturnType<typeof vi.fn> };
  fn.error = vi.fn();
  return { mockToast: fn };
});
vi.mock("sonner", () => ({ toast: mockToast }));

import { UnrecognizedActionError } from "next/dist/client/components/unrecognized-action-error";
import {
  isStaleVersionError,
  toastActionError,
  STALE_VERSION_MESSAGE,
  STALE_VERSION_TOAST_ID,
} from "./stale-version";

describe("isStaleVersionError", () => {
  it("recognises Next's unrecognized-action error", () => {
    expect(isStaleVersionError(new UnrecognizedActionError("x"))).toBe(true);
  });

  it("recognises the message when the class check can't be used", () => {
    const err = new Error(
      'Server Action "003c95" was not found on the server. \nRead more: https://nextjs.org/docs/messages/failed-to-find-server-action'
    );
    expect(isStaleVersionError(err)).toBe(true);
  });

  it("ignores ordinary failures", () => {
    expect(isStaleVersionError(new Error("Not authenticated"))).toBe(false);
    expect(isStaleVersionError(new TypeError("Failed to fetch"))).toBe(false);
    expect(isStaleVersionError(undefined)).toBe(false);
    expect(isStaleVersionError("oops")).toBe(false);
  });
});

describe("toastActionError", () => {
  beforeEach(() => mockToast.error.mockReset());

  it("shows one persistent refresh toast for a stale tab", () => {
    expect(toastActionError(new UnrecognizedActionError("x"), "Failed to move task")).toBe(true);
    expect(mockToast.error).toHaveBeenCalledWith(
      STALE_VERSION_MESSAGE,
      expect.objectContaining({
        id: STALE_VERSION_TOAST_ID,
        duration: Infinity,
        action: expect.objectContaining({ label: "Refresh" }),
      })
    );
  });

  it("falls back to the caller's message otherwise", () => {
    expect(toastActionError(new Error("boom"), "Failed to move task")).toBe(false);
    expect(mockToast.error).toHaveBeenCalledWith("Failed to move task");
  });
});
