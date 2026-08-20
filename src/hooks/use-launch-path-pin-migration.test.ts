import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

// jsdom in this project doesn't expose window.localStorage by default.
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      store = {};
    },
  };
})();
Object.defineProperty(window, "localStorage", { value: localStorageMock, configurable: true });

const mockMigrate = vi.fn();
vi.mock("@/actions/launch-path", () => ({
  migrateLaunchPathPin: (...args: unknown[]) => mockMigrate(...args),
}));

vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { useLaunchPathPinMigration } from "./use-launch-path-pin-migration";
import { launchPathKey, readLaunchPath } from "@/lib/launch-claude-code";
import { MACHINE_IDENTITY_KEY } from "@/lib/terminal/machine-identity";

const IDEA_ID = "idea-1";

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe("useLaunchPathPinMigration", () => {
  // no-pin-unchanged
  it("no pin on file: never calls the migration action", async () => {
    renderHook(() => useLaunchPathPinMigration(IDEA_ID));
    // Give any stray microtask a chance to run, then assert nothing fired.
    await Promise.resolve();
    expect(mockMigrate).not.toHaveBeenCalled();
  });

  // create-new unchanged: a mode:"new" pin is never migrated (it stays local)
  it("a create-new (mode: new) pin is left untouched — never migrated", async () => {
    window.localStorage.setItem(
      launchPathKey(IDEA_ID),
      JSON.stringify({ mode: "new", path: "~/projects/x", parent: "~/projects", name: "x" })
    );
    renderHook(() => useLaunchPathPinMigration(IDEA_ID));
    await Promise.resolve();
    expect(mockMigrate).not.toHaveBeenCalled();
    // Still there — nothing cleared it.
    expect(readLaunchPath(IDEA_ID)).toMatchObject({ mode: "new" });
  });

  // pin-exists-and-migrates. getMachineIdentity() reads the SAME window.localStorage
  // mock this suite stubs, and nothing has ever set MACHINE_IDENTITY_KEY here,
  // so it's genuinely null (an honest "we don't know yet") — the migration call
  // must reflect that rather than silently omitting the argument.
  it("an existing-mode pin migrates (hostname unknown) and is then cleared from localStorage", async () => {
    mockMigrate.mockResolvedValue({ ok: true, action: "insert" });
    window.localStorage.setItem(
      launchPathKey(IDEA_ID),
      JSON.stringify({ mode: "existing", path: "/Users/nick/projects/widget" })
    );

    renderHook(() => useLaunchPathPinMigration(IDEA_ID));

    expect(mockMigrate).toHaveBeenCalledWith(IDEA_ID, "/Users/nick/projects/widget", null);
    await waitFor(() => expect(readLaunchPath(IDEA_ID)).toBeNull());
  });

  // Rework item 1 — when a terminal session has already announced this
  // browser's real hostname (machine-identity.ts, set from the SAME
  // window.localStorage this suite stubs), the migration passes it through
  // instead of leaving the server action to fall back to MANUAL_PIN_HOSTNAME.
  it("an existing-mode pin migrates WITH the real machine hostname when known", async () => {
    mockMigrate.mockResolvedValue({ ok: true, action: "insert" });
    window.localStorage.setItem(MACHINE_IDENTITY_KEY, "Nicks-MacBook-Pro.local");
    window.localStorage.setItem(
      launchPathKey(IDEA_ID),
      JSON.stringify({ mode: "existing", path: "/Users/nick/projects/widget" })
    );

    renderHook(() => useLaunchPathPinMigration(IDEA_ID));

    expect(mockMigrate).toHaveBeenCalledWith(
      IDEA_ID,
      "/Users/nick/projects/widget",
      "Nicks-MacBook-Pro.local"
    );
    await waitFor(() => expect(readLaunchPath(IDEA_ID)).toBeNull());
  });

  it("leaves the pin in place on migration failure, so the next load retries", async () => {
    mockMigrate.mockResolvedValue({ ok: false, action: "error" });
    window.localStorage.setItem(
      launchPathKey(IDEA_ID),
      JSON.stringify({ mode: "existing", path: "/Users/nick/projects/widget" })
    );

    renderHook(() => useLaunchPathPinMigration(IDEA_ID));

    await waitFor(() => expect(mockMigrate).toHaveBeenCalledTimes(1));
    expect(readLaunchPath(IDEA_ID)).toMatchObject({ path: "/Users/nick/projects/widget" });
  });

  // Regression coverage for the data-loss defect this rework fixes: `skip`
  // comes back `ok: true` (nothing "failed"), but decidePinMigration's >1-rows
  // branch writes NOTHING server-side — so unlike every other `ok: true`
  // action, the pin is the only surviving record of the folder and must NOT
  // be cleared. Paired with the insert/update cases below so the "cleared vs
  // kept" split can't silently regress in either direction.
  it("skip action: nothing was written server-side, so the pin survives", async () => {
    mockMigrate.mockResolvedValue({ ok: true, action: "skip" });
    window.localStorage.setItem(
      launchPathKey(IDEA_ID),
      JSON.stringify({ mode: "existing", path: "/Users/nick/projects/widget" })
    );

    renderHook(() => useLaunchPathPinMigration(IDEA_ID));

    await waitFor(() => expect(mockMigrate).toHaveBeenCalledTimes(1));
    expect(readLaunchPath(IDEA_ID)).toMatchObject({ path: "/Users/nick/projects/widget" });
  });

  it("insert action: something was written server-side, so the pin is cleared", async () => {
    mockMigrate.mockResolvedValue({ ok: true, action: "insert" });
    window.localStorage.setItem(
      launchPathKey(IDEA_ID),
      JSON.stringify({ mode: "existing", path: "/Users/nick/projects/widget" })
    );

    renderHook(() => useLaunchPathPinMigration(IDEA_ID));

    await waitFor(() => expect(readLaunchPath(IDEA_ID)).toBeNull());
  });

  it("update action: something was written server-side, so the pin is cleared", async () => {
    mockMigrate.mockResolvedValue({ ok: true, action: "update" });
    window.localStorage.setItem(
      launchPathKey(IDEA_ID),
      JSON.stringify({ mode: "existing", path: "/Users/nick/projects/widget" })
    );

    renderHook(() => useLaunchPathPinMigration(IDEA_ID));

    await waitFor(() => expect(readLaunchPath(IDEA_ID)).toBeNull());
  });

  // Micro-fix: readLaunchPath doesn't validate what it reads back, so a
  // corrupted/hand-edited pin (relative path here) would otherwise reach
  // migrateLaunchPathPin, get rejected as action:"invalid" -> ok:false, and
  // then — under the old "only clear on ok" logic — never be cleared, retrying
  // and warn-logging on every board load forever. It must be dropped
  // immediately instead, without even calling the migration action.
  it("an invalid pin (fails isValidAbsolutePath) is discarded immediately, without calling migrate", async () => {
    window.localStorage.setItem(
      launchPathKey(IDEA_ID),
      JSON.stringify({ mode: "existing", path: "not/an/absolute/path" })
    );

    renderHook(() => useLaunchPathPinMigration(IDEA_ID));
    await waitFor(() => expect(readLaunchPath(IDEA_ID)).toBeNull());
    expect(mockMigrate).not.toHaveBeenCalled();
  });
});
