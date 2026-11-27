import Link from "next/link";
import { Package, ArrowLeft } from "lucide-react";

export const metadata = {
  title: "Project Types Guide",
  description:
    "Pick a project type to set up agents, workflow templates, labels, and label rules for your board in one click. No cards are added.",
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
        <h1 className="text-3xl font-bold tracking-tight">Project Types</h1>
      </div>

      <div className="space-y-10">
        <section>
          <h2 className="mb-4 text-2xl font-semibold">What a Project Type Is</h2>
          <p className="mb-4 text-muted-foreground">
            A project type is a one-click bundle that sets up your board for a
            specific kind of project. Instead of manually creating agents,
            wiring up workflows, and inventing a label scheme, you pick the
            kind of project you&apos;re building and VibeCodes configures
            everything for you in seconds. There are six: Web Application,
            Mobile App, API / Backend, AI App / Agent, Game, and Custom.
          </p>
          <p className="text-muted-foreground">
            The buttons in the app still call these{" "}
            <strong className="text-foreground">kits</strong>. The dialog is
            titled{" "}
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
          <h2 className="mb-4 text-2xl font-semibold">What a Project Type Bundles</h2>
          <p className="mb-4 text-muted-foreground">
            It sets up exactly four things — nothing more:
          </p>
          <ul className="list-inside list-disc space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">AI Agents</strong> — a team
              of personas matched to the project type: Planner, Full Stack
              Engineer, Code Reviewer, QA Engineer and DevOps Engineer. AI App
              / Agent and Game have no DevOps Engineer.
            </li>
            <li>
              <strong className="text-foreground">Workflow Templates</strong> —
              reusable multi-step processes such as Bug Fix or Technical
              Spike.
            </li>
            <li>
              <strong className="text-foreground">Board Labels</strong> —
              colored labels for categorization like Bug and Feature.
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
            No Cards Are Added
          </h2>
          <p className="mb-4 text-muted-foreground">
            Applying a project type is safe on an existing board. It only sets
            up the four building blocks above — it does not add, remove, move,
            or modify any of your cards. The one effect on existing cards: a
            card that already carries a label matching a new label rule gets
            that workflow attached.
          </p>
          <div className="rounded-xl border border-border bg-muted/30 p-6">
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">No cards are added.</strong>{" "}
              Your existing cards stay exactly where they are.
            </p>
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">How to Apply a Kit</h2>
          <p className="mb-4 text-muted-foreground">
            There are several ways in:
          </p>
          <ul className="mb-4 list-inside list-disc space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">The New Idea form</strong> —
              pick a project type and the matching kit is applied when you
              create the idea.
            </li>
            <li>
              <strong className="text-foreground">The welcome steps</strong> —
              you pick a project type while describing your first project.
            </li>
            <li>
              <strong className="text-foreground">The board setup banner</strong>{" "}
              — offers <strong className="text-foreground">Apply a Kit</strong>{" "}
              while the board has no workflows.
            </li>
            <li>
              <strong className="text-foreground">The Workflows tab</strong> —
              the{" "}
              <strong className="text-foreground">
                &quot;Apply a Project Kit&quot;
              </strong>{" "}
              button shows only while the board has no workflows yet.
            </li>
            <li>
              <strong className="text-foreground">Claude Code or Codex</strong>{" "}
              — using the <code className="rounded bg-muted px-1.5 py-0.5 text-xs">apply_kit</code>{" "}
              tool.
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
                        <li>
              A partial failure on one item doesn&apos;t block the rest — the
              kit applies everything it can.
            </li>
          </ul>
          <p className="text-muted-foreground">
            After wiring up the label rules, applying from the website also{" "}
            <strong className="text-foreground">
              retroactively applies them to your existing labelled tasks
            </strong>
            . So a task that is already labelled{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">bug</code>{" "}
            gets the Bug Fix workflow attached automatically — without you
            having to re-label anything. (The Claude Code and Codex tool does
            not do this step.)
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">
            Via Claude Code or Codex
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
            MCP tools, you — or an agent — can browse and apply a project type at
            any time directly from Claude Code or Codex, without opening the
            dialog.
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
            A project type is really a head start on two of the most powerful
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
              — the agents a project type creates for your board.
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
