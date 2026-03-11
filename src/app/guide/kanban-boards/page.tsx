import Link from "next/link";
import { LayoutDashboard, ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata = {
  title: "Kanban Boards Guide",
  description:
    "Manage tasks with drag-and-drop boards, labels, due dates, workflow steps, file attachments, and bulk import on VibeCodes.",
};

export default function KanbanBoardsPage() {
  return (
    <div>
      <Link
        href="/guide"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Guide
      </Link>

      <div className="mb-10 flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
          <LayoutDashboard className="h-6 w-6 text-primary" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Kanban Boards</h1>
      </div>

      <div className="space-y-10">
        <section>
          <h2 className="mb-4 text-2xl font-semibold">Overview</h2>
          <p className="text-muted-foreground">
            Every idea gets its own kanban board for project management. Boards
            are accessible to the idea author and all collaborators. The first
            time you visit a board, it&apos;s initialized with three default
            columns: <strong className="text-foreground">To Do</strong>,{" "}
            <strong className="text-foreground">In Progress</strong>, and{" "}
            <strong className="text-foreground">Done</strong>.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">Tasks</h2>
          <p className="mb-4 text-muted-foreground">
            Tasks are the building blocks of your board. Click any task card to
            open the <strong className="text-foreground">detail dialog</strong>{" "}
            where you can edit all properties. Each task supports:
          </p>
          <ul className="list-inside list-disc space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">Title & Description</strong>{" "}
              — markdown-supported description for detailed specs. Type{" "}
              <strong className="text-foreground">@</strong> in descriptions to
              mention team members, just like in comments.
            </li>
            <li>
              <strong className="text-foreground">Assignee</strong> — assign to
              any team member (author + collaborators) or your AI agents
            </li>
            <li>
              <strong className="text-foreground">Labels</strong> — colored
              labels for categorization (per-idea, 12 colors)
            </li>
            <li>
              <strong className="text-foreground">Due Date</strong> — track
              deadlines with visual overdue/upcoming indicators
            </li>
            <li>
              <strong className="text-foreground">Workflow Steps</strong> — break
              tasks into steps with progress tracking
            </li>
            <li>
              <strong className="text-foreground">Comments</strong> — discuss
              tasks with your team, with @mention support for notifications
            </li>
            <li>
              <strong className="text-foreground">File Attachments</strong>{" "}
              — upload images, documents, and other files (up to 10MB each)
            </li>
            <li>
              <strong className="text-foreground">Cover Image</strong> — set
              any attached image as the task&apos;s cover, shown on the card
            </li>
            <li>
              <strong className="text-foreground">Activity Log</strong> — full
              history of all changes to the task
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">Drag & Drop</h2>
          <p className="mb-4 text-muted-foreground">
            Move tasks between columns by dragging and dropping. The board uses
            optimistic updates — changes appear instantly while syncing in the
            background.
          </p>
          <ul className="list-inside list-disc space-y-2 text-muted-foreground">
            <li>
              Drag tasks between columns to update their status
            </li>
            <li>Reorder tasks within a column</li>
            <li>
              Reorder columns by dragging the column header
            </li>
            <li>
              Works on both desktop (mouse) and mobile (touch)
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">Columns</h2>
          <p className="mb-4 text-muted-foreground">
            Customize your workflow by adding, renaming, or reordering columns.
          </p>
          <ul className="list-inside list-disc space-y-2 text-muted-foreground">
            <li>Add new columns with the + button</li>
            <li>Rename columns by clicking the edit icon in the header</li>
            <li>
              Mark any column as a{" "}
              <strong className="text-foreground">Done column</strong> — tasks
              in done columns are excluded from dashboard task counts
            </li>
            <li>
              <strong className="text-foreground">Archive all tasks</strong>{" "}
              in a column from the column menu
            </li>
            <li>Delete empty columns (move or archive tasks first)</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">Search & Filters</h2>
          <p className="mb-4 text-muted-foreground">
            Use the board toolbar to find specific tasks:
          </p>
          <ul className="list-inside list-disc space-y-2 text-muted-foreground">
            <li>Search by task title</li>
            <li>Filter by assignee</li>
            <li>Filter by label</li>
            <li>Filter by due date (overdue, due soon)</li>
            <li>Toggle visibility of archived tasks</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">Bulk Import</h2>
          <p className="mb-4 text-muted-foreground">
            Migrate tasks from other tools or quickly add many tasks at once.
            The import dialog supports three formats:
          </p>
          <ul className="mb-4 list-inside list-disc space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">CSV</strong> — with
              auto-mapping of column headers
            </li>
            <li>
              <strong className="text-foreground">JSON</strong> — Trello export
              format or custom JSON
            </li>
            <li>
              <strong className="text-foreground">Bulk Text</strong> — paste a
              list of task titles, one per line
            </li>
          </ul>
          <div className="rounded-xl border border-border bg-muted/30 p-6">
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">Tip:</strong> CSV import
              auto-maps column names case-insensitively and lets you map columns
              to existing board columns or create new ones. Up to 500 tasks per
              import.
            </p>
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">AI Task Generation</h2>
          <p className="mb-4 text-muted-foreground">
            If AI is enabled for your account, the board toolbar includes an{" "}
            <strong className="text-foreground">&quot;AI Generate&quot;</strong>{" "}
            button. This uses AI to automatically generate tasks for your board
            based on the idea description.
          </p>
          <ul className="mb-4 list-inside list-disc space-y-2 text-muted-foreground">
            <li>
              Choose an optional <strong className="text-foreground">AI
              persona</strong> from your active agents to guide the AI&apos;s
              focus (e.g., a QA agent generates test-focused tasks)
            </li>
            <li>
              Write a <strong className="text-foreground">prompt</strong>{" "}
              describing what kind of tasks you want generated
            </li>
            <li>
              Choose <strong className="text-foreground">Add</strong> mode
              (append to existing tasks) or{" "}
              <strong className="text-foreground">Replace</strong> mode (clear
              the board first)
            </li>
            <li>
              Preview the generated tasks in a table before applying
            </li>
            <li>
              Click <strong className="text-foreground">Apply All</strong> to
              add them to your board — tasks are placed in the appropriate
              columns with labels and descriptions
            </li>
          </ul>
          <div className="rounded-xl border border-border bg-muted/30 p-6">
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">Tip:</strong> AI generation
              uses the same bulk import pipeline under the hood, so it handles
              label and column creation automatically.
            </p>
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">Workflows</h2>
          <p className="mb-4 text-muted-foreground">
            The <strong className="text-foreground">Workflows</strong> tab on
            each board lets you define reusable step-by-step processes for
            tasks. Workflows are ideal for repeatable processes like bug
            triage, feature development, or content review.
          </p>
          <ul className="mb-4 list-inside list-disc space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">Templates</strong> — define
              ordered steps with roles (e.g., &quot;Dev&quot;, &quot;QA&quot;)
              and optional approval gates
            </li>
            <li>
              <strong className="text-foreground">Apply to tasks</strong>{" "}
              — use the &quot;Apply Workflow&quot; button on any task, or set
              up auto-rules to apply automatically when a label is added
            </li>
            <li>
              <strong className="text-foreground">Step lifecycle</strong>{" "}
              — steps progress through pending, in progress, completed, or
              failed. Click any step to see its full details, output, and
              comments
            </li>
            <li>
              <strong className="text-foreground">Approval gates</strong>{" "}
              — steps marked as gates pause for human review. Approve or
              request changes directly from the task detail dialog
            </li>
            <li>
              <strong className="text-foreground">Agent execution</strong>{" "}
              — agents can execute workflow steps via MCP tools, with context
              from previous steps passed forward automatically
            </li>
            <li>
              <strong className="text-foreground">Template library</strong>{" "}
              — import pre-built templates (Feature Development, Bug Fix, etc.)
              from the admin-managed library
            </li>
          </ul>
          <div className="rounded-xl border border-border bg-muted/30 p-6">
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">Tip:</strong> Set up an
              auto-rule mapping the &quot;bug&quot; label to a Bug Fix workflow
              template. Every time a task is labelled as a bug, the workflow
              steps are automatically applied.
            </p>
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">Real-time Sync</h2>
          <p className="mb-4 text-muted-foreground">
            All board changes are synced in real-time via Supabase Realtime. If
            a collaborator moves a task or adds a comment, you&apos;ll see the
            update immediately without refreshing.
          </p>
          <p className="text-muted-foreground">
            All board actions — creating tasks, moving between columns, adding
            labels, archiving — use{" "}
            <strong className="text-foreground">optimistic updates</strong>.
            Changes appear instantly in your browser with automatic rollback if
            something goes wrong.
          </p>
        </section>
      </div>

      <div className="mt-12 flex justify-between border-t border-border pt-6">
        <Link href="/guide/discussions">
          <Button variant="outline" className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Discussions
          </Button>
        </Link>
        <Link href="/guide/mcp-integration">
          <Button variant="outline" className="gap-2">
            MCP Integration
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      </div>
    </div>
  );
}
