import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, waitFor, fireEvent } from "@testing-library/react";
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
// jsdom doesn't implement scrollIntoView; the mention dropdown calls it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(HTMLElement.prototype as any).scrollIntoView = () => {};

// Captures every row passed to `.from("notifications").insert(...)` so tests
// can assert which COLUMN a mention notification is written to — the actual
// P0 here (notifications.comment_id is FK'd to `comments`, not
// `board_task_comments`; a mocked Supabase accepts either column name, a
// real one only accepts the right one, see the migration + report).
const notificationInserts: Record<string, unknown>[] = [];

// Minimal chainable query builder that always resolves to an empty comment
// list for reads, and records inserts against "notifications" — this test
// otherwise only cares about the composer's static structure, not comment data.
function createQueryBuilder(table: string) {
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order"]) {
    builder[m] = vi.fn(() => builder);
  }
  builder.insert = vi.fn((row: Record<string, unknown>) => {
    if (table === "notifications") notificationInserts.push(row);
    return builder;
  });
  // Support `await supabase.from(...).select(...).eq(...).order(...)` and
  // `.from(...).insert(...).then(...)` by making the builder itself awaitable.
  (builder as { then: unknown }).then = (resolve: (v: { data: unknown[]; error: null }) => void) =>
    resolve({ data: [], error: null });
  return builder;
}

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (table: string) => createQueryBuilder(table),
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
  createTaskComment: vi.fn(async () => ({ id: "task-comment-1", content: "", created_at: "2026-09-04T00:00:00Z" })),
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

function renderComposer(members: User[] = teamMembers) {
  return render(
    <TooltipProvider>
      <TaskCommentsSection
        taskId="task-1"
        ideaId="idea-1"
        currentUserId="user-1"
        teamMembers={members}
      />
    </TooltipProvider>
  );
}

describe("TaskCommentsSection composer", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    notificationInserts.length = 0;
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

  // P0 regression guard: this write path was silently dropping every
  // task-comment mention notification in production because it wrote
  // board_task_comments.id into `comment_id`, a column FK'd to `comments`
  // (an unrelated table) — the constraint rejected the insert every time,
  // and the failure was swallowed (fire-and-forget). Every mocked-Supabase
  // test before this one passed anyway, because the mock never enforces
  // foreign keys. Asserting the exact column name is the only thing that
  // catches a regression back to the wrong one.
  it("mentioning a teammate writes the notification's task_comment_id (never comment_id)", async () => {
    const nick = {
      id: "nick-1",
      full_name: "Nick Ball",
      notification_preferences: { task_mentions: true },
    } as unknown as User;

    const { container } = renderComposer([nick]);
    await waitFor(() => expect(container.querySelector("form")).toBeInTheDocument());

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "@Nick" } });
    // detectMention needs a cursor position at end of "@Nick" to open the dropdown.
    textarea.setSelectionRange(5, 5);
    fireEvent.change(textarea, { target: { value: "@Nick" } });

    await waitFor(() => {
      expect(container.textContent).toContain("Nick Ball");
    });

    // Select the mention via keyboard (Enter), same as a real user.
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => {
      expect(textarea.value).toContain("@Nick Ball");
    });

    const form = container.querySelector("form") as HTMLFormElement;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(notificationInserts.length).toBeGreaterThan(0);
    });

    const row = notificationInserts[0];
    expect(row).toHaveProperty("task_comment_id", "task-comment-1");
    expect(row).not.toHaveProperty("comment_id");
  });
});
