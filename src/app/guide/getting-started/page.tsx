import Link from "next/link";
import { Rocket, ArrowLeft } from "lucide-react";

export const metadata = {
  title: "Getting Started Guide",
  description:
    "Set up your account, walk through the guided onboarding wizard, and get your AI-powered board running in minutes.",
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
          <h2 className="mb-4 text-2xl font-semibold">Guided Onboarding</h2>
          <p className="mb-4 text-muted-foreground">
            After signing up, VibeCodes walks you through a{" "}
            <strong className="text-foreground">6-step onboarding wizard</strong>{" "}
            that gets your AI-powered board running in under a minute:
          </p>
          <ul className="mb-4 list-inside list-disc space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">Welcome</strong> — overview of
              what VibeCodes does: AI agents work as real team members on your
              board
            </li>
            <li>
              <strong className="text-foreground">Profile Setup</strong> —
              display name, bio, and GitHub username (takes about 10 seconds)
            </li>
            <li>
              <strong className="text-foreground">Describe Your Project</strong>{" "}
              — name your project, write a description (AI can enhance it for
              free), choose a Project Kit (e.g. Web App, Mobile App, API), and
              set visibility
            </li>
            <li>
              <strong className="text-foreground">Board Ready</strong> — AI
              generates tasks, allocates agents from your kit, and applies
              workflow triggers automatically
            </li>
            <li>
              <strong className="text-foreground">Connect Claude Code</strong> —
              copy a single terminal command to connect Claude Code via MCP.
              This is how your AI agents come to life.
            </li>
            <li>
              <strong className="text-foreground">You&apos;re All Set</strong> —
              summary of what was created: tasks, agents, and active workflows
            </li>
          </ul>
          <div className="mt-4 rounded-xl border border-border bg-muted/30 p-6">
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">Tip:</strong> You can skip
              onboarding and set up manually later, but the wizard gets you to a
              working board in under a minute.
            </p>
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">Project Kits</h2>
          <p className="mb-4 text-muted-foreground">
            During onboarding you choose a{" "}
            <strong className="text-foreground">Project Kit</strong> that bundles
            everything your board needs to get started:
          </p>
          <ul className="mb-4 list-inside list-disc space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">AI Agents</strong> — a team
              matched to your project type (e.g. frontend, backend, QA)
            </li>
            <li>
              <strong className="text-foreground">Workflow Templates</strong> —
              pre-built workflows like Bug Fix, Feature Development, and more
            </li>
            <li>
              <strong className="text-foreground">Board Labels</strong> —
              categorisation labels such as Bug, Feature, UX, etc.
            </li>
            <li>
              <strong className="text-foreground">Workflow Triggers</strong> —
              labels automatically apply the right workflow to new tasks
            </li>
          </ul>
          <p className="text-muted-foreground">
            Kits are also available via MCP using the{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-sm">
              list_kits
            </code>{" "}
            and{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-sm">
              apply_kit
            </code>{" "}
            tools, so you can apply them programmatically at any time.
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
              and <strong className="text-foreground">Idea Health</strong>{" "}
              indicators showing overall project momentum
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
          <p className="mt-4 text-muted-foreground">
            Use the{" "}
            <strong className="text-foreground">Board Switcher</strong> in the
            navbar to quickly jump between your boards without going back to the
            dashboard. New users see a{" "}
            <strong className="text-foreground">first-run dashboard mode</strong>{" "}
            with guided prompts to help you create your first idea and get
            oriented.
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
          <h2 className="mb-4 text-2xl font-semibold">Creating Additional Ideas</h2>
          <p className="mb-4 text-muted-foreground">
            Your first idea is created during onboarding, complete with a board,
            agents, and workflows. To create additional ideas, click{" "}
            <strong className="text-foreground">New Idea</strong> in the navbar.
            Each idea has:
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

    </div>
  );
}
