import Link from "next/link";
import { LayoutDashboard, ArrowLeft } from "lucide-react";

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
          <LayoutDashboard className="h-6 w-6 text-blue-400" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Kanban Boards</h1>
      </div>

      <div className="space-y-10">
        <section>
          <h2 className="mb-4 text-2xl font-semibold">Overview</h2>
          <p className="text-muted-foreground">
            Every idea gets its own kanban board for project management. Boards
            are accessible to the idea author and all collaborators. New boards
            start with six columns:{" "}
            <strong className="text-foreground">Backlog</strong>,{" "}
            <strong className="text-foreground">To Do</strong>,{" "}
            <strong className="text-foreground">Blocked/Requires User Input</strong>,{" "}
            <strong className="text-foreground">In Progress</strong>,{" "}
            <strong className="text-foreground">Verify</strong> and{" "}
            <strong className="text-foreground">Done</strong>. You can choose
            your own set in{" "}
            <Link href="/guide/settings" className="text-primary hover:underline">
              Settings
            </Link>{" "}
            under Board Defaults. When a{" "}
            <Link href="/guide/project-kits" className="text-primary hover:underline">
              project type
            </Link>{" "}
            is applied (in the New Idea form, the welcome steps, the setup
            banner, or from Claude Code or Codex), the board comes
            pre-configured with labels, workflows and label rules tailored to
            your project type, without adding any cards. The board has three
            tabs: <strong className="text-foreground">Board</strong>,{" "}
            <strong className="text-foreground">Workflows</strong> and{" "}
            <strong className="text-foreground">AI Team</strong>.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">Board Switcher</h2>
          <p className="text-muted-foreground">
            The Board Switcher in the navbar lets you quickly jump between
            your recent boards without navigating back to the dashboard. It
            shows your 5 most recently active boards.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">Board Setup Banner</h2>
          <p className="mb-4 text-muted-foreground">
            A setup banner at the top of the board points out what is still
            missing. It checks for:
          </p>
          <ul className="list-inside list-disc space-y-2 text-muted-foreground">
            <li>An AI team (agents added to the board, and allocated)</li>
            <li>Workflows</li>
            <li>Label rules, so labels start the right workflow</li>
            <li>Workflow roles that no agent covers yet</li>
            <li>Labels</li>
          </ul>
          <p className="mt-4 text-muted-foreground">
            If the board has no workflows yet, the banner offers{" "}
            <strong className="text-foreground">Apply a Kit</strong> (a project
            type). You can dismiss the banner; it stays away for that browser
            session unless more gaps appear. Connecting Claude Code or Codex has
            its own separate banner.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">Empty Boards</h2>
          <p className="text-muted-foreground">
            A board with no cards offers{" "}
            <strong className="text-foreground">Get started with AI</strong>:
            let AI turn your idea into columns, cards and labels, or add AI
            agents first.
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
              labels for categorization (per-idea, 10 colours)
            </li>
            <li>
              <strong className="text-foreground">Workflow (when creating)</strong>{" "}
              — the New Task dialog shows which workflow your labels will attach
              (&quot;Automatic&quot;) and lets you pick another, or none, before
              you press Create
            </li>
            <li>
              <strong className="text-foreground">Due Date</strong> — track
              deadlines with visual overdue/upcoming indicators
            </li>
            <li>
              <strong className="text-foreground">Workflow Steps</strong> — break
              tasks into steps with progress tracking. When a task has an
              attached workflow, its card shows the workflow name with a{" "}
              <strong className="text-foreground">completed / total</strong> step
              count for its newest run, and a progress bar
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
            <li>
              Rename a column from its <strong className="text-foreground">…</strong>{" "}
              menu, then <strong className="text-foreground">Edit</strong>
            </li>
            <li>
              Mark any column as a{" "}
              <strong className="text-foreground">Done column</strong> — tasks
              in done columns are excluded from dashboard task counts
            </li>
            <li>
              <strong className="text-foreground">Archive all</strong> shows in
              the menu of a Done column that has cards in it
            </li>
            <li>
              Delete any column from the same menu. Its cards are deleted with
              it, and you get 5 seconds to undo
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">Search & Filters</h2>
          <p className="mb-4 text-muted-foreground">
            Use the board toolbar to find specific tasks:
          </p>
          <ul className="list-inside list-disc space-y-2 text-muted-foreground">
            <li>Search by task title and description</li>
            <li>Filter by assignee</li>
            <li>Filter by label (a card must have every label you pick)</li>
            <li>Filter by due date (overdue, or due soon: less than 24 hours away)</li>
            <li>Toggle visibility of archived tasks</li>
          </ul>
          <p className="mt-4 text-muted-foreground">
            While a search or filter is on, each column header shows how many of
            its tasks match, for example <strong className="text-foreground">(3 of 40)</strong>.
          </p>
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
            The board toolbar has an{" "}
            <strong className="text-foreground">AI Generate Tasks</strong>{" "}
            button (the empty board offers it too). Everyone sees it; it is
            greyed out when you have no credits left and no API key of your
            own. It uses AI to generate tasks for your board based on the idea
            description.
          </p>
          <ul className="mb-4 list-inside list-disc space-y-2 text-muted-foreground">
            <li>
              Optionally write a <strong className="text-foreground">prompt</strong>{" "}
              to steer the result (e.g., &quot;focus on the payment
              features&quot;). The box starts empty and you can generate
              without typing anything
            </li>
            <li>
              The AI covers everything your idea describes, later phases
              included, and decides how many tasks that takes. Each task is a
              whole piece of work with a short description of what it delivers
              and a <strong className="text-foreground">Done when</strong>{" "}
              list that says how you can tell it is finished, not a step-by-step
              how-to
            </li>
            <li>
              Choose <strong className="text-foreground">Add</strong> mode
              (only adds what the tasks already on the board don&apos;t cover)
              or{" "}
              <strong className="text-foreground">Replace</strong> mode (clear
              the board first)
            </li>
            <li>
              Preview the generated tasks and tick the ones you want
            </li>
            <li>
              Click <strong className="text-foreground">Apply N Tasks</strong>{" "}
              to add the ticked ones to your board — tasks are placed in the
              appropriate columns with labels and descriptions.{" "}
              <strong className="text-foreground">Regenerate</strong> tries
              again
            </li>
          </ul>
          <div className="rounded-xl border border-border bg-muted/30 p-6">
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">Tip:</strong> AI generation
              uses the same bulk import pipeline under the hood, so it handles
              label and column creation automatically. If a long list is cut
              short, use <strong className="text-foreground">Generate the
              rest</strong> to add the missing tasks.
            </p>
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">Launch Claude Code or Codex</h2>
          <p className="mb-4 text-muted-foreground">
            On desktop, the board toolbar has a{" "}
            <strong className="text-foreground">Launch</strong>{" "}
            button (and each task card and detail view has a launch option) that
            starts Claude Code or Codex already connected to this board, ready
            to pick up the top unstarted task — or the specific task you
            launched from. The agent can run in the browser terminal (Beta),
            docked under your cards, or in a terminal window on your computer;
            the arrow beside the button offers every way.
          </p>
          <p className="text-muted-foreground">
            <Link
              href="/guide/launching-claude-code"
              className="text-primary hover:underline"
            >
              Read the full Launching Claude Code or Codex guide &rarr;
            </Link>
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">Workflows</h2>
          <p className="mb-4 text-muted-foreground">
            The <strong className="text-foreground">Workflows</strong> tab on
            each board lets you define reusable, multi-step processes for
            tasks — with role-based agent matching, approval gates, context
            chaining between steps, and auto-application via labels. You can see
            and change which workflow a new task gets right in the New Task
            dialog.
          </p>
          <p className="text-muted-foreground">
            Workflows are a core feature of VibeCodes.{" "}
            <Link
              href="/guide/workflows"
              className="text-primary hover:underline"
            >
              Read the full Workflows guide &rarr;
            </Link>
          </p>
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

    </div>
  );
}
