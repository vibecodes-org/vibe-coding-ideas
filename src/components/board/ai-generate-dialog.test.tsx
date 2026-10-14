import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));

vi.mock("@/components/ai/prompt-template-selector", () => ({
  PromptTemplateSelector: () => <div data-testid="template-selector" />,
}));

import { AiGenerateDialog } from "./ai-generate-dialog";
import { toast } from "sonner";
import type { BoardColumnWithTasks } from "@/types";

type Task = { title: string; columnName?: string; labels?: string[] };

const A: Task = { title: "Task A", columnName: "To Do" };
const B: Task = { title: "Task B", columnName: "To Do" };
const C: Task = { title: "Task C", columnName: "To Do" };
const D: Task = { title: "Task D", columnName: "To Do" };

const columns = [
  { id: "col-1", title: "To Do", position: 1000, is_done_column: false, tasks: [] },
] as unknown as BoardColumnWithTasks[];

function ndjson(...objs: unknown[]) {
  return objs.map((o) => JSON.stringify(o)).join("\n") + "\n";
}

function okResponse(body: string) {
  return new Response(body, { status: 200 });
}

/** A body that delivers `body`, then throws (a dropped connection). */
function droppedResponse(body: string) {
  const encoder = new TextEncoder();
  let sent = false;
  const stream = new ReadableStream({
    pull(controller) {
      if (!sent) {
        sent = true;
        controller.enqueue(encoder.encode(body));
        return;
      }
      controller.error(new Error("network error"));
    },
  });
  return new Response(stream, { status: 200 });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  // jsdom has no scrollIntoView (the preview table scrolls to new rows).
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup() {
  return render(
    <AiGenerateDialog
      open
      onOpenChange={vi.fn()}
      ideaId="idea-1"
      ideaDescription="A sample idea."
      currentUserId="user-1"
      columns={columns}
      boardLabels={[]}
      teamMembers={[]}
      bots={[]}
    />
  );
}

async function generate() {
  fireEvent.click(screen.getByRole("button", { name: /^Generate$/ }));
  await waitFor(() => expect(screen.queryByText("Generating tasks...")).toBeNull());
}

function requestBody(callIndex: number) {
  return JSON.parse(fetchMock.mock.calls[callIndex][1].body as string);
}

function rowTitles() {
  return ["Task A", "Task B", "Task C", "Task D"].filter((t) => screen.queryByText(t));
}

const cutFirstRun = ndjson(
  { tasks: [A] },
  { tasks: [A, B] },
  { tasks: [A, B, { title: "Task C", columnName: "Backl" }] },
  { tasks: [A, B], final: true, cutShort: "length" }
);

describe("AiGenerateDialog — a cut-short list", () => {
  it("drops the half-written task, shows the amber bar and the button, and creates no new column", async () => {
    fetchMock.mockResolvedValueOnce(okResponse(cutFirstRun));
    setup();
    await generate();

    expect(rowTitles()).toEqual(["Task A", "Task B"]);
    expect(screen.queryByText("Task C")).toBeNull();
    expect(screen.queryByText(/\bnew\b/)).toBeNull();
    expect(screen.getByText(/The list was cut short/)).toBeDefined();
    expect(screen.getByText(/ran out of room after 2 tasks/)).toBeDefined();
    expect(screen.getByRole("button", { name: "Generate the rest" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Apply 2 Tasks" })).toBeDefined();
  });
});

describe("AiGenerateDialog — Generate the rest", () => {
  it("D1: sends the list so far with the same prompt, appends the new tasks, clears the bar", async () => {
    fetchMock
      .mockResolvedValueOnce(okResponse(cutFirstRun))
      .mockResolvedValueOnce(
        okResponse(ndjson({ tasks: [C] }, { tasks: [C, D] }, { tasks: [C, D], final: true }))
      );
    setup();
    await generate();
    fireEvent.click(screen.getByRole("button", { name: "Generate the rest" }));
    await waitFor(() => expect(rowTitles()).toEqual(["Task A", "Task B", "Task C", "Task D"]));
    await waitFor(() => expect(screen.queryByText("Generating tasks...")).toBeNull());

    const second = requestBody(1);
    expect(second.continueAfter.map((t: Task) => t.title)).toEqual(["Task A", "Task B"]);
    expect(second.continueAfter[0].columnName).toBe("To Do");
    expect(second.prompt).toBe(requestBody(0).prompt);
    expect(screen.queryByText(/The list was cut short/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Generate the rest" })).toBeNull();
    expect(screen.getByRole("button", { name: "Apply 4 Tasks" })).toBeDefined();
  });

  it("D2: drops a title that differs only in case, spacing or punctuation", async () => {
    fetchMock
      .mockResolvedValueOnce(okResponse(cutFirstRun))
      .mockResolvedValueOnce(
        okResponse(
          ndjson(
            { tasks: [{ title: "  task  A! " }, C], final: true }
          )
        )
      );
    setup();
    await generate();
    fireEvent.click(screen.getByRole("button", { name: "Generate the rest" }));
    await waitFor(() => expect(screen.getByText("Task C")).toBeDefined());
    await waitFor(() => expect(screen.queryByText("Generating tasks...")).toBeNull());
    expect(rowTitles()).toEqual(["Task A", "Task B", "Task C"]);
  });

  it("D3: if it is cut again, the bar comes back with the new total", async () => {
    fetchMock
      .mockResolvedValueOnce(okResponse(cutFirstRun))
      .mockResolvedValueOnce(
        okResponse(ndjson({ tasks: [C], final: true, cutShort: "length" }))
      );
    setup();
    await generate();
    fireEvent.click(screen.getByRole("button", { name: "Generate the rest" }));
    await waitFor(() => expect(screen.getByText(/ran out of room after 3 tasks/)).toBeDefined());
    expect(rowTitles()).toEqual(["Task A", "Task B", "Task C"]);
    expect(screen.getByRole("button", { name: "Generate the rest" })).toBeDefined();
  });

  it("D4: keeps unticked rows unticked and ticks the new ones", async () => {
    fetchMock
      .mockResolvedValueOnce(okResponse(cutFirstRun))
      .mockResolvedValueOnce(okResponse(ndjson({ tasks: [C], final: true })));
    setup();
    await generate();

    // Untick Task B (rows have checkboxes; index 0 is "select all"-free, rows follow)
    const boxes = screen.getAllByRole("checkbox");
    fireEvent.click(boxes[boxes.length - 1]);
    expect(screen.getByRole("button", { name: "Apply 1 Task" })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Generate the rest" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Apply 2 Tasks" })).toBeDefined());
    expect(rowTitles()).toEqual(["Task A", "Task B", "Task C"]);
  });

  it("D5: with nothing new it keeps the list, clears the bar and says so", async () => {
    fetchMock
      .mockResolvedValueOnce(okResponse(cutFirstRun))
      .mockResolvedValueOnce(okResponse(ndjson({ tasks: [], final: true })));
    setup();
    await generate();
    fireEvent.click(screen.getByRole("button", { name: "Generate the rest" }));
    await waitFor(() => expect(toast.info).toHaveBeenCalled());

    expect(toast.info).toHaveBeenCalledWith(
      "Nothing more to add — the list already covers the whole idea."
    );
    expect(rowTitles()).toEqual(["Task A", "Task B"]);
    expect(screen.queryByText(/The list was cut short/)).toBeNull();
    expect(screen.getByRole("button", { name: "Apply 2 Tasks" })).toBeDefined();
  });

  it("D6: a failed request keeps the list, the bar and the button, and stays on the review screen", async () => {
    fetchMock
      .mockResolvedValueOnce(okResponse(cutFirstRun))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Server exploded" }), { status: 500 })
      );
    setup();
    await generate();
    fireEvent.click(screen.getByRole("button", { name: "Generate the rest" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Server exploded"));

    expect(rowTitles()).toEqual(["Task A", "Task B"]);
    expect(screen.getByText(/The list was cut short/)).toBeDefined();
    expect(screen.getByRole("button", { name: "Generate the rest" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Apply 2 Tasks" })).toBeDefined();
  });

  it("D7: Regenerate replaces the list and sends no continueAfter", async () => {
    fetchMock
      .mockResolvedValueOnce(okResponse(cutFirstRun))
      .mockResolvedValueOnce(okResponse(ndjson({ tasks: [C], final: true })))
      .mockResolvedValueOnce(okResponse(ndjson({ tasks: [D], final: true })));
    setup();
    await generate();
    fireEvent.click(screen.getByRole("button", { name: "Generate the rest" }));
    await waitFor(() => expect(screen.getByText("Task C")).toBeDefined());
    await waitFor(() => expect(screen.queryByText("Generating tasks...")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: /Regenerate/ }));
    await waitFor(() => expect(screen.getByText("Task D")).toBeDefined());
    await waitFor(() => expect(screen.queryByText("Generating tasks...")).toBeNull());

    expect(requestBody(2).continueAfter).toBeUndefined();
    expect(rowTitles()).toEqual(["Task D"]);
  });

  it("D8: a dropped connection mid-continuation keeps the finished new tasks and offers the button", async () => {
    fetchMock
      .mockResolvedValueOnce(okResponse(cutFirstRun))
      .mockResolvedValueOnce(droppedResponse(ndjson({ tasks: [C] }, { tasks: [C, D] })));
    setup();
    await generate();
    fireEvent.click(screen.getByRole("button", { name: "Generate the rest" }));
    await waitFor(() =>
      expect(screen.getByText("The connection dropped before it finished.")).toBeDefined()
    );

    expect(rowTitles()).toEqual(["Task A", "Task B", "Task C"]);
    expect(screen.getByRole("button", { name: "Generate the rest" })).toBeDefined();
    expect(toast.error).toHaveBeenCalled();
  });
});

describe("AiGenerateDialog — a clean close with no final line", () => {
  const noFinal = ndjson(
    { tasks: [A] },
    { tasks: [A, B] },
    { tasks: [A, B, { title: "Task C", columnName: "Backl" }] }
  );

  it("treats it as a dropped connection: drops the last task and makes no new column", async () => {
    fetchMock.mockResolvedValueOnce(okResponse(noFinal));
    setup();
    await generate();

    expect(rowTitles()).toEqual(["Task A", "Task B"]);
    expect(screen.queryByText(/\bnew\b/)).toBeNull();
    expect(screen.getByText("The connection dropped before it finished.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Generate the rest" })).toBeDefined();
  });

  it("does the same for Generate the rest", async () => {
    fetchMock
      .mockResolvedValueOnce(okResponse(cutFirstRun))
      .mockResolvedValueOnce(
        okResponse(ndjson({ tasks: [C] }, { tasks: [C, { title: "Task D", columnName: "Backl" }] }))
      );
    setup();
    await generate();
    fireEvent.click(screen.getByRole("button", { name: "Generate the rest" }));
    await waitFor(() =>
      expect(screen.getByText("The connection dropped before it finished.")).toBeDefined()
    );

    expect(rowTitles()).toEqual(["Task A", "Task B", "Task C"]);
    expect(screen.queryByText(/\bnew\b/)).toBeNull();
  });

  it("shows the plain wording in the toast, never the browser's own text", async () => {
    fetchMock.mockResolvedValueOnce(
      droppedResponse(ndjson({ tasks: [A] }, { tasks: [A, B] }, { tasks: [A, B, { title: "Task C" }] }))
    );
    setup();
    await generate();
    expect(toast.error).toHaveBeenCalledWith("The connection dropped before it finished.");
    expect(toast.error).not.toHaveBeenCalledWith("network error");
  });
});

describe("AiGenerateDialog — dropped connection on the first run", () => {
  it("keeps the finished tasks with the connection bar and the button", async () => {
    fetchMock.mockResolvedValueOnce(
      droppedResponse(ndjson({ tasks: [A] }, { tasks: [A, B] }, { tasks: [A, B, { title: "Task C" }] }))
    );
    setup();
    await generate();

    expect(rowTitles()).toEqual(["Task A", "Task B"]);
    expect(screen.getByText("The connection dropped before it finished.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Generate the rest" })).toBeDefined();
    expect(toast.error).toHaveBeenCalled();
  });

  it("still returns to the configure screen when nothing had finished", async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse(ndjson({ error: "Task generation was interrupted — please try again." }))
    );
    setup();
    await generate();
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: /^Generate$/ })).toBeDefined();
  });
});
