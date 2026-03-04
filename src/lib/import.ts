import { createClient } from "@/lib/supabase/client";
import { POSITION_GAP, LABEL_COLORS } from "@/lib/constants";
import type { BoardColumnWithTasks, BoardLabel, User } from "@/types";

// ── Types ──────────────────────────────────────────────────────────────

export interface ImportTask {
  title: string;
  description?: string;
  columnName?: string;
  assigneeName?: string;
  dueDate?: string;
  labels?: string[];
  checklistItems?: string[];
}

/** sourceName -> columnId | "__new__" */
export type ColumnMapping = Record<string, string>;

export type CsvFieldMapping = Record<
  number,
  "title" | "description" | "column" | "assignee" | "due_date" | "labels" | "skip"
>;

// ── CSV Parser ─────────────────────────────────────────────────────────

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === ",") {
        row.push(field.trim());
        field = "";
        i++;
      } else if (ch === "\r" || ch === "\n") {
        row.push(field.trim());
        field = "";
        if (ch === "\r" && i + 1 < text.length && text[i + 1] === "\n") {
          i++;
        }
        if (row.some((f) => f !== "")) {
          rows.push(row);
        }
        row = [];
        i++;
      } else {
        field += ch;
        i++;
      }
    }
  }

  // Final field/row
  row.push(field.trim());
  if (row.some((f) => f !== "")) {
    rows.push(row);
  }

  return rows;
}

const HEADER_ALIASES: Record<string, CsvFieldMapping[number]> = {
  title: "title",
  name: "title",
  task: "title",
  "task name": "title",
  summary: "title",
  description: "description",
  desc: "description",
  details: "description",
  notes: "description",
  column: "column",
  status: "column",
  list: "column",
  stage: "column",
  assignee: "assignee",
  assigned: "assignee",
  "assigned to": "assignee",
  owner: "assignee",
  "due date": "due_date",
  due: "due_date",
  deadline: "due_date",
  date: "due_date",
  labels: "labels",
  tags: "labels",
  label: "labels",
  tag: "labels",
  category: "labels",
};

export function autoDetectCsvMapping(headers: string[]): CsvFieldMapping {
  const mapping: CsvFieldMapping = {};
  const usedFields = new Set<string>();

  for (let i = 0; i < headers.length; i++) {
    const normalized = headers[i].toLowerCase().trim();
    const match = HEADER_ALIASES[normalized];
    if (match && !usedFields.has(match)) {
      mapping[i] = match;
      usedFields.add(match);
    } else {
      mapping[i] = "skip";
    }
  }

  return mapping;
}

export function csvToImportTasks(
  rows: string[][],
  headers: string[],
  fieldMapping: CsvFieldMapping
): ImportTask[] {
  const tasks: ImportTask[] = [];

  for (const row of rows) {
    let title = "";
    let description: string | undefined;
    let columnName: string | undefined;
    let assigneeName: string | undefined;
    let dueDate: string | undefined;
    let labels: string[] | undefined;

    for (let i = 0; i < row.length; i++) {
      const field = fieldMapping[i];
      const value = row[i];
      if (!value || field === "skip") continue;

      switch (field) {
        case "title":
          title = value;
          break;
        case "description":
          description = value;
          break;
        case "column":
          columnName = value;
          break;
        case "assignee":
          assigneeName = value;
          break;
        case "due_date":
          dueDate = parseDateString(value);
          break;
        case "labels":
          labels = value
            .split(/[,;|]/)
            .map((l) => l.trim())
            .filter(Boolean);
          break;
      }
    }

    if (title) {
      tasks.push({ title, description, columnName, assigneeName, dueDate, labels });
    }
  }

  return tasks;
}

function parseDateString(value: string): string | undefined {
  const d = new Date(value);
  if (!isNaN(d.getTime())) {
    return d.toISOString().split("T")[0];
  }
  return undefined;
}

// ── JSON Parsers ───────────────────────────────────────────────────────

interface TrelloExport {
  lists: { id: string; name: string; closed?: boolean }[];
  cards: {
    name: string;
    desc?: string;
    idList: string;
    closed?: boolean;
    due?: string;
    labels?: { name: string; color?: string }[];
    checklists?: { checkItems: { name: string; state?: string }[] }[];
  }[];
}

