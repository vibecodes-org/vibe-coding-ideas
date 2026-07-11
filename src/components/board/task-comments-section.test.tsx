import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { User } from "@/types";

// Radix primitives use ResizeObserver, which jsdom lacks.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).ResizeObserver = ResizeObserverStub;

// Minimal chainable query builder that always resolves to an empty comment
// list — this test only cares about the composer's static structure, not
// comment data.
function createQueryBuilder() {
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order"]) {
    builder[m] = vi.fn(() => builder);
  }
  // Support `await supabase.from(...).select(...).eq(...).order(...)`
  // (a thenable) by making the builder itself awaitable.
  (builder as { then: unknown }).then = (resolve: (v: { data: unknown[] }) => void) =>
    resolve({ data: [] });
  return builder;
}

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => createQueryBuilder(),
    channel: () => {
      const ch: Record<string, unknown> = {};
      ch.on = vi.fn(() => ch);
      ch.subscribe = vi.fn(() => ch);
      ch.unsubscribe = vi.fn();
      return ch;
    },
  }),
}));

vi.mock("@/actions/board", () => ({
  createTaskComment: vi.fn(),
  deleteTaskComment: vi.fn(),
  updateTaskComment: vi.fn(),
}));

vi.mock("@/lib/activity", () => ({
  logTaskActivity: vi.fn(),
}));

vi.mock("@/lib/undo-toast", () => ({
  undoableAction: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

// Must import after mocks are set up
import { TaskCommentsSection } from "./task-comments-section";

const teamMembers: User[] = [];

function renderComposer() {
  return render(
    <TooltipProvider>
      <TaskCommentsSection
        taskId="task-1"
        ideaId="idea-1"
        currentUserId="user-1"
        teamMembers={teamMembers}
      />
    </TooltipProvider>
  );
}

describe("TaskCommentsSection composer", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // Regression guard for a bug where pasting a long comment grew the
  // textarea unbounded (field-sizing-content, no max-height) while the
  // Send button — top-aligned in the flex row — scrolled out of view
  // inside the Comments tab's overflow-y-auto container.
  it("bottom-aligns the composer row and caps the textarea height so the Send button stays reachable", async () => {
    const { container } = renderComposer();

    await waitFor(() => {
      expect(container.querySelector("form")).toBeInTheDocument();
    });

    const form = container.querySelector("form");
    expect(form).not.toBeNull();
    expect(form!.className).toContain("items-end");

    const textarea = container.querySelector("textarea");
    expect(textarea).not.toBeNull();
    expect(textarea!.className).toContain("max-h-40");
  });
});
