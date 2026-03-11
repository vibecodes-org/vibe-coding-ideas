/**
 * Formats the `details` JSONB from board_task_activity into a human-readable suffix.
 *
 * Details shapes per action type:
 *   title_changed:             { from: string, to: string }
 *   moved:                     { to_column: string }
 *   assigned:                  { assignee_name: string } (UI) or { assignee_id: string } (MCP)
 *   unassigned:                {} | { assignee_id: string }
 *   due_date_set:              { due_date: string } (MCP only)
 *   label_added/label_removed: { label_name: string }
 *   checklist_item_added:      { title: string } (UI) or { item_title: string } (MCP) — legacy name, now "workflow step added"
 *   checklist_item_completed:  { title: string } (UI) or { item_title: string } (MCP) — legacy name, now "workflow step completed"
 *   attachment_added/removed:  { file_name: string }
 */
export function formatActivityDetails(
  action: string,
  details: Record<string, unknown> | null
): string | null {
  if (!details) return null;

  switch (action) {
    case "title_changed": {
      const from = details.from as string | undefined;
      const to = details.to as string | undefined;
      if (from && to) return `from "${from}" to "${to}"`;
      if (to) return `to "${to}"`;
      return null;
    }

    case "moved": {
      const col = details.to_column as string | undefined;
      return col ? `to ${col}` : null;
    }

    case "assigned": {
      const name = details.assignee_name as string | undefined;
      return name ? `to ${name}` : null;
    }

    case "due_date_set": {
      const raw = details.due_date as string | undefined;
      if (!raw) return null;
      const date = new Date(raw);
      return `to ${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
    }

    case "label_added":
    case "label_removed": {
      const name = details.label_name as string | undefined;
      return name ? `"${name}"` : null;
    }

    case "checklist_item_added":
    case "checklist_item_completed": {
      const title =
        (details.title as string | undefined) ??
        (details.item_title as string | undefined);
      return title ? `"${title}"` : null;
    }

    case "attachment_added":
    case "attachment_removed": {
      const name = details.file_name as string | undefined;
      return name ? `"${name}"` : null;
    }

    default:
      return null;
  }
}

/** Session gap threshold for grouping bot activity (30 minutes). */
export const SESSION_GAP_MS = 30 * 60 * 1000;

/**
 * Groups a chronologically-sorted (newest-first) list of entries into sessions
 * based on timestamp gaps. Entries more than `SESSION_GAP_MS` apart start a new session.
 */
export function groupIntoSessions<T extends { created_at: string }>(
  entries: T[]
): T[][] {
  if (entries.length === 0) return [];

  const sessions: T[][] = [[entries[0]]];

  for (let i = 1; i < entries.length; i++) {
    const prev = new Date(entries[i - 1].created_at).getTime();
    const curr = new Date(entries[i].created_at).getTime();
    // Entries are newest-first, so prev >= curr
    if (prev - curr > SESSION_GAP_MS) {
      sessions.push([entries[i]]);
    } else {
      sessions[sessions.length - 1].push(entries[i]);
    }
  }

  return sessions;
}