interface CustomJsonExport {
  tasks: {
    title: string;
    description?: string;
    column?: string;
    assignee?: string;
    due_date?: string;
    labels?: string[];
    checklist?: string[];
  }[];
}

export function detectJsonFormat(
  data: unknown
): "trello" | "custom" | "unknown" {
  if (typeof data !== "object" || data === null) return "unknown";

  const obj = data as Record<string, unknown>;

  if (Array.isArray(obj.lists) && Array.isArray(obj.cards)) {
    return "trello";
  }

  if (Array.isArray(obj.tasks)) {
    return "custom";
  }

  return "unknown";
}

export function parseTrelloJson(data: TrelloExport): ImportTask[] {
  const listMap = new Map<string, string>();
  for (const list of data.lists) {
    if (!list.closed) {
      listMap.set(list.id, list.name);
    }
  }

  return data.cards
    .filter((card) => !card.closed)
    .map((card) => {
      const checklistItems: string[] = [];
      if (card.checklists) {
        for (const cl of card.checklists) {
          for (const item of cl.checkItems) {
            checklistItems.push(item.name);
          }
        }
      }

      return {
        title: card.name,
        description: card.desc || undefined,
        columnName: listMap.get(card.idList),
        dueDate: card.due ? parseDateString(card.due) : undefined,
        labels: card.labels
          ?.map((l) => l.name)
          .filter(Boolean),
        checklistItems: checklistItems.length > 0 ? checklistItems : undefined,
      };
    });
}

export function parseCustomJson(data: CustomJsonExport): ImportTask[] {
  return data.tasks
    .filter((t) => t.title)
    .map((t) => ({
      title: t.title,
      description: t.description,
      columnName: t.column,
      assigneeName: t.assignee,
      dueDate: t.due_date ? parseDateString(t.due_date) : undefined,
      labels: t.labels,
      checklistItems: t.checklist,
    }));
}

// ── Bulk Text Parser ───────────────────────────────────────────────────

export function parseBulkText(text: string): ImportTask[] {
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  const tasks: ImportTask[] = [];
  let currentTask: ImportTask | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    const checklistMatch = line.match(/^-\s*\[[ x]]\s*(.+)$/i);

    if (checklistMatch) {
      if (currentTask) {
        if (!currentTask.checklistItems) currentTask.checklistItems = [];
        currentTask.checklistItems.push(checklistMatch[1].trim());
      }
    } else {
      // Strip leading "- " or "* " or numbered "1. " prefixes
      const title = line.replace(/^(?:[-*]\s+|\d+\.\s+)/, "").trim();
      if (title) {
        currentTask = { title };
        tasks.push(currentTask);
      }
    }
  }

  return tasks;
}

// ── Auto-Mapping ───────────────────────────────────────────────────────

export function autoMapColumns(
  sourceNames: string[],
  columns: BoardColumnWithTasks[]
): ColumnMapping {
  const mapping: ColumnMapping = {};

  for (const name of sourceNames) {
    const lower = name.toLowerCase().trim();
    const match = columns.find(
      (c) => c.title.toLowerCase().trim() === lower
    );
    mapping[name] = match ? match.id : "__new__";
  }

  return mapping;
}

export function getUniqueColumnNames(tasks: ImportTask[]): string[] {
  const names = new Set<string>();
  for (const t of tasks) {
    if (t.columnName) names.add(t.columnName);
  }
  return Array.from(names);
}

// ── Bulk Import ────────────────────────────────────────────────────────

const BATCH_SIZE = 50;
const MAX_TASKS = 500;

export interface ImportProgress {
  phase: string;
  current: number;
  total: number;
}

