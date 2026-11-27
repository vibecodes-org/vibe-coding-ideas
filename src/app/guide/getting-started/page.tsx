import Link from "next/link";
import { Rocket, ArrowLeft } from "lucide-react";

export const metadata = {
  title: "Getting Started Guide",
  description:
    "Sign up, type one line about your idea, and get a board with a team and workflows ready to go.",
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
            Every new account gets{" "}
            <strong className="text-foreground">10 starter AI credits</strong> to
            try the AI features. After that you add your own Anthropic key in{" "}
            <Link href="/guide/settings" className="text-primary hover:underline">
              Settings
            </Link>
            . To change your name, picture or bio later, open Settings too.
          </p>
          <p className="text-muted-foreground">
            Forgot your password? Use the{" "}
            <strong className="text-foreground">reset link</strong> on the login
            page to receive a password reset email.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">The Welcome Steps</h2>
          <p className="mb-4 text-muted-foreground">
            The first time you sign in, five short steps get your first project
            running:
          </p>
          <ul className="mb-4 list-inside list-disc space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">Welcome</strong> — what
              VibeCodes does.
            </li>
            <li>
              <strong className="text-foreground">Profile</strong> — your name
              and a line about you.
            </li>
            <li>
              <strong className="text-foreground">Project</strong> — type one
              line about what you want to build. Pick what kind of project it
              is (Web Application is picked for you), and press{" "}
              <strong className="text-foreground">Draft with AI</strong> if
              you&apos;d like it written up properly. Drafting uses one AI
              credit.
            </li>
            <li>
              <strong className="text-foreground">Connect</strong> — one{" "}
              <strong className="text-foreground">Launch Claude Code</strong>{" "}
              button connects Claude Code to your new board. No Claude Code
              yet? Open Manual setup for the command to run.
            </li>
            <li>
              <strong className="text-foreground">Done</strong> — you land on
              your board, already filled with cards. Building those first cards
              is free.
            </li>
          </ul>
          <div className="mt-4 rounded-xl border border-border bg-muted/30 p-6">
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">Tip:</strong> You can skip the
              welcome steps and set everything up by hand later.
            </p>
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">What Kind of Project?</h2>
          <p className="mb-4 text-muted-foreground">
            In the Project step you choose a{" "}
            <strong className="text-foreground">project type</strong> (the
            buttons in the app call it a kit). It bundles everything your board
            needs to get started:
          </p>
          <ul className="mb-4 list-inside list-disc space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">AI Agents</strong> — a team
              matched to your project type (e.g. planner, engineer, reviewer, QA)
            </li>
            <li>
              <strong className="text-foreground">Workflow Templates</strong> —
              pre-built workflows like Bug Fix, Feature Development, and more
            </li>
            <li>
              <strong className="text-foreground">Board Labels</strong> —
              labels such as Bug and Feature
            </li>
            <li>
              <strong className="text-foreground">Workflow Triggers</strong> —
              labels automatically apply the right workflow to new tasks. The New
              Task dialog shows which one before you create the card, and lets
              you pick another
            </li>
          </ul>
          <p className="text-muted-foreground">
            You can also apply one later, for example from the board&apos;s setup
            banner or the Workflows tab while a board has no workflows yet. No
            cards are added, but cards that already carry a matching label get
            the workflow. Claude Code or Codex can do it too, using the{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-sm">
              list_kits
            </code>{" "}
            and{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-sm">
              apply_kit
            </code>{" "}
            tools.{" "}
            <Link
              href="/guide/project-kits"
              className="text-primary hover:underline"
            >
              Read the full Project Types guide &rarr;
            </Link>
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">Finding Other People&apos;s Ideas</h2>
          <p className="mb-4 text-muted-foreground">
            <strong className="text-foreground">Ideas</strong> (in the top bar,
            once you&apos;re signed in) lists public ideas. You can:
          </p>
          <ul className="list-inside list-disc space-y-2 text-muted-foreground">
            <li>
              Switch between <strong className="text-foreground">All</strong>,{" "}
              <strong className="text-foreground">My Ideas</strong> and{" "}
              <strong className="text-foreground">Collaborating</strong>
            </li>
            <li>Search ideas by title or description</li>
            <li>Filter by status (Open, In Progress, Completed, Archived)</li>
            <li>Filter by tags to find ideas in your area of interest</li>
            <li>
              Sort by Newest, Most Popular (upvotes), or Most Discussed
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
              active kanban boards, most recently active first, with per-column
              task counts and{" "}
              <strong className="text-foreground">Idea Health</strong>{" "}
              indicators, a quick setup check for each idea
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
            — click the chevron to collapse or expand. Press{" "}
            <strong className="text-foreground">Customize</strong> to drag the
            panels into the order you like; Reset puts them back. Your layout
            is saved to your browser.
          </p>
          <p className="mt-4 text-muted-foreground">
            Use the{" "}
            <strong className="text-foreground">Board Switcher</strong> in the
            navbar to quickly jump between your boards without going back to the
            dashboard. Until you&apos;ve finished setting up, a{" "}
            <strong className="text-foreground">Getting set up</strong>{" "}
            checklist sits at the top and ticks itself off as you go.
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
          <h2 className="mb-4 text-2xl font-semibold">Starting Another Project</h2>
          <p className="mb-4 text-muted-foreground">
            Your first idea is created in the welcome steps, complete with a board,
            agents, and workflows. To start another, click{" "}
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
              markdown-supported, explain your vision in detail.{" "}
              <strong className="text-foreground">Draft with AI</strong> writes
              it up from one line; once there&apos;s text it becomes{" "}
              <strong className="text-foreground">Expand with AI</strong>, and
              Undo brings back what you had
            </li>
            <li>
              <strong className="text-foreground">Project type</strong> — Web
              Application, Mobile App, API / Backend, AI App / Agent, Game, or
              Custom to start from scratch. A preview shows the team and
              workflows you&apos;ll get
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
              <strong className="text-foreground">Visibility</strong> — ideas
              start public (visible to everyone); switch to private if only you
              and your collaborators should see it
            </li>
          </ul>
          <p className="mt-4 text-muted-foreground">
            <strong className="text-foreground">Create idea &amp; apply kit</strong>{" "}
            sets up the team, workflows and labels and takes you straight to
            the new board. Press <strong className="text-foreground">AI Generate Tasks</strong>{" "}
            there to fill it with cards.
          </p>
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
