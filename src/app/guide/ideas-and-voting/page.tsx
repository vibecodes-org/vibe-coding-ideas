import Link from "next/link";
import { Lightbulb, ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export const metadata = {
  title: "Ideas & Voting Guide",
  description:
    "How ideas work on VibeCodes — statuses, voting, threaded comments, and visibility settings.",
};

export default function IdeasAndVotingPage() {
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
          <Lightbulb className="h-6 w-6 text-amber-400" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Ideas & Voting</h1>
      </div>

      <div className="space-y-10">
        <section>
          <h2 className="mb-4 text-2xl font-semibold">Idea Lifecycle</h2>
          <p className="mb-4 text-muted-foreground">
            Every idea goes through a status lifecycle. Only the author can
            change the status.
          </p>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">Open</Badge>
            <span className="text-muted-foreground">&rarr;</span>
            <Badge variant="secondary">In Progress</Badge>
            <span className="text-muted-foreground">&rarr;</span>
            <Badge variant="secondary">Completed</Badge>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Ideas can also be <strong className="text-foreground">Archived</strong> at
            any stage. Archived ideas are still visible but clearly marked.
          </p>
          <p className="mt-3 text-sm text-muted-foreground">
            Each idea on the dashboard displays an{" "}
            <strong className="text-foreground">Idea Health</strong> indicator
            — a score based on board activity, agent allocation, and workflow
            coverage that helps you gauge project momentum at a glance.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">Voting</h2>
          <p className="mb-4 text-muted-foreground">
            Show support for ideas you like by upvoting them. Votes use{" "}
            <strong className="text-foreground">optimistic updates</strong> — the
            UI updates instantly while the server catches up in the background.
          </p>
          <ul className="list-inside list-disc space-y-2 text-muted-foreground">
            <li>Click the upvote button to vote; click again to remove your vote</li>
            <li>Vote counts are visible on idea cards and detail pages</li>
            <li>The idea author gets a notification when someone votes</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">Comments</h2>
          <p className="mb-4 text-muted-foreground">
            Every idea has a threaded comment section. Comments support{" "}
            <strong className="text-foreground">full markdown</strong>{" "}
            — headings, code blocks, lists, links, and tables — and come in
            three types:
          </p>
          <ul className="mb-4 list-inside list-disc space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">Comment</strong> — general
              discussion
            </li>
            <li>
              <strong className="text-foreground">Suggestion</strong> — propose
              a change or improvement
            </li>
            <li>
              <strong className="text-foreground">Question</strong> — ask the
              author for clarification
            </li>
          </ul>
          <p className="text-muted-foreground">
            The idea author can mark suggestions as{" "}
            <strong className="text-foreground">incorporated</strong> to show
            the feedback was acted on.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">Visibility</h2>
          <p className="mb-4 text-muted-foreground">
            Ideas can be <strong className="text-foreground">public</strong> or{" "}
            <strong className="text-foreground">private</strong>:
          </p>
          <ul className="list-inside list-disc space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">Public</strong> — visible to
              everyone in the feed and on your profile
            </li>
            <li>
              <strong className="text-foreground">Private</strong> — only
              visible to you, your collaborators, and admins
            </li>
          </ul>
          <div className="mt-4 rounded-xl border border-border bg-muted/30 p-6">
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">Tip:</strong> Private ideas are
              great for work-in-progress concepts you want to develop with a
              select group before sharing publicly.
            </p>
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">AI Enhancement</h2>
          <p className="mb-4 text-muted-foreground">
            If your account has <strong className="text-foreground">AI
            enabled</strong>, you can use AI to improve your idea descriptions.
            On the idea detail page, click the{" "}
            <strong className="text-foreground">&quot;Enhance with AI&quot;</strong>{" "}
            button to open the enhancement dialog.
          </p>
          <ul className="mb-4 list-inside list-disc space-y-2 text-muted-foreground">
            <li>
              Choose an optional <strong className="text-foreground">AI
              persona</strong> — any of your active agent profiles can be used to
              guide the AI&apos;s style and focus
            </li>
            <li>
              Edit the <strong className="text-foreground">prompt</strong> to
              tell the AI what to focus on (structure, technical detail,
              audience, etc.)
            </li>
            <li>
              Compare the <strong className="text-foreground">original vs
              enhanced</strong> description side-by-side
            </li>
            <li>
              <strong className="text-foreground">Apply</strong> the enhanced
              version, <strong className="text-foreground">Try Again</strong>{" "}
              with a different prompt, or cancel
            </li>
          </ul>
          <div className="rounded-xl border border-border bg-muted/30 p-6">
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">Tip:</strong> Only the idea
              author can enhance descriptions. The AI uses Claude to rewrite
              your description while preserving your core intent.
            </p>
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">Inline Editing</h2>
          <p className="mb-4 text-muted-foreground">
            As the author, you can edit your idea directly on the detail page
            — no separate edit page needed. Everything saves automatically:
          </p>
          <ul className="mb-4 list-inside list-disc space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">Title</strong> — click to
              edit, saves on blur
            </li>
            <li>
              <strong className="text-foreground">Description</strong> — click
              to edit with a markdown editor, saves on blur
            </li>
            <li>
              <strong className="text-foreground">Tags</strong> — edit inline
              with auto-save (300ms debounce)
            </li>
            <li>
              <strong className="text-foreground">GitHub URL</strong> — click
              to add or edit the linked repository
            </li>
            <li>
              <strong className="text-foreground">Visibility</strong> — toggle
              the badge between Public and Private
            </li>
          </ul>
          <p className="mb-4 text-muted-foreground">
            Non-authors see a read-only view. Descriptions support{" "}
            <strong className="text-foreground">full markdown</strong>{" "}
            — headings, code blocks, lists, links, and tables.
          </p>
          <p className="text-muted-foreground">
            You can also <strong className="text-foreground">delete</strong>{" "}
            your idea, which removes it and all associated data (comments,
            votes, board, etc.) permanently.
          </p>
        </section>
      </div>

    </div>
  );
}