export async function executeBulkImport(
  tasks: ImportTask[],
  ideaId: string,
  currentUserId: string,
  columns: BoardColumnWithTasks[],
  columnMapping: ColumnMapping,
  defaultColumnId: string,
  boardLabels: BoardLabel[],
  teamMembers: User[],
  onProgress?: (progress: ImportProgress) => void
): Promise<{ created: number; errors: string[] }> {
  const supabase = createClient();
  const errors: string[] = [];
  const cappedTasks = tasks.slice(0, MAX_TASKS);
  const total = cappedTasks.length;

  // Phase 1: Create new columns
  onProgress?.({ phase: "Creating columns...", current: 0, total });

  const newColumnNames = Object.entries(columnMapping)
    .filter(([, v]) => v === "__new__")
    .map(([k]) => k);

  let maxColPosition =
    columns.length > 0
      ? Math.max(...columns.map((c) => c.position))
      : -POSITION_GAP;

  const createdColumnMap = new Map<string, string>(); // name -> id

  if (newColumnNames.length > 0) {
    const inserts = newColumnNames.map((name) => {
      maxColPosition += POSITION_GAP;
      return { idea_id: ideaId, title: name, position: maxColPosition };
    });

    const { data: newCols, error } = await supabase
      .from("board_columns")
      .insert(inserts)
      .select("id, title");

    if (error) {
      errors.push(`Failed to create columns: ${error.message}`);
      return { created: 0, errors };
    }

    for (const col of newCols ?? []) {
      createdColumnMap.set(col.title, col.id);
    }

    // Update the mapping to use real IDs
    for (const name of newColumnNames) {
      const id = createdColumnMap.get(name);
      if (id) columnMapping[name] = id;
    }
  }

  // Phase 2: Create/match labels
  onProgress?.({ phase: "Processing labels...", current: 0, total });

  const allLabelNames = new Set<string>();
  for (const t of cappedTasks) {
    if (t.labels) {
      for (const l of t.labels) allLabelNames.add(l);
    }
  }

  const labelMap = new Map<string, string>(); // lowercase name -> label id
  for (const label of boardLabels) {
    labelMap.set(label.name.toLowerCase(), label.id);
  }

  const newLabels: string[] = [];
  for (const name of allLabelNames) {
    if (!labelMap.has(name.toLowerCase())) {
      newLabels.push(name);
    }
  }

  if (newLabels.length > 0) {
    let colorIdx = boardLabels.length % LABEL_COLORS.length;
    const labelInserts = newLabels.map((name) => {
      const color = LABEL_COLORS[colorIdx % LABEL_COLORS.length].value;
      colorIdx++;
      return { idea_id: ideaId, name, color };
    });

    const { data: createdLabels, error } = await supabase
      .from("board_labels")
      .insert(labelInserts)
      .select("id, name");

    if (error) {
      errors.push(`Failed to create labels: ${error.message}`);
    } else {
      for (const l of createdLabels ?? []) {
        labelMap.set(l.name.toLowerCase(), l.id);
      }
    }
  }

  // Phase 3: Resolve assignees
  const assigneeMap = new Map<string, string>(); // lowercase name/email -> userId
  for (const member of teamMembers) {
    if (member.full_name) {
      assigneeMap.set(member.full_name.toLowerCase(), member.id);
    }
    if (member.email) {
      assigneeMap.set(member.email.toLowerCase(), member.id);
    }
  }

  // Phase 4: Calculate positions per column
  const positionByColumn = new Map<string, number>();

  // Query max positions from existing tasks per column
  const columnIds = new Set<string>();
  for (const t of cappedTasks) {
    const colId = t.columnName
      ? columnMapping[t.columnName] ?? defaultColumnId
      : defaultColumnId;
    columnIds.add(colId);
  }

  for (const colId of columnIds) {
    const existing = columns.find((c) => c.id === colId);
    if (existing && existing.tasks.length > 0) {
      positionByColumn.set(
        colId,
        Math.max(...existing.tasks.map((t) => t.position))
      );
    } else {
      positionByColumn.set(colId, -POSITION_GAP);
    }
  }

  // Phase 5: Batch insert tasks
  let created = 0;
  const taskLabelRows: { task_id: string; label_id: string }[] = [];
  const checklistRows: {
    task_id: string;
    idea_id: string;
    title: string;
    position: number;
  }[] = [];
  const activityRows: {
    task_id: string;
    idea_id: string;
    actor_id: string;
    action: string;
    details: Record<string, string> | null;
  }[] = [];

  for (let i = 0; i < cappedTasks.length; i += BATCH_SIZE) {
    const batch = cappedTasks.slice(i, i + BATCH_SIZE);
    onProgress?.({
      phase: "Importing tasks...",
      current: i,
      total,
    });

    const inserts = batch.map((t) => {
      const colId = t.columnName
        ? columnMapping[t.columnName] ?? defaultColumnId
        : defaultColumnId;

      const pos = (positionByColumn.get(colId) ?? -POSITION_GAP) + POSITION_GAP;
      positionByColumn.set(colId, pos);

      const assigneeId = t.assigneeName
        ? assigneeMap.get(t.assigneeName.toLowerCase()) ?? null
        : null;

      return {
        idea_id: ideaId,
        column_id: colId,
        title: t.title,
        description: t.description ?? null,
        assignee_id: assigneeId,
        position: pos,
        due_date: t.dueDate ?? null,
      };
    });

    const { data: createdTasks, error } = await supabase
      .from("board_tasks")
      .insert(inserts)
      .select("id");

    if (error) {
      errors.push(`Batch ${Math.floor(i / BATCH_SIZE) + 1} failed: ${error.message}`);
      continue;
    }

    const ids = createdTasks?.map((t) => t.id) ?? [];
    created += ids.length;

    // Collect label join rows
    for (let j = 0; j < batch.length; j++) {
      const t = batch[j];
      const taskId = ids[j];
      if (!taskId) continue;

      if (t.labels) {
        for (const labelName of t.labels) {
          const labelId = labelMap.get(labelName.toLowerCase());
          if (labelId) {
            taskLabelRows.push({ task_id: taskId, label_id: labelId });
          }
        }
      }

      if (t.checklistItems) {
        for (let ci = 0; ci < t.checklistItems.length; ci++) {
          checklistRows.push({
            task_id: taskId,
            idea_id: ideaId,
            title: t.checklistItems[ci],
            position: ci * POSITION_GAP,
          });
        }
      }

      activityRows.push({
        task_id: taskId,
        idea_id: ideaId,
        actor_id: currentUserId,
        action: "bulk_imported",
        details: null,
      });
    }
  }

  // Phase 6: Batch insert task-labels
  if (taskLabelRows.length > 0) {
    onProgress?.({ phase: "Assigning labels...", current: total, total });
    for (let i = 0; i < taskLabelRows.length; i += BATCH_SIZE) {
      const batch = taskLabelRows.slice(i, i + BATCH_SIZE);
      const { error } = await supabase
        .from("board_task_labels")
        .insert(batch);
      if (error) {
        errors.push(`Label assignment batch failed: ${error.message}`);
      }
    }
  }

  // Phase 7: Batch insert checklist items
  if (checklistRows.length > 0) {
    onProgress?.({ phase: "Creating checklists...", current: total, total });
    for (let i = 0; i < checklistRows.length; i += BATCH_SIZE) {
      const batch = checklistRows.slice(i, i + BATCH_SIZE);
      const { error } = await supabase
        .from("board_checklist_items")
        .insert(batch);
      if (error) {
        errors.push(`Checklist batch failed: ${error.message}`);
      }
    }
  }

  // Phase 8: Log activity (fire-and-forget)
  if (activityRows.length > 0) {
    for (let i = 0; i < activityRows.length; i += BATCH_SIZE) {
      const batch = activityRows.slice(i, i + BATCH_SIZE);
      supabase
        .from("board_task_activity")
        .insert(batch)
        .then(({ error }) => {
          if (error) console.error("Activity log failed:", error.message);
        });
    }
  }

  onProgress?.({ phase: "Done!", current: total, total });

  return { created, errors };
}

