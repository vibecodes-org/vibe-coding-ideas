import { describe, it, expect } from "vitest";
import {
  parseCsv,
  autoDetectCsvMapping,
  csvToImportTasks,
  detectJsonFormat,
  parseTrelloJson,
  parseCustomJson,
  parseBulkText,
  autoMapColumns,
  getUniqueColumnNames,
  type ImportTask,
  type CsvFieldMapping,
  type SequentialInsertCallbacks,
} from "./import";
import type { BoardColumnWithTasks } from "@/types";

// ── parseCsv ──────────────────────────────────────────────────────────

describe("parseCsv", () => {
  it("parses simple CSV", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("trims field whitespace", () => {
    expect(parseCsv("  hello , world ")).toEqual([["hello", "world"]]);
  });

  it("handles quoted fields with commas", () => {
    expect(parseCsv('"a,b",c')).toEqual([["a,b", "c"]]);
  });

  it("handles escaped quotes inside quoted fields", () => {
    expect(parseCsv('"say ""hello""",done')).toEqual([
      ['say "hello"', "done"],
    ]);
  });

  it("handles newlines inside quoted fields", () => {
    expect(parseCsv('"line1\nline2",b')).toEqual([["line1\nline2", "b"]]);
  });

  it("handles CRLF line endings", () => {
    expect(parseCsv("a,b\r\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("skips blank rows", () => {
    expect(parseCsv("a,b\n\n1,2\n\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("returns empty array for empty input", () => {
    expect(parseCsv("")).toEqual([]);
  });

  it("handles single column CSV", () => {
    expect(parseCsv("title\nTask 1\nTask 2")).toEqual([
      ["title"],
      ["Task 1"],
      ["Task 2"],
    ]);
  });
});

// ── autoDetectCsvMapping ──────────────────────────────────────────────

describe("autoDetectCsvMapping", () => {
  it("maps standard headers", () => {
    const mapping = autoDetectCsvMapping([
      "Title",
      "Description",
      "Status",
      "Assignee",
    ]);
    expect(mapping).toEqual({
      0: "title",
      1: "description",
      2: "column",
      3: "assignee",
    });
  });

  it("maps aliases case-insensitively", () => {
    const mapping = autoDetectCsvMapping(["TASK NAME", "Notes", "OWNER"]);
    expect(mapping).toEqual({
      0: "title",
      1: "description",
      2: "assignee",
    });
  });

  it("maps due date aliases", () => {
    const mapping = autoDetectCsvMapping(["Title", "Deadline"]);
    expect(mapping).toEqual({
      0: "title",
      1: "due_date",
    });
  });

  it("maps label/tag aliases", () => {
    const mapping = autoDetectCsvMapping(["Title", "Tags"]);
    expect(mapping).toEqual({
      0: "title",
      1: "labels",
    });
  });

  it("skips unknown headers", () => {
    const mapping = autoDetectCsvMapping(["Title", "Foo", "Bar"]);
    expect(mapping).toEqual({
      0: "title",
      1: "skip",
      2: "skip",
    });
  });

  it("does not double-map the same field", () => {
    // "name" and "task" both map to "title" — only the first should be used
    const mapping = autoDetectCsvMapping(["Name", "Task", "Description"]);
    expect(mapping[0]).toBe("title");
    expect(mapping[1]).toBe("skip");
    expect(mapping[2]).toBe("description");
  });
});

// ── csvToImportTasks ──────────────────────────────────────────────────

describe("csvToImportTasks", () => {
  it("converts rows to import tasks", () => {
    const headers = ["Title", "Description", "Status"];
    const rows = [["Fix bug", "Important fix", "To Do"]];
    const mapping: CsvFieldMapping = {
      0: "title",
      1: "description",
      2: "column",
    };

    const tasks = csvToImportTasks(rows, headers, mapping);
    expect(tasks).toEqual([
      {
        title: "Fix bug",
        description: "Important fix",
        columnName: "To Do",
        assigneeName: undefined,
        dueDate: undefined,
        labels: undefined,
      },
    ]);
  });

  it("skips rows without a title", () => {
    const rows = [
      ["", "No title here", ""],
      ["Has title", "", ""],
    ];
    const mapping: CsvFieldMapping = {
      0: "title",
      1: "description",
      2: "column",
    };

    const tasks = csvToImportTasks(rows, [], mapping);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Has title");
  });

  it("skips fields mapped as skip", () => {
    const rows = [["Task 1", "ignored", "To Do"]];
    const mapping: CsvFieldMapping = {
      0: "title",
      1: "skip",
      2: "column",
    };

    const tasks = csvToImportTasks(rows, [], mapping);
    expect(tasks[0].description).toBeUndefined();
    expect(tasks[0].columnName).toBe("To Do");
  });

  it("parses labels from delimited string", () => {
    const rows = [["Task", "bug;feature|urgent"]];
    const mapping: CsvFieldMapping = { 0: "title", 1: "labels" };

    const tasks = csvToImportTasks(rows, [], mapping);
    expect(tasks[0].labels).toEqual(["bug", "feature", "urgent"]);
  });

  it("parses valid due dates", () => {
    const rows = [["Task", "2025-03-15"]];
    const mapping: CsvFieldMapping = { 0: "title", 1: "due_date" };

    const tasks = csvToImportTasks(rows, [], mapping);
    expect(tasks[0].dueDate).toBe("2025-03-15");
  });

  it("ignores invalid due dates", () => {
    const rows = [["Task", "not-a-date"]];
    const mapping: CsvFieldMapping = { 0: "title", 1: "due_date" };

    const tasks = csvToImportTasks(rows, [], mapping);
    expect(tasks[0].dueDate).toBeUndefined();
  });

  it("handles multiple rows", () => {
    const rows = [
      ["Task 1", "Desc 1"],
      ["Task 2", "Desc 2"],
      ["Task 3", "Desc 3"],
    ];
    const mapping: CsvFieldMapping = { 0: "title", 1: "description" };

    const tasks = csvToImportTasks(rows, [], mapping);
    expect(tasks).toHaveLength(3);
    expect(tasks.map((t) => t.title)).toEqual(["Task 1", "Task 2", "Task 3"]);
  });
});

// ── detectJsonFormat ──────────────────────────────────────────────────

describe("detectJsonFormat", () => {
  it("detects Trello format", () => {
    expect(detectJsonFormat({ lists: [], cards: [] })).toBe("trello");
  });

  it("detects custom format", () => {
    expect(detectJsonFormat({ tasks: [] })).toBe("custom");
  });

  it("returns unknown for unrecognized objects", () => {
    expect(detectJsonFormat({ items: [] })).toBe("unknown");
    expect(detectJsonFormat({})).toBe("unknown");
  });

  it("returns unknown for non-objects", () => {
    expect(detectJsonFormat(null)).toBe("unknown");
    expect(detectJsonFormat("string")).toBe("unknown");
    expect(detectJsonFormat(42)).toBe("unknown");
    expect(detectJsonFormat(undefined)).toBe("unknown");
  });

  it("prefers trello when both lists/cards and tasks exist", () => {
    expect(detectJsonFormat({ lists: [], cards: [], tasks: [] })).toBe(
      "trello"
    );
  });
});

// ── parseTrelloJson ───────────────────────────────────────────────────

describe("parseTrelloJson", () => {
  it("converts Trello cards to import tasks", () => {
    const data = {
      lists: [{ id: "list1", name: "Backlog" }],
      cards: [
        {
          name: "Fix login",
          desc: "Users can't log in",
          idList: "list1",
          due: "2025-06-01T00:00:00.000Z",
        },
      ],
    };

    const tasks = parseTrelloJson(data);
    expect(tasks).toEqual([
      {
        title: "Fix login",
        description: "Users can't log in",
        columnName: "Backlog",
        dueDate: "2025-06-01",
        labels: undefined,
        checklistItems: undefined,
      },
    ]);
  });

  it("filters closed cards", () => {
    const data = {
      lists: [{ id: "list1", name: "Done" }],
      cards: [
        { name: "Open card", idList: "list1" },
        { name: "Closed card", idList: "list1", closed: true },
      ],
    };

    const tasks = parseTrelloJson(data);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Open card");
  });

  it("filters closed lists — cards reference missing list", () => {
    const data = {
      lists: [{ id: "list1", name: "Archived List", closed: true }],
      cards: [{ name: "Task in closed list", idList: "list1" }],
    };

    const tasks = parseTrelloJson(data);
    expect(tasks[0].columnName).toBeUndefined();
  });

  it("extracts checklists", () => {
    const data = {
      lists: [{ id: "list1", name: "Todo" }],
      cards: [
        {
          name: "Setup project",
          idList: "list1",
          checklists: [
            {
              checkItems: [
                { name: "Install deps", state: "complete" },
                { name: "Configure ESLint", state: "incomplete" },
              ],
            },
          ],
        },
      ],
    };

    const tasks = parseTrelloJson(data);
    expect(tasks[0].checklistItems).toEqual([
      "Install deps",
      "Configure ESLint",
    ]);
  });

  it("extracts labels", () => {
    const data = {
      lists: [{ id: "list1", name: "Todo" }],
      cards: [
        {
          name: "Bug fix",
          idList: "list1",
          labels: [
            { name: "Bug", color: "red" },
            { name: "Urgent", color: "orange" },
            { name: "" }, // empty label name — should be filtered
          ],
        },
      ],
    };

    const tasks = parseTrelloJson(data);
    expect(tasks[0].labels).toEqual(["Bug", "Urgent"]);
  });

  it("handles empty desc as undefined", () => {
    const data = {
      lists: [{ id: "list1", name: "Todo" }],
      cards: [{ name: "Task", desc: "", idList: "list1" }],
    };

    const tasks = parseTrelloJson(data);
    expect(tasks[0].description).toBeUndefined();
  });

  it("handles multiple checklists", () => {
    const data = {
      lists: [{ id: "list1", name: "Todo" }],
      cards: [
        {
          name: "Task",
          idList: "list1",
          checklists: [
            { checkItems: [{ name: "Item A" }] },
            { checkItems: [{ name: "Item B" }, { name: "Item C" }] },
          ],
        },
      ],
    };

    const tasks = parseTrelloJson(data);
    expect(tasks[0].checklistItems).toEqual(["Item A", "Item B", "Item C"]);
  });
});

// ── parseCustomJson ───────────────────────────────────────────────────

describe("parseCustomJson", () => {
  it("converts custom JSON tasks", () => {
    const data = {
      tasks: [
        {
          title: "Task 1",
          description: "Do something",
          column: "To Do",
          assignee: "Alice",
          due_date: "2025-04-01",
          labels: ["bug", "p1"],
          checklist: ["Step 1", "Step 2"],
        },
      ],
    };

    const tasks = parseCustomJson(data);
    expect(tasks).toEqual([
      {
        title: "Task 1",
        description: "Do something",
        columnName: "To Do",
        assigneeName: "Alice",
        dueDate: "2025-04-01",
        labels: ["bug", "p1"],
        checklistItems: ["Step 1", "Step 2"],
      },
    ]);
  });

  it("filters tasks without title", () => {
    const data = {
      tasks: [
        { title: "Valid", description: "ok" },
        { title: "", description: "no title" },
      ],
    };

    const tasks = parseCustomJson(data);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Valid");
  });

  it("handles minimal tasks (title only)", () => {
    const data = { tasks: [{ title: "Simple task" }] };

    const tasks = parseCustomJson(data);
    expect(tasks[0]).toEqual({
      title: "Simple task",
      description: undefined,
      columnName: undefined,
      assigneeName: undefined,
      dueDate: undefined,
      labels: undefined,
      checklistItems: undefined,
    });
  });

  it("ignores invalid due dates", () => {
    const data = { tasks: [{ title: "Task", due_date: "garbage" }] };

    const tasks = parseCustomJson(data);
    expect(tasks[0].dueDate).toBeUndefined();
  });
});

// ── parseBulkText ─────────────────────────────────────────────────────

describe("parseBulkText", () => {
  it("parses plain lines as task titles", () => {
    const tasks = parseBulkText("Fix login\nAdd dashboard\nWrite tests");
    expect(tasks).toEqual([
      { title: "Fix login" },
      { title: "Add dashboard" },
      { title: "Write tests" },
    ]);
  });

  it("strips bullet prefixes", () => {
    const tasks = parseBulkText("- Task A\n* Task B\n1. Task C");
    expect(tasks.map((t) => t.title)).toEqual([
      "Task A",
      "Task B",
      "Task C",
    ]);
  });

  it("parses checklist items under tasks", () => {
    const text = `Fix login
- [ ] Check auth flow
- [x] Update credentials
Add tests`;

    const tasks = parseBulkText(text);
    expect(tasks).toHaveLength(2);
    expect(tasks[0].title).toBe("Fix login");
    expect(tasks[0].checklistItems).toEqual([
      "Check auth flow",
      "Update credentials",
    ]);
    expect(tasks[1].title).toBe("Add tests");
    expect(tasks[1].checklistItems).toBeUndefined();
  });

  it("ignores blank lines", () => {
    const tasks = parseBulkText("Task 1\n\n\nTask 2\n\n");
    expect(tasks).toHaveLength(2);
  });

  it("handles empty input", () => {
    expect(parseBulkText("")).toEqual([]);
    expect(parseBulkText("   \n  \n  ")).toEqual([]);
  });

  it("ignores orphan checklist items (no preceding task)", () => {
    const tasks = parseBulkText("- [ ] orphan item\nActual task");
    // The orphan checklist item has no task to attach to, so it's skipped
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Actual task");
  });

  it("handles numbered list prefixes", () => {
    const tasks = parseBulkText("1. First\n2. Second\n10. Tenth");
    expect(tasks.map((t) => t.title)).toEqual(["First", "Second", "Tenth"]);
  });
});

// ── autoMapColumns ────────────────────────────────────────────────────

describe("autoMapColumns", () => {
  const columns: BoardColumnWithTasks[] = [
    { id: "col-1", idea_id: "idea-1", title: "To Do", position: 0, is_done_column: false, tasks: [] },
    { id: "col-2", idea_id: "idea-1", title: "In Progress", position: 1000, is_done_column: false, tasks: [] },
    { id: "col-3", idea_id: "idea-1", title: "Done", position: 2000, is_done_column: true, tasks: [] },
  ];

  it("maps matching column names by case-insensitive match", () => {
    const mapping = autoMapColumns(["to do", "IN PROGRESS"], columns);
    expect(mapping).toEqual({
      "to do": "col-1",
      "IN PROGRESS": "col-2",
    });
  });

  it("maps unmatched names to __new__", () => {
    const mapping = autoMapColumns(["Backlog", "To Do"], columns);
    expect(mapping).toEqual({
      Backlog: "__new__",
      "To Do": "col-1",
    });
  });

  it("handles empty source names", () => {
    expect(autoMapColumns([], columns)).toEqual({});
  });

  it("handles empty columns list", () => {
    const mapping = autoMapColumns(["To Do"], []);
    expect(mapping).toEqual({ "To Do": "__new__" });
  });
});

// ── getUniqueColumnNames ──────────────────────────────────────────────

describe("getUniqueColumnNames", () => {
  it("extracts unique column names from tasks", () => {
    const tasks: ImportTask[] = [
      { title: "A", columnName: "To Do" },
      { title: "B", columnName: "Done" },
      { title: "C", columnName: "To Do" },
      { title: "D" },
    ];

    expect(getUniqueColumnNames(tasks)).toEqual(
      expect.arrayContaining(["To Do", "Done"])
    );
    expect(getUniqueColumnNames(tasks)).toHaveLength(2);
  });

  it("returns empty array when no tasks have columns", () => {
    const tasks: ImportTask[] = [{ title: "A" }, { title: "B" }];
    expect(getUniqueColumnNames(tasks)).toEqual([]);
  });

  it("returns empty array for empty task list", () => {
    expect(getUniqueColumnNames([])).toEqual([]);
  });
});

// ── SequentialInsertCallbacks type ────────────────────────────────────

describe("SequentialInsertCallbacks", () => {
  it("accepts callbacks with auto-rule progress hooks", () => {
    const callbacks: SequentialInsertCallbacks = {
      onTaskCreated: () => {},
      onTaskError: () => {},
      onSetupComplete: () => {},
      onAutoRulesStart: (totalTasks: number) => {
        expect(typeof totalTasks).toBe("number");
      },
      onAutoRuleApplied: (taskId: string, current: number, total: number) => {
        expect(typeof taskId).toBe("string");
        expect(typeof current).toBe("number");
        expect(typeof total).toBe("number");
      },
    };

    // Verify all callbacks are callable
    callbacks.onTaskCreated(0, "test");
    callbacks.onTaskError(0, "test", "error");
    callbacks.onSetupComplete?.({ columns: 1, labels: 2 });
    callbacks.onAutoRulesStart?.(5);
    callbacks.onAutoRuleApplied?.("task-1", 1, 5);
  });

  it("works without optional auto-rule callbacks", () => {
    const callbacks: SequentialInsertCallbacks = {
      onTaskCreated: () => {},
      onTaskError: () => {},
    };

    // Should compile and run without error
    expect(callbacks.onAutoRulesStart).toBeUndefined();
    expect(callbacks.onAutoRuleApplied).toBeUndefined();
  });

  it("onAutoRulesStart receives 0 when no auto-rules exist", () => {
    let receivedTotal: number | undefined;
    const callbacks: SequentialInsertCallbacks = {
      onTaskCreated: () => {},
      onTaskError: () => {},
      onAutoRulesStart: (totalTasks) => {
        receivedTotal = totalTasks;
      },
    };

    callbacks.onAutoRulesStart?.(0);
    expect(receivedTotal).toBe(0);
  });
});
