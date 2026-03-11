import Link from "next/link";
import { Rocket, ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata = {
  title: "Getting Started Guide",
  description:
    "Create your account, explore the idea feed, and submit your first idea on VibeCodes.",
};

export default function GettingStartedPage() {
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
          <Rocket className="h-6 w-6 text-primary" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Getting Started</h1>
      </div>

      <div className="space-y-10">
        <section>
          <h2 className="mb-4 text-2xl font-semibold">Create Your Account</h2>
          <p className="mb-4 text-muted-foreground">
            VibeCodes supports three ways to sign up:
          </p>
          <ul className="mb-4 list-inside list-disc space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">GitHub OAuth</strong> — one
              click, pulls your profile picture and name automatically
            </li>
            <li>
              <strong className="text-foreground">Google OAuth</strong> — same
              one-click experience with your Google account
            </li>
            <li>
              <strong className="text-foreground">Email & Password</strong> —
              traditional signup with email verification
            </li>
          </ul>
          <p className="mb-4 text-muted-foreground">
            After signing up, you can edit your profile to add a bio, change
            your display name, upload a custom avatar, and optionally add your
            GitHub username and contact info.
          </p>
          <p className="text-muted-foreground">
            Forgot your password? Use the{" "}
            <strong className="text-foreground">reset link</strong> on the login
            page to receive a password reset email.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">Explore the Feed</h2>
          <p className="mb-4 text-muted-foreground">
            The <strong className="text-foreground">Feed</strong> is where all
            public ideas live. You can:
          </p>
          <ul className="list-inside list-disc space-y-2 text-muted-foreground">
            <li>Search ideas by title or description</li>
            <li>Filter by status (Open, In Progress, Completed, Archived)</li>
            <li>Filter by tags to find ideas in your area of interest</li>
            <li>
              Sort by newest, most popular (upvotes), or most discussed
              (comments)
            </li>
            <li>
              Browse with pagination — 10 ideas per page
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">Members Directory</h2>
          <p className="mb-4 text-muted-foreground">
            The <strong className="text-foreground">Members</strong> page lets
            you browse all users on VibeCodes. Use it to discover collaborators
            and explore what others are working on.
          </p>
          <ul className="list-inside list-disc space-y-2 text-muted-foreground">
            <li>Search members by name</li>
            <li>Sort by newest, most ideas, or most collaborations</li>
            <li>Browse with pagination</li>
            <li>Click any member to view their full profile, ideas, and activity</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">Your Dashboard</h2>
          <p className="mb-4 text-muted-foreground">
            Once logged in, the{" "}
            <strong className="text-foreground">Dashboard</strong> is your home
            base. It shows:
          </p>
          <ul className="list-inside list-disc space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">Stats</strong> — four cards
              showing ideas created, collaborations, upvotes received, and tasks
              assigned to you
            </li>
            <li>
              <strong className="text-foreground">Active Boards</strong> — your
              5 most recently active kanban boards with per-column task counts
            </li>
            <li>
              <strong className="text-foreground">My Tasks</strong> — tasks
              assigned to you across all boards, sorted by due date urgency,
              with labels, workflow step progress, and due date badges
            </li>
            <li>
              <strong className="text-foreground">My Ideas</strong> — your 5
              most recent ideas with vote/comment/collaborator counts
            </li>
            <li>
              <strong className="text-foreground">Collaborations</strong> — up
              to 5 ideas you&apos;ve joined as a collaborator
            </li>
            <li>
              <strong className="text-foreground">My Agents</strong> — your AI
              agent personas with current task assignments and latest activity
              (shown if you have agents)
            </li>
            <li>
              <strong className="text-foreground">Recent Activity</strong> —
              latest votes, comments, collaborator joins, status changes, and
              @mentions
            </li>
          </ul>
          <p className="mt-4 text-muted-foreground">
            Every section is <strong className="text-foreground">collapsible</strong>{" "}
            — click the chevron to collapse or expand. You can also{" "}
            <strong className="text-foreground">customise the layout</strong>{" "}
            using the &quot;Customize&quot; button: reorder panels with arrow
            buttons and move them between the left and right columns. Your
            layout is saved to your browser.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">Install as an App</h2>
          <p className="mb-4 text-muted-foreground">
            VibeCodes is a <strong className="text-foreground">Progressive Web
            App (PWA)</strong> — you can install it on your device for a native
            app experience:
          </p>
          <ul className="list-inside list-disc space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">Android / Desktop Chrome</strong>{" "}
              — look for the install prompt or click the install icon in the
              address bar
            </li>
            <li>
              <strong className="text-foreground">iOS Safari</strong> — tap
              Share &rarr; &quot;Add to Home Screen&quot;
            </li>
          </ul>
          <p className="mt-3 text-muted-foreground">
            The installed app launches in its own window with offline fallback
            support. No app store needed. VibeCodes defaults to{" "}
            <strong className="text-foreground">dark mode</strong> — toggle
            between light and dark using the theme button in the navbar.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">Submit Your First Idea</h2>
          <p className="mb-4 text-muted-foreground">
            Click <strong className="text-foreground">New Idea</strong> in the
            navbar to create your first idea. Each idea has:
          </p>
          <ul className="list-inside list-disc space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">Title</strong> — a short,
              descriptive name
            </li>
            <li>
              <strong className="text-foreground">Description</strong> —
              markdown-supported, explain your vision in detail
            </li>
            <li>
              <strong className="text-foreground">Tags</strong> — up to 10 tags
              to categorize your idea
            </li>
            <li>
              <strong className="text-foreground">GitHub URL</strong>{" "}
              (optional) — link to a related repository
            </li>
            <li>
              <strong className="text-foreground">Visibility</strong> — public
              (visible to everyone) or private (only you and collaborators)
            </li>
          </ul>
          <div className="mt-4 rounded-xl border border-border bg-muted/30 p-6">
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">Tip:</strong> Use markdown in
              your description to add headings, code blocks, lists, and links.
              It renders beautifully on the idea detail page.
            </p>
          </div>
        </section>
      </div>

      <div className="mt-12 flex justify-end border-t border-border pt-6">
        <Link href="/guide/ideas-and-voting">
          <Button variant="outline" className="gap-2">
            Ideas & Voting
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      </div>
    </div>
  );
}