// ── Sequential Insert (for AI Generate) ─────────────────────────────

const THROTTLE_MS = 150;
const RETRY_DELAY_MS = 500;

export interface SequentialInsertCallbacks {
  onTaskCreated: (index: number, title: string) => void;
  onTaskError: (index: number, title: string, error: string) => void;
  onSetupComplete?: (stats: { columns: number; labels: number }) => void;
}

export interface SequentialInsertResult {
  created: number;
  failed: { index: number; title: string; error: string }[];
  columnsCreated: number;
  labelsCreated: number;
}

export async function insertTasksSequentially(
  tasks: ImportTask[],
  ideaId: string,
  currentUserId: string,
  columns: BoardColumnWithTasks[],
  columnMapping: ColumnMapping,
  defaultColumnId: string,
  boardLabels: BoardLabel[],
  teamMembers: User[],
  callbacks: SequentialInsertCallbacks,
  signal?: AbortSignal
): Promise<SequentialInsertResult> {
  const supabase = createClient();
  const cappedTasks = tasks.slice(0, MAX_TASKS);
  const failed: SequentialInsertResult["failed"] = [];

  // ── Setup: Create columns ──────────────────────────────────────────

  const newColumnNames = Object.entries(columnMapping)
    .filter(([, v]) => v === "__new__")
    .map(([k]) => k);

  let maxColPosition =
    columns.length > 0
      ? Math.max(...columns.map((c) => c.position))
      : -POSITION_GAP;

  let columnsCreated = 0;

  if (newColumnNames.length > 0) {
    const inserts = newColumnNames.map((name) => {
      maxColPosition += POSITION_GAP;
      return { idea_id: ideaId, title: name, position: maxColPosition };
    });

    let newCols: { id: string; title: string }[] | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt === 1) {
        // Before retrying, check which columns were already created
        const { data: existing } = await supabase
          .from("board_columns")
          .select("id, title")
          .eq("idea_id", ideaId)
          .in("title", newColumnNames);

        if (existing && existing.length > 0) {
          const existingNames = new Set(existing.map((c) => c.title));
          const remaining = inserts.filter((i) => !existingNames.has(i.title));
          if (remaining.length === 0) {
            newCols = existing;
            break;
          }
          // Insert only the missing columns
          const { data, error } = await supabase
            .from("board_columns")
            .insert(remaining)
            .select("id, title");

          if (error) {
            throw new Error(`Failed to create columns: ${error.message}`);
          }
          newCols = [...existing, ...(data ?? [])];
          break;
        }
      }

      const { data, error } = await supabase
        .from("board_columns")
        .insert(inserts)
        .select("id, title");

      if (!error && data) {
        newCols = data;
        break;
      }
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      } else {
        throw new Error(`Failed to create columns: ${error?.message}`);
      }
    }

    for (const col of newCols ?? []) {
      columnMapping[col.title] = col.id;
    }
    columnsCreated = newCols?.length ?? 0;
  }

  // ── Setup: Create/match labels ─────────────────────────────────────

  const allLabelNames = new Set<string>();
  for (const t of cappedTasks) {
    if (t.labels) {
      for (const l of t.labels) allLabelNames.add(l);
    }
  }

  const labelMap = new Map<string, string>();
  for (const label of boardLabels) {
    labelMap.set(label.name.toLowerCase(), label.id);
  }

  const newLabels: string[] = [];
  for (const name of allLabelNames) {
    if (!labelMap.has(name.toLowerCase())) {
      newLabels.push(name);
    }
  }

  let labelsCreated = 0;

  if (newLabels.length > 0) {
    let colorIdx = boardLabels.length % LABEL_COLORS.length;
    const labelInserts = newLabels.map((name) => {
      const color = LABEL_COLORS[colorIdx % LABEL_COLORS.length].value;
      colorIdx++;
      return { idea_id: ideaId, name, color };
    });

    let createdLabels: { id: string; name: string }[] | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt === 1) {
        // Before retrying, check which labels were already created
        const { data: existing } = await supabase
          .from("board_labels")
          .select("id, name")
          .eq("idea_id", ideaId)
          .in("name", newLabels);

        if (existing && existing.length > 0) {
          const existingNames = new Set(existing.map((l) => l.name.toLowerCase()));
          const remaining = labelInserts.filter(
            (i) => !existingNames.has(i.name.toLowerCase())
          );
          if (remaining.length === 0) {
            createdLabels = existing;
            break;
          }
          const { data, error } = await supabase
            .from("board_labels")
            .insert(remaining)
            .select("id, name");

          if (error) {
            throw new Error(`Failed to create labels: ${error.message}`);
          }
          createdLabels = [...existing, ...(data ?? [])];
          break;
        }
      }

      const { data, error } = await supabase
        .from("board_labels")
        .insert(labelInserts)
        .select("id, name");

      if (!error && data) {
        createdLabels = data;
        break;
      }
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      } else {
        throw new Error(`Failed to create labels: ${error?.message}`);
      }
    }

    for (const l of createdLabels ?? []) {
      labelMap.set(l.name.toLowerCase(), l.id);
    }
    labelsCreated = createdLabels?.length ?? 0;
  }

  callbacks.onSetupComplete?.({ columns: columnsCreated, labels: labelsCreated });

  // ── Setup: Resolve assignees ───────────────────────────────────────

  const assigneeMap = new Map<string, string>();
  for (const member of teamMembers) {
    if (member.full_name) {
      assigneeMap.set(member.full_name.toLowerCase(), member.id);
    }
    if (member.email) {
      assigneeMap.set(member.email.toLowerCase(), member.id);
    }
  }

  // ── Setup: Position tracking per column ────────────────────────────

  const positionByColumn = new Map<string, number>();
  const columnIds = new Set<string>();
  for (const t of cappedTasks) {
    const colId = t.columnName
      ? columnMapping[t.columnName] ?? defaultColumnId
      : defaultColumnId;
    columnIds.add(colId);
  }

  for (const colId of columnIds) {
    const existing = columns.find((c) => c.id === colId);
    if (existing && existing.tasks.length > 0) {
      positionByColumn.set(
        colId,
        Math.max(...existing.tasks.map((t) => t.position))
      );
    } else {
      positionByColumn.set(colId, -POSITION_GAP);
    }
  }

  // ── Sequential insert loop ─────────────────────────────────────────

  let created = 0;

  for (let i = 0; i < cappedTasks.length; i++) {
    if (signal?.aborted) break;

    const t = cappedTasks[i];
    const colId = t.columnName
      ? columnMapping[t.columnName] ?? defaultColumnId
      : defaultColumnId;

    const pos = (positionByColumn.get(colId) ?? -POSITION_GAP) + POSITION_GAP;
    positionByColumn.set(colId, pos);

    const assigneeId = t.assigneeName
      ? assigneeMap.get(t.assigneeName.toLowerCase()) ?? null
      : null;

    const taskRow = {
      idea_id: ideaId,
      column_id: colId,
      title: t.title,
      description: t.description ?? null,
      assignee_id: assigneeId,
      position: pos,
      due_date: t.dueDate ?? null,
    };

    // Insert with one retry
    let taskId: string | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const { data, error } = await supabase
        .from("board_tasks")
        .insert(taskRow)
        .select("id")
        .single();

      if (!error && data) {
        taskId = data.id;
        break;
      }

      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      } else {
        failed.push({ index: i, title: t.title, error: error?.message ?? "Unknown error" });
        callbacks.onTaskError(i, t.title, error?.message ?? "Unknown error");
      }
    }

    if (!taskId) continue;

    // Insert labels for this task
    if (t.labels && t.labels.length > 0) {
      const labelRows = t.labels
        .map((name) => {
          const labelId = labelMap.get(name.toLowerCase());
          return labelId ? { task_id: taskId!, label_id: labelId } : null;
        })
        .filter(Boolean) as { task_id: string; label_id: string }[];

      if (labelRows.length > 0) {
        await supabase.from("board_task_labels").insert(labelRows);
      }
    }

    // Insert checklist items for this task
    if (t.checklistItems && t.checklistItems.length > 0) {
      const checklistRows = t.checklistItems.map((title, ci) => ({
        task_id: taskId!,
        idea_id: ideaId,
        title,
        position: ci * POSITION_GAP,
      }));
      await supabase.from("board_checklist_items").insert(checklistRows);
    }

    // Log activity (fire-and-forget)
    supabase
      .from("board_task_activity")
      .insert({
        task_id: taskId,
        idea_id: ideaId,
        actor_id: currentUserId,
        action: "ai_generated",
        details: null,
      })
      .then(({ error }) => {
        if (error) console.error("Activity log failed:", error.message);
      });

    created++;
    callbacks.onTaskCreated(i, t.title);

    // Throttle between inserts (skip after last task)
    if (i < cappedTasks.length - 1 && !signal?.aborted) {
      await new Promise((r) => setTimeout(r, THROTTLE_MS));
    }
  }

  return { created, failed, columnsCreated, labelsCreated };
}
