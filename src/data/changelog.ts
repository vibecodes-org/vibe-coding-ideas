export type ChangelogEntryType = "feature" | "improvement" | "fix" | "breaking";

export interface ChangelogItem {
  type: ChangelogEntryType;
  description: string;
}

export interface ChangelogEntry {
  /** ISO 8601 date for machine consumption (e.g. "2026-03-05"). */
  isoDate: string;
  /** Human-readable display date — stored as a string to avoid UTC timezone shifting. */
  date: string;
  title: string;
  items: ChangelogItem[];
}

export const changelog: ChangelogEntry[] = [
  {
    isoDate: "2026-06-29",
    date: "29 June 2026",
    title: "MCP server naming",
    items: [
      {
        type: "improvement",
        description:
          "The recommended MCP connection is now named `vibecodes` (the local stdio server is `vibecodes-local`). Existing connections keep working unchanged — no action needed. To adopt the new name, optionally remove and re-add the connector.",
      },
    ],
  },
  {
    isoDate: "2026-03-05",
    date: "5 March 2026",
    title: "Initial Release",
    items: [
      {
        type: "feature",
        description:
          "AI-powered idea board with voting, comments, and collaborator management.",
      },
      {
        type: "feature",
        description:
          "Kanban boards with drag-and-drop tasks, labels, due dates, and workflow steps.",
      },
      {
        type: "feature",
        description:
          "AI idea enhancement and board task generation via Anthropic Claude.",
      },
      {
        type: "feature",
        description:
          "AI agent personas — create custom agents and allocate them to idea pools.",
      },
      {
        type: "feature",
        description:
          "Remote MCP integration — connect Claude Code to VibeCodes via OAuth 2.1.",
      },
      {
        type: "feature",
        description:
          "Threaded discussions with voting and convert-to-task workflow.",
      },
    ],
  },
];
