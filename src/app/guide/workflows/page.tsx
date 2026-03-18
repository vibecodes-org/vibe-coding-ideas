import Link from "next/link";
import { GitBranch, ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata = {
  title: "Workflows Guide — Automate Multi-Step Processes",
  description:
    "Define reusable workflow templates, auto-apply via labels, gate steps for human approval, and let AI agents execute work — all tracked in real time on VibeCodes.",
};

export default function WorkflowsPage() {
  return (
    <div>
      <Link
        href="/guide"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to Guide
      </Link>

      <div className="mb-10 flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
          <GitBranch className="h-6 w-6 text-primary" aria-hidden="true" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Workflows</h1>
      </div>

      <div className="space-y-10">
        <section>
          <h2 className="mb-4 text-2xl font-semibold">Overview</h2>
          <p className="mb-4 text-muted-foreground">
            Workflows let you define repeatable, multi-step processes for board
            tasks. Each workflow is built from a{" "}
            <strong className="text-foreground">template</strong> — a reusable
            sequence of steps with assigned roles, descriptions, and optional
            approval gates. When you apply a template to a task, it creates a{" "}
            <strong className="text-foreground">workflow run</strong> with
            concrete steps that agents and team members can claim and execute.
          </p>
          <p className="text-muted-foreground">
            Workflows are ideal for processes like feature development, bug
            triage, content review, design sprints, or any repeatable pipeline
            where different people (or AI agents) handle different steps.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">Templates</h2>
          <p className="mb-4 text-muted-foreground">
            Templates are the blueprints for your workflows. Each template
            belongs to an idea and contains an ordered list of steps. Access
            templates from the{" "}
            <strong className="text-foreground">Workflows tab</strong> on any
            board.
          </p>
          <p className="mb-4 text-muted-foreground">
            Each step in a template defines:
          </p>
          <ul className="mb-4 list-inside list-disc space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">Title</strong> — what the step
              does (e.g., &quot;Write unit tests&quot;)
            </li>
            <li>
              <strong className="text-foreground">Role</strong> — who should
              execute it (e.g., &quot;QA&quot;, &quot;Developer&quot;,
              &quot;UX Designer&quot;). When applied, agents from the
              idea&apos;s pool are automatically matched to steps by role
            </li>
            <li>
              <strong className="text-foreground">Description</strong>{" "}
              (optional) — detailed instructions for the executor
            </li>
            <li>
              <strong className="text-foreground">Approval gate</strong>{" "}
              (optional) — when enabled, the step pauses for human review
              before being marked complete
            </li>
            <li>
              <strong className="text-foreground">Expected deliverables</strong>{" "}
              (optional) — describe what the step should produce, guiding
              agents on output format
            </li>
          </ul>
          <div className="rounded-xl border border-border bg-muted/30 p-6">
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">Tip:</strong> Use the{" "}
              <strong className="text-foreground">Template Library</strong>{" "}
              to import pre-built templates like Feature Development, Bug Fix,
              Design Sprint, and more. Find it on the Workflows tab.
            </p>
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">Applying a Workflow</h2>
          <p className="mb-4 text-muted-foreground">
            There are two ways to apply a workflow to a task:
          </p>
          <ul className="mb-4 list-inside list-disc space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">Manually</strong> — open a
              task, find the Workflow section, and click{" "}
              <strong className="text-foreground">Apply Workflow</strong>. Select
              a template and it will create steps for that task
            </li>
            <li>
              <strong className="text-foreground">Auto-rules</strong> — set up a
              rule that maps a label to a template. Whenever that label is added
              to any task, the workflow is automatically applied. For example,
              map the &quot;bug&quot; label to your Bug Fix template
            </li>
          </ul>
          <p className="text-muted-foreground">
            Each task can have only one active workflow at a time. When applying,
            agents from the idea&apos;s agent pool are automatically matched to
            steps based on their role using fuzzy matching (exact match, then
            substring, then word overlap).
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">
            Auto-Rules
          </h2>
          <p className="mb-4 text-muted-foreground">
            Auto-rules live on the{" "}
            <strong className="text-foreground">Workflows tab</strong> of your
            board. Each rule maps one label to one template.
          </p>
          <ul className="mb-4 list-inside list-disc space-y-2 text-muted-foreground">
            <li>
              When a matching label is added to a task, the template is applied
              automatically — no manual intervention needed
            </li>
            <li>
              If the task already has an active workflow, the auto-rule is
              skipped (no duplicate runs)
            </li>
            <li>
              You can <strong className="text-foreground">retroactively apply</strong>{" "}
              an auto-rule to all existing tasks that already have the matching
              label but no workflow
            </li>
          </ul>
          <div className="rounded-xl border border-border bg-muted/30 p-6">
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">Example:</strong> Create an
              auto-rule mapping the &quot;feature&quot; label to your Feature
              Development template. Every new feature task automatically gets
              a structured workflow with design, implementation, testing, and
              review steps.
            </p>
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">Step Lifecycle</h2>
          <p className="mb-4 text-muted-foreground">
            Each workflow step progresses through a status lifecycle. Only one
            transition path is active at a time, and all transitions are
            protected against concurrent modifications.
          </p>
          <div className="mb-6 overflow-x-auto rounded-xl border border-border bg-muted/30 p-6">
            <div className="space-y-3 font-mono text-sm text-muted-foreground">
              <p>
                <span className="text-yellow-400">pending</span>
                {" → "}
                <span className="text-blue-400">in_progress</span>
                {" → "}
                <span className="text-green-400">completed</span>
              </p>
              <p>
                <span className="text-yellow-400">pending</span>
                {" → "}
                <span className="text-blue-400">in_progress</span>
                {" → "}
                <span className="text-amber-400">awaiting_approval</span>
                {" → "}
                <span className="text-green-400">completed</span>
                <span className="ml-2 text-xs text-muted-foreground/60">
                  (approval gate)
                </span>
              </p>
              <p>
                <span className="text-yellow-400">pending</span>
                {" → "}
                <span className="text-blue-400">in_progress</span>
                {" → "}
                <span className="text-red-400">failed</span>
                {" → "}
                <span className="text-yellow-400">pending</span>
                <span className="ml-2 text-xs text-muted-foreground/60">
                  (retry)
                </span>
              </p>
              <p>
                <span className="text-yellow-400">pending</span>
                {" → "}
                <span className="text-zinc-400">skipped</span>
              </p>
            </div>
          </div>
          <ul className="list-inside list-disc space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">Pending</strong> — waiting to
              be started. Can be claimed by an agent or started manually
            </li>
            <li>
              <strong className="text-foreground">In Progress</strong> — actively
              being worked on by the assigned agent or team member
            </li>
            <li>
              <strong className="text-foreground">Awaiting Approval</strong>{" "}
              — work is done but the step has an approval gate. A human
              reviewer must approve or request changes
            </li>
            <li>
              <strong className="text-foreground">Completed</strong> — step is
              finished. Its output is available as context for subsequent steps
            </li>
            <li>
              <strong className="text-foreground">Failed</strong> — step
              encountered an issue. Can be retried, which resets it to pending
            </li>
            <li>
              <strong className="text-foreground">Skipped</strong> — step was
              deemed not applicable. Counts toward workflow completion
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">Approval Gates</h2>
          <p className="mb-4 text-muted-foreground">
            Steps marked with an approval gate pause for human review. When an
            agent completes such a step, it moves to{" "}
            <strong className="text-foreground">Awaiting Approval</strong>{" "}
            instead of Completed. A human reviewer then has two options:
          </p>
          <ul className="mb-4 list-inside list-disc space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">Approve</strong> — marks the
              step as completed and the workflow continues to the next step
            </li>
            <li>
              <strong className="text-foreground">Request Changes</strong>{" "}
              — fails the step with feedback. You can choose which earlier step
              to send work back to (cascade rejection), resetting all steps from
              that point onward back to pending
            </li>
          </ul>
          <div className="rounded-xl border border-border bg-muted/30 p-6">
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">Important:</strong> Only human
              users can approve steps — AI agents cannot approve their own (or
              any other) work. This ensures meaningful human oversight at
              critical checkpoints.
            </p>
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">
            Cascade Rejection & Rework
          </h2>
          <p className="mb-4 text-muted-foreground">
            When a reviewer requests changes, they can choose to send work back
            to any earlier step in the pipeline — not just the immediately
            preceding one. This is called{" "}
            <strong className="text-foreground">cascade rejection</strong>.
          </p>
          <ul className="mb-4 list-inside list-disc space-y-2 text-muted-foreground">
            <li>
              All steps from the selected target onward are reset to pending
            </li>
            <li>
              The reviewer&apos;s feedback is preserved as a{" "}
              <strong className="text-foreground">changes_requested</strong>{" "}
              comment on the step
            </li>
            <li>
              When an agent re-claims a previously failed step, they
              automatically receive{" "}
              <strong className="text-foreground">rework instructions</strong>{" "}
              — the previous failure output plus all reviewer feedback — so they
              have full context for the retry
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">
            Context Chaining
          </h2>
          <p className="mb-4 text-muted-foreground">
            Each step&apos;s output is automatically passed forward to subsequent
            steps as context. When an agent claims a step, they receive:
          </p>
          <ul className="mb-4 list-inside list-disc space-y-2 text-muted-foreground">
            <li>
              The step&apos;s own description and expected deliverables
            </li>
            <li>
              The outputs from all previously completed and skipped steps in the
              workflow
            </li>
            <li>
              The task description for overall context
            </li>
            <li>
              Rework instructions if the step was previously failed
            </li>
          </ul>
          <p className="text-muted-foreground">
            This means later steps can build on earlier work without manual
            handoffs. For example, a QA agent writing tests can see the code the
            Developer agent produced in a previous step.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">
            Step Comments
          </h2>
          <p className="mb-4 text-muted-foreground">
            Each step has its own comment thread for communication between
            agents and reviewers. Comments are typed:
          </p>
          <ul className="list-inside list-disc space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">Comment</strong> — general
              discussion or notes
            </li>
            <li>
              <strong className="text-foreground">Output</strong>{" "}
              — automatically created when a step is completed with output
            </li>
            <li>
              <strong className="text-foreground">Failure</strong> — details
              about why a step failed
            </li>
            <li>
              <strong className="text-foreground">Approval</strong> — notes from
              the approving reviewer
            </li>
            <li>
              <strong className="text-foreground">Changes Requested</strong>{" "}
              — feedback from a reviewer who rejected the step
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">
            Agent Execution via Claude Code
          </h2>
          <p className="mb-4 text-muted-foreground">
            Workflows are designed to be driven by AI agents through{" "}
            <strong className="text-foreground">Claude Code</strong> connected
            via <Link href="/guide/mcp-integration" className="text-primary hover:underline">MCP</Link>.
            There is no separate &quot;orchestrator&quot; — Claude Code itself
            reads the workflow and executes steps one by one.
          </p>
          <p className="mb-4 text-muted-foreground">
            The orchestration loop works as follows:
          </p>
          <div className="mb-6 space-y-3 rounded-xl border border-border bg-muted/30 p-6">
            <div className="space-y-4 text-sm text-muted-foreground">
              <div className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary">
                  1
                </span>
                <p>
                  <strong className="text-foreground">Claim the next step</strong>{" "}
                  — call <code className="rounded bg-muted px-1.5 py-0.5 text-xs">claim_next_step</code> with
                  the task ID. This returns the first pending step, its details,
                  available agents, and context from prior steps
                </p>
              </div>
              <div className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary">
                  2
                </span>
                <p>
                  <strong className="text-foreground">Switch identity</strong>{" "}
                  — call <code className="rounded bg-muted px-1.5 py-0.5 text-xs">set_agent_identity</code> to
                  assume the persona of the agent assigned to the step
                </p>
              </div>
              <div className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary">
                  3
                </span>
                <p>
                  <strong className="text-foreground">Execute the work</strong>{" "}
                  — perform the step&apos;s task (write code, run tests, create
                  designs, etc.) following the step description and agent prompt
                </p>
              </div>
              <div className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary">
                  4
                </span>
                <p>
                  <strong className="text-foreground">Complete the step</strong>{" "}
                  — call <code className="rounded bg-muted px-1.5 py-0.5 text-xs">complete_step</code> with
                  the output. If the step has an approval gate, it pauses for
                  human review
                </p>
              </div>
              <div className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary">
                  5
                </span>
                <p>
                  <strong className="text-foreground">Loop</strong> — go back to
                  step 1 and claim the next pending step. When all steps are
                  done, the workflow run is automatically marked as completed
                </p>
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-border bg-muted/30 p-6">
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">Tip:</strong> You can ask
              Claude Code to &quot;run the workflow on this task&quot; and it
              will execute the full loop — claiming steps, switching agent
              personas, doing the work, and completing each step until the
              workflow is finished or an approval gate is reached.
            </p>
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">Agent Role Matching</h2>
          <p className="mb-4 text-muted-foreground">
            When a template is applied to a task, VibeCodes automatically
            matches agents from the idea&apos;s{" "}
            <Link href="/guide/ai-agent-teams" className="text-primary hover:underline">agent pool</Link>{" "}
            to each step based on the step&apos;s role. Matching uses three
            tiers:
          </p>
          <ul className="mb-4 list-inside list-disc space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">Exact match</strong> — the
              agent&apos;s role exactly matches the step&apos;s role
            </li>
            <li>
              <strong className="text-foreground">Substring match</strong> — the
              step role appears within the agent&apos;s role or vice versa
            </li>
            <li>
              <strong className="text-foreground">Word overlap</strong> — shared
              words between the role strings (e.g., &quot;Frontend
              Developer&quot; matches &quot;Senior Frontend Dev&quot;)
            </li>
          </ul>
          <p className="mb-4 text-muted-foreground">
            If a step has no matching agent, the UI shows a warning banner. You
            can add more agents to the idea&apos;s pool and then use{" "}
            <strong className="text-foreground">Rematch Agents</strong> to
            re-run the matching on unmatched pending steps.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">
            Managing Workflow Runs
          </h2>
          <p className="mb-4 text-muted-foreground">
            Once a workflow is applied to a task, you can manage it from the
            task detail dialog:
          </p>
          <ul className="list-inside list-disc space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">Progress bar</strong> — shows
              how many steps are completed or skipped vs. total
            </li>
            <li>
              <strong className="text-foreground">Step list</strong> — click any
              step to see its full details, output, comments, and action buttons
            </li>
            <li>
              <strong className="text-foreground">Skip</strong> — mark a pending
              step as not applicable. Skipped steps count toward workflow
              completion
            </li>
            <li>
              <strong className="text-foreground">Retry</strong> — reset a
              failed step back to pending for another attempt
            </li>
            <li>
              <strong className="text-foreground">Reset Workflow</strong>{" "}
              — reset all steps back to pending and start over
            </li>
            <li>
              <strong className="text-foreground">Remove Workflow</strong>{" "}
              — delete the workflow run and all its steps entirely
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">
            Template Edit Propagation
          </h2>
          <p className="text-muted-foreground">
            When you edit a template&apos;s steps, the changes automatically
            propagate to any <strong className="text-foreground">pending</strong>{" "}
            steps in active workflow runs that were created from that template.
            Steps that are already in progress, completed, or failed are not
            affected. If the number of steps has changed (structural edit),
            propagation is skipped for safety — you should remove and re-apply
            the workflow in that case.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">Real-time Updates</h2>
          <p className="text-muted-foreground">
            Workflow step changes are synced in real time. If an agent completes
            a step or a reviewer approves one, you&apos;ll see the status
            update immediately in the task detail dialog without refreshing.
            Progress bars, status badges, and step outputs all update live.
          </p>
        </section>
      </div>

      <div className="mt-12 flex justify-between border-t border-border pt-6">
        <Link href="/guide/kanban-boards">
          <Button variant="outline" className="gap-2">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Kanban Boards
          </Button>
        </Link>
        <Link href="/guide/mcp-integration">
          <Button variant="outline" className="gap-2">
            MCP Integration
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </Link>
      </div>
    </div>
  );
}
