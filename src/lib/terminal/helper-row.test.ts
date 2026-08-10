import { describe, it, expect, afterEach, vi } from "vitest";
import {
  deriveHelperChip,
  fetchHelperStatus,
  shouldShowStopButton,
  stopButtonLabel,
  stopConfirmBody,
  updateNudgeCopy,
  formatHelperEventAge,
  type HelperStatus,
} from "./helper-row";

function status(overrides: Partial<HelperStatus> = {}): HelperStatus {
  return {
    connected: false,
    version: null,
    machineLabel: null,
    alwaysOn: false,
    stoppedUnexpectedly: false,
    lastEventAt: null,
    ...overrides,
  };
}

describe("deriveHelperChip", () => {
  it("null status (still loading) -> null chip", () => {
    expect(deriveHelperChip(null, 0)).toBeNull();
  });

  it("connected + sessions running -> running", () => {
    const chip = deriveHelperChip(status({ connected: true }), 2);
    expect(chip).toEqual({
      kind: "running",
      label: "Helper running",
      subline: "The small app that connects terminals to this Mac.",
    });
  });

  it("connected + zero sessions -> winding-down (the linger window)", () => {
    const chip = deriveHelperChip(status({ connected: true }), 0);
    expect(chip?.kind).toBe("winding-down");
    expect(chip?.label).toBe("Winding down");
  });

  it("not connected, never flagged unclean -> not-running", () => {
    const chip = deriveHelperChip(status({ connected: false, stoppedUnexpectedly: false }), 0);
    expect(chip?.kind).toBe("not-running");
  });

  it("not connected + stoppedUnexpectedly -> stopped-unexpectedly, regardless of session count", () => {
    const chip = deriveHelperChip(status({ connected: false, stoppedUnexpectedly: true }), 3);
    expect(chip?.kind).toBe("stopped-unexpectedly");
    expect(chip?.label).toBe("Stopped unexpectedly");
  });
});

describe("shouldShowStopButton / stopButtonLabel", () => {
  it("shows Stop while running", () => {
    const chip = deriveHelperChip(status({ connected: true }), 1);
    expect(shouldShowStopButton(chip)).toBe(true);
    expect(stopButtonLabel(chip)).toBe("Stop");
  });

  it("shows 'Stop now' while winding down", () => {
    const chip = deriveHelperChip(status({ connected: true }), 0);
    expect(shouldShowStopButton(chip)).toBe(true);
    expect(stopButtonLabel(chip)).toBe("Stop now");
  });

  it("hides the Stop button once the helper isn't connected", () => {
    const notRunning = deriveHelperChip(status({ connected: false }), 0);
    const crashed = deriveHelperChip(status({ connected: false, stoppedUnexpectedly: true }), 0);
    expect(shouldShowStopButton(notRunning)).toBe(false);
    expect(shouldShowStopButton(crashed)).toBe(false);
  });

  it("a null chip (loading) never shows Stop", () => {
    expect(shouldShowStopButton(null)).toBe(false);
  });
});

describe("copy strings", () => {
  it("stopConfirmBody pluralizes correctly", () => {
    expect(stopConfirmBody(1)).toBe(
      "This ends your 1 session. Claude stops on your machine — your files and unpushed changes stay on disk.",
    );
    expect(stopConfirmBody(2)).toBe(
      "This ends your 2 sessions. Claude stops on your machine — your files and unpushed changes stay on disk.",
    );
  });

  it("updateNudgeCopy interpolates the reported version", () => {
    expect(updateNudgeCopy("0.3.0")).toBe("A newer terminal helper is available (v0.3.0).");
  });
});

describe("fetchHelperStatus", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves the parsed status on a 2xx response", async () => {
    const body = status({ connected: true, version: "0.3.2" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => body }),
    );
    await expect(fetchHelperStatus()).resolves.toEqual(body);
    expect(fetch).toHaveBeenCalledWith("/api/terminal/helper/status");
  });

  it("resolves null on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    await expect(fetchHelperStatus()).resolves.toBeNull();
  });

  it("resolves null when the fetch itself throws (network error / relay unreachable)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    await expect(fetchHelperStatus()).resolves.toBeNull();
  });

  it("resolves null when the response body isn't valid JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          throw new SyntaxError("Unexpected token");
        },
      }),
    );
    await expect(fetchHelperStatus()).resolves.toBeNull();
  });
});

describe("formatHelperEventAge", () => {
  const NOW = 1_700_000_000_000;

  it("under a minute -> 'just now'", () => {
    expect(formatHelperEventAge(NOW - 30_000, NOW)).toBe("just now");
  });

  it("minutes -> 'Nm ago'", () => {
    expect(formatHelperEventAge(NOW - 5 * 60_000, NOW)).toBe("5m ago");
  });

  it("hours -> 'Nh ago'", () => {
    expect(formatHelperEventAge(NOW - 3 * 60 * 60_000, NOW)).toBe("3h ago");
  });

  it("a future timestamp (clock skew) clamps to 'just now', never negative", () => {
    expect(formatHelperEventAge(NOW + 10_000, NOW)).toBe("just now");
  });
});
