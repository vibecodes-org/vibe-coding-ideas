import Link from "next/link";
import { Package, ArrowLeft } from "lucide-react";

export const metadata = {
  title: "Project Kits Guide",
  description:
    "Apply a one-click Project Kit to set up agents, workflow templates, labels, and workflow triggers for your board — without ever touching your tasks.",
};

export default function ProjectKitsPage() {
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
          <Package className="h-6 w-6 text-violet-400" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Project Kits</h1>
      </div>

      <div className="space-y-10">
        <section>
          <h2 className="mb-4 text-2xl font-semibold">What a Project Kit Is</h2>
          <p className="mb-4 text-muted-foreground">
            A Project Kit is a one-click bundle that sets up your board for a
            specific project type. Instead of manually creating agents, wiring
            up workflows, and inventing a label scheme, you pick the kind of
            project you&apos;re building and VibeCodes configures everything for
            you in seconds.
          </p>
          <p className="text-muted-foreground">
            The kit dialog is titled{" "}
            <strong className="text-foreground">
              &quot;Apply a Project Kit&quot;
            </strong>{" "}
            and describes itself simply:{" "}
            <span className="italic">
              &quot;Choose a project type to set up agents, workflows, labels,
              and workflow triggers for this idea.&quot;
            </span>
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">What a Kit Bundles</h2>
          <p className="mb-4 text-muted-foreground">
            A kit sets up exactly four things — nothing more:
          </p>
          <ul className="list-inside list-disc space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">AI Agents</strong> — a team
              of personas matched to the project type (for example Full Stack,
              UX, and QA agents).
            </li>
            <li>
              <strong className="text-foreground">Workflow Templates</strong> —
              reusable multi-step processes such as Bug Fix or Feature
              Development.
            </li>
            <li>
              <strong className="text-foreground">Board Labels</strong> —
              colored labels for categorization like Bug, Feature, and UX.
            </li>
            <li>
              <strong className="text-foreground">Workflow Triggers</strong> —
              rules that tie a label to a workflow so the right process is
              auto-applied to a task when it gets that label.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">
            Kits Never Touch Your Tasks
          </h2>
          <p className="mb-4 text-muted-foreground">
            This is the most important thing to know about Project Kits:
            applying one is completely safe on an existing board. It only sets
            up the four building blocks above — it does not add, remove, move,
            or modify any of your tasks.
          </p>
          <div className="rounded-xl border border-border bg-muted/30 p-6">
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">No tasks are added.</strong>{" "}
              This kit sets up your agents, workflows, labels and triggers only
              — your existing board tasks stay exactly as they are.
            </p>
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">How to Apply a Kit</h2>
          <p className="mb-4 text-muted-foreground">
            There are three entry points for applying a Project Kit:
          </p>
          <ul className="mb-4 list-inside list-disc space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">During onboarding</strong> —
              you pick a project type while describing your project, and the
              matching kit is applied automatically.
            </li>
            <li>
              <strong className="text-foreground">From the board empty state</strong>{" "}
              — a fresh board offers to set itself up with a kit.
            </li>
            <li>
              <strong className="text-foreground">From the Workflows tab</strong>{" "}
              — use the{" "}
              <strong className="text-foreground">
                &quot;Apply a Project Kit&quot;
              </strong>{" "}
              button at any time.
            </li>
          </ul>
          <p className="text-muted-foreground">
            In the dialog you pick a project-type card, preview what it
            includes, then click the apply button — labelled{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
              Apply {"{Kit Name}"} Kit
            </code>{" "}
            (for example{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
              Apply Web Application Kit
            </code>
            ).
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">The Preview</h2>
          <p className="mb-4 text-muted-foreground">
            Choosing a project-type card shows you a full preview before you
            commit, so you always know what a kit will set up:
          </p>
          <ul className="mb-4 list-inside list-disc space-y-2 text-muted-foreground">
            <li>
              A <strong className="text-foreground">Team</strong> section
              listing the agent role chips the kit will create.
            </li>
            <li>
              A{" "}
              <strong className="text-foreground">
                Workflows — click to view steps
              </strong>{" "}
              section, where each workflow shows its step count. Click a
              workflow to expand its step chain.
            </li>
            <li>
              Steps that need sign-off show a lock for{" "}
              <strong className="text-foreground">
                &quot;Requires your approval&quot;
              </strong>
              .
            </li>
            <li>
              A legend notes{" "}
              <strong className="text-foreground">
                &quot;⚡ Labels auto-assign workflows&quot;
              </strong>{" "}
              to explain how the triggers connect labels to workflows.
            </li>
          </ul>
          <div className="rounded-xl border border-border bg-muted/30 p-6">
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">
                The &quot;Custom&quot; option
              </strong>{" "}
              starts from scratch — no kit is applied. Custom is not an
              applyable kit; it simply means you&apos;ll set up agents,
              workflows, and labels yourself afterwards.
            </p>
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">
            Smart, Non-Destructive Application
          </h2>
          <p className="mb-4 text-muted-foreground">
            Applying a kit is designed to be safe to run on a board that
            already has some setup. It de-duplicates as it goes:
          </p>
          <ul className="mb-4 list-inside list-disc space-y-2 text-muted-foreground">
            <li>It skips agents whose role you already have.</li>
            <li>It skips labels that already exist.</li>
            <li>It imports each workflow template once.</li>
            <li>
              A partial failure on one item doesn&apos;t block the rest — the
              kit applies everything it can.
            </li>
          </ul>
          <p className="text-muted-foreground">
            After wiring up the triggers, a kit also{" "}
            <strong className="text-foreground">
              retroactively applies them to your existing labelled tasks
            </strong>
            . So a task that is already labelled{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">bug</code>{" "}
            gets the Bug Fix workflow attached automatically — without you
            having to re-label anything.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">
            Via MCP / Claude Code
          </h2>
          <p className="mb-4 text-muted-foreground">
            Kits are also available programmatically. Using the{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
              list_kits
            </code>{" "}
            and{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
              apply_kit
            </code>{" "}
            MCP tools, you — or an agent — can browse and apply a Project Kit at
            any time directly from Claude Code, without opening the dialog.
          </p>
          <p className="text-muted-foreground">
            See the{" "}
            <Link
              href="/guide/mcp-integration"
              className="text-primary hover:underline"
            >
              MCP Integration guide &rarr;
            </Link>{" "}
            for how to connect Claude Code to your boards.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">Where to Go Next</h2>
          <p className="mb-4 text-muted-foreground">
            A Project Kit is really a head start on two of the most powerful
            features in VibeCodes. Dig deeper here:
          </p>
          <ul className="list-inside list-disc space-y-2 text-muted-foreground">
            <li>
              <Link
                href="/guide/workflows"
                className="text-primary hover:underline"
              >
                Workflows guide &rarr;
              </Link>{" "}
              — how the bundled workflows and triggers actually run.
            </li>
            <li>
              <Link
                href="/guide/ai-agent-teams"
                className="text-primary hover:underline"
              >
                AI Agent Teams guide &rarr;
              </Link>{" "}
              — the agents a kit creates for your board.
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
