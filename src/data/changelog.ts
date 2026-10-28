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
    isoDate: "2026-10-28",
    date: "28 October 2026",
    title: "Token usage: see whether costs are going up or down",
    items: [
      {
        type: "feature",
        description:
          "The admin Reports tab is now Token usage. Above the tables it has three charts: cost per week (or per day for 30 days) split by model with the dates cost-saving changes went live marked, the typical cost of a finished run for each busy workflow, and the share of runs sent back at least once.",
      },
      {
        type: "improvement",
        description: "The admin AI Usage tab is now called In-app AI, since it only covers the app's own AI buttons.",
      },
    ],
  },
  {
    isoDate: "2026-10-24",
    date: "24 October 2026",
    title: "Shorter workflow replies, helpers save their own write-ups",
    items: [
      {
        type: "improvement",
        description:
          "Claiming a workflow step now sends a much shorter hand-off. The earlier steps are listed instead of pasted in; the helper reads the ones it needs with `get_task` and `step_ids`. The assigned agent is no longer repeated when the helper already carries it.",
      },
      {
        type: "improvement",
        description:
          "`get_task` returns a short card by default: the current run's steps as one line each, the latest 5 comments and no activity log. Pass `step_ids` to read earlier steps in full, or `full: true` for everything.",
      },
      {
        type: "improvement",
        description:
          "`complete_step`, `fail_step`, `skip_step` and `approve_step` report `output_chars` instead of echoing the write-up back. `list_workflow_templates` returns a summary unless you ask for one template or `include_steps`, and template edits reply with a compact step list.",
      },
      {
        type: "improvement",
        description:
          "`get_agent_prompt` takes `as_persona: true` to return an agent's persona exactly as a hand-off would embed it.",
      },
      {
        type: "feature",
        description:
          "New `save_step_output` tool: a step's helper saves its full write-up on the board itself (only with the step's work token, only while the step is running; a second save replaces the first) and hands back a short summary. The write-up no longer passes through the session that runs the workflow.",
      },
      {
        type: "improvement",
        description:
          "`complete_step` uses the helper's saved write-up and ignores pasted text when one is saved, so a shortened copy can't overwrite the full one. With nothing saved and no `output`, it refuses and changes nothing. `fail_step` can use the saved write-up as the failure text.",
      },
      {
        type: "fix",
        description:
          "Rework feedback now reaches a step once. `rework_instructions` carries the newest round plus a count of older rounds, and steps that weren't sent back see it labelled as background instead of being told they failed.",
      },
    ],
  },
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
