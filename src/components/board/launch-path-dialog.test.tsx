import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

// Radix Dialog uses ResizeObserver, which jsdom lacks (same stub as
// launch-claude-code-button.test.tsx / task-edit-dialog.test.tsx).
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...a: unknown[]) => toastError(...a) },
}));

const mockSaveManualProjectPath = vi.fn();
vi.mock("@/actions/launch-path", () => ({
  saveManualProjectPath: (...args: unknown[]) => mockSaveManualProjectPath(...args),
}));

// The dialog's Save now reads the browser's real machine hostname (rework
// item 1 — getMachineIdentity() was wrongly believed unavailable when this
// feature was investigated) and passes it through to saveManualProjectPath.
// Defaults to null (unknown) here; individual tests override it.
let mockMachineIdentity: string | null = null;
vi.mock("@/lib/terminal/machine-identity", () => ({
  getMachineIdentity: () => mockMachineIdentity,
}));

import { LaunchPathDialog } from "./launch-path-dialog";
import { MANUAL_PIN_HOSTNAME } from "@/lib/launch-claude-code";

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mockMachineIdentity = null;
});

describe("LaunchPathDialog — existing-mode Save writes to the server, not localStorage", () => {
  it("saves through saveManualProjectPath and echoes the recorded row to onSaved", async () => {
    mockSaveManualProjectPath.mockResolvedValue({
      ok: true,
      recorded: { hostname: MANUAL_PIN_HOSTNAME, absolute_path: "/Users/nick/projects/widget" },
    });
    const onSaved = vi.fn();

    render(
      <LaunchPathDialog
        open
        onOpenChange={() => {}}
        ideaId="idea-1"
        ideaGithubUrl={null}
        initial={null}
        onSaved={onSaved}
      />
    );

    fireEvent.change(screen.getByLabelText("Absolute path on your computer"), {
      target: { value: "/Users/nick/projects/widget" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mockSaveManualProjectPath).toHaveBeenCalledWith(
        "idea-1",
        "/Users/nick/projects/widget",
        null
      )
    );
    await waitFor(() =>
      expect(onSaved).toHaveBeenCalledWith(
        { mode: "existing", path: "/Users/nick/projects/widget" },
        { hostname: MANUAL_PIN_HOSTNAME, absolute_path: "/Users/nick/projects/widget" }
      )
    );
  });

  // Rework item 1 — when this browser's real hostname IS known
  // (getMachineIdentity() has a value), Save passes it through so the row
  // lands under the real machine instead of the MANUAL_PIN_HOSTNAME fallback.
  it("passes the real machine hostname through to saveManualProjectPath when known", async () => {
    mockMachineIdentity = "Nicks-MacBook-Pro.local";
    mockSaveManualProjectPath.mockResolvedValue({
      ok: true,
      recorded: { hostname: "Nicks-MacBook-Pro.local", absolute_path: "/Users/nick/projects/widget" },
    });
    const onSaved = vi.fn();

    render(
      <LaunchPathDialog
        open
        onOpenChange={() => {}}
        ideaId="idea-1"
        ideaGithubUrl={null}
        initial={null}
        onSaved={onSaved}
      />
    );

    fireEvent.change(screen.getByLabelText("Absolute path on your computer"), {
      target: { value: "/Users/nick/projects/widget" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mockSaveManualProjectPath).toHaveBeenCalledWith(
        "idea-1",
        "/Users/nick/projects/widget",
        "Nicks-MacBook-Pro.local"
      )
    );
    await waitFor(() =>
      expect(onSaved).toHaveBeenCalledWith(
        { mode: "existing", path: "/Users/nick/projects/widget" },
        { hostname: "Nicks-MacBook-Pro.local", absolute_path: "/Users/nick/projects/widget" }
      )
    );
  });

  it("shows an error toast and does not call onSaved when the server write fails", async () => {
    mockSaveManualProjectPath.mockResolvedValue({ ok: false });
    const onSaved = vi.fn();

    render(
      <LaunchPathDialog
        open
        onOpenChange={() => {}}
        ideaId="idea-1"
        ideaGithubUrl={null}
        initial={null}
        onSaved={onSaved}
      />
    );

    fireEvent.change(screen.getByLabelText("Absolute path on your computer"), {
      target: { value: "/Users/nick/projects/widget" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("blocks Save (never calls the server) for a non-expanded path", () => {
    render(
      <LaunchPathDialog
        open
        onOpenChange={() => {}}
        ideaId="idea-1"
        ideaGithubUrl={null}
        initial={null}
        onSaved={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("Absolute path on your computer"), {
      target: { value: "~/projects/widget" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(mockSaveManualProjectPath).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/fully-expanded absolute path/i);
  });

  // Regression: `/` passes the "is it absolute" check, but recording it would
  // poison every future launch on this machine — the dialog must block it too.
  it("blocks Save (never calls the server) for the filesystem root `/`", () => {
    render(
      <LaunchPathDialog
        open
        onOpenChange={() => {}}
        ideaId="idea-1"
        ideaGithubUrl={null}
        initial={null}
        onSaved={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("Absolute path on your computer"), {
      target: { value: "/" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(mockSaveManualProjectPath).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/not a project folder/i);
  });

  // Create-new mode is untouched by this fix — still localStorage, never the server.
  it("create-new mode never calls saveManualProjectPath", () => {
    const onSaved = vi.fn();
    render(
      <LaunchPathDialog
        open
        onOpenChange={() => {}}
        ideaId="idea-1"
        ideaGithubUrl={null}
        initial={null}
        initialMode="new"
        onSaved={onSaved}
      />
    );

    fireEvent.change(screen.getByLabelText("New folder name"), { target: { value: "my-idea" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(mockSaveManualProjectPath).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "new", name: "my-idea" }),
      undefined
    );
  });
});
