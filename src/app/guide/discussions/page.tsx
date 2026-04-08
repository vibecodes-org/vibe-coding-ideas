import Link from "next/link";
import { MessageSquare, ArrowLeft } from "lucide-react";

export const metadata = {
  title: "Discussions Guide",
  description:
    "Plan features with threaded discussions, vote on proposals, convert threads to board tasks, and @mention teammates.",
};

export default function DiscussionsPage() {
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
          <MessageSquare className="h-6 w-6 text-violet-400" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Discussions</h1>
      </div>

      <div className="space-y-10">
        <section>
          <h2 className="mb-4 text-2xl font-semibold">Overview</h2>
          <p className="text-muted-foreground">
            Discussions are{" "}
            <strong className="text-foreground">
              titled, threaded conversations
            </strong>{" "}
            attached to each idea. Use them for planning, proposals, design
            decisions, and anything that needs more structure than a quick
            comment. Unlike idea comments, discussions have their own title,
            status workflow, voting, and can be converted into board tasks.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">
            Creating a Discussion
          </h2>
          <p className="mb-4 text-muted-foreground">
            Navigate to an idea and click the{" "}
            <strong className="text-foreground">Discussions</strong> tab, then{" "}
            <strong className="text-foreground">New Discussion</strong>:
          </p>
          <ol className="list-inside list-decimal space-y-2 text-muted-foreground">
            <li>
              Give it a clear <strong className="text-foreground">title</strong>{" "}
              (e.g., &quot;Auth strategy: JWT vs sessions&quot;)
            </li>
            <li>
              Write the{" "}
              <strong className="text-foreground">body in markdown</strong> —
              describe the proposal, question, or topic
            </li>
            <li>Click Create</li>
          </ol>
          <p className="mt-3 text-muted-foreground">
            All team members (author + collaborators) can create discussions.
            Public idea discussions are visible to all authenticated users.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">Replies & Threading</h2>
          <p className="mb-4 text-muted-foreground">
            Discussions support{" "}
            <strong className="text-foreground">single-level threading</strong>.
            Each reply can have nested replies one level deep, keeping
            conversations focused without getting too deeply nested.
          </p>
          <ul className="list-inside list-disc space-y-2 text-muted-foreground">
            <li>Reply to the main discussion or to a specific reply</li>
            <li>Edit or delete your own replies</li>
            <li>
              Use{" "}
              <strong className="text-foreground">
                @mentions
              </strong>{" "}
              to notify specific team members
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">Voting</h2>
          <p className="text-muted-foreground">
            Upvote discussions and replies to signal agreement or importance.
            Vote counts are displayed on each discussion in the list view,
            helping the team prioritise which proposals to act on first.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">Status Workflow</h2>
          <p className="mb-4 text-muted-foreground">
            Every discussion has a status that tracks its lifecycle:
          </p>
          <div className="space-y-3">
            <div className="rounded-lg border border-border p-4">
              <h3 className="font-medium">Open</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Active discussion — the default status when created.
              </p>
            </div>
            <div className="rounded-lg border border-border p-4">
              <h3 className="font-medium">Resolved</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                The discussion has been concluded. No further action needed.
              </p>
            </div>
            <div className="rounded-lg border border-border p-4">
              <h3 className="font-medium">Ready to Convert</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                The discussion is queued for conversion into a board task. Use
                this when a discussion has reached a decision that needs to be
                implemented.
              </p>
            </div>
            <div className="rounded-lg border border-border p-4">
              <h3 className="font-medium">Converted</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                A board task has been created from this discussion. The task
                links back to the original thread for context.
              </p>
            </div>
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">
            Converting to Board Tasks
          </h2>
          <p className="mb-4 text-muted-foreground">
            When a discussion reaches a decision, you can turn it into
            actionable work:
          </p>
          <ol className="list-inside list-decimal space-y-2 text-muted-foreground">
            <li>
              Mark the discussion as{" "}
              <strong className="text-foreground">Ready to Convert</strong>
            </li>
            <li>
              Click{" "}
              <strong className="text-foreground">Convert to Task</strong> — a
              new board task is created with the discussion title and a link
              back to the thread
            </li>
            <li>
              The discussion status changes to{" "}
              <strong className="text-foreground">Converted</strong>{" "}
              automatically
            </li>
          </ol>
          <div className="mt-4 rounded-xl border border-border bg-muted/30 p-6">
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">Tip:</strong> AI agents
              connected via MCP can use the{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                get_discussions_ready_to_convert
              </code>{" "}
              tool to find discussions waiting for conversion and act on them.
            </p>
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">
            AI Enhancement
          </h2>
          <p className="text-muted-foreground">
            Discussions include an{" "}
            <strong className="text-foreground">AI Enhance</strong> button that
            can help refine your discussion body — expanding on ideas,
            improving structure, or adding detail. This uses the same AI
            credits as other AI features.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">Notifications</h2>
          <p className="mb-4 text-muted-foreground">
            Discussion activity generates notifications to keep your team in
            the loop:
          </p>
          <ul className="list-inside list-disc space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">New discussion</strong>{" "}
              — team members are notified when a discussion is created
            </li>
            <li>
              <strong className="text-foreground">New reply</strong>{" "}
              — the discussion author and participants are notified
            </li>
            <li>
              <strong className="text-foreground">@mentions</strong>{" "}
              — mentioned users get a specific mention notification
            </li>
          </ul>
          <p className="mt-3 text-muted-foreground">
            Discussion notifications can be configured in your profile settings
            under the <strong className="text-foreground">Discussions</strong>{" "}
            toggle.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">Pinning</h2>
          <p className="text-muted-foreground">
            Important discussions can be{" "}
            <strong className="text-foreground">pinned</strong> to the top of
            the discussion list, making them easy to find for new team members
            or ongoing reference.
          </p>
        </section>
      </div>

    </div>
  );
}
