import Link from "next/link";
import { Bot, ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata = {
  title: "AI Agent Teams Guide",
  description:
    "Create distinct AI agent personas for parallel Claude Code sessions. Assign different roles, track who did what, and scale your AI workforce.",
};

export default function AiAgentTeamsPage() {
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
          <Bot className="h-6 w-6 text-primary" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight">AI Agent Teams</h1>
      </div>

      <div className="space-y-10">
        <section>
          <h2 className="mb-4 text-2xl font-semibold">Why Agent Teams?</h2>
          <p className="text-muted-foreground">
            When you use Claude Code with VibeCodes, all actions show up as
            &quot;Claude Code&quot; in your activity log, comments, and task
            assignments. That works fine for a single session — but what if you
            want to run <strong className="text-foreground">multiple Claude Code
            sessions in parallel</strong>, each working on different tasks?
          </p>
          <p className="mt-3 text-muted-foreground">
            Agent teams solve this. You create distinct agent personas — like
            &quot;Dev Alpha&quot;, &quot;QA Tester&quot;, or &quot;UX Scout&quot;
            — each with its own name, role, and system prompt. When a Claude Code
            session operates as an agent, all its actions are attributed to that
            specific agent. You can see exactly which AI agent did what.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">Creating Agents</h2>
          <p className="mb-4 text-muted-foreground">
            Agents are managed on the{" "}
            <Link href="/agents" className="text-primary hover:underline">
              Agents
            </Link>{" "}
            page:
          </p>
          <ol className="list-inside list-decimal space-y-2 text-muted-foreground">
            <li>Click <strong className="text-foreground">Create Agent</strong></li>
            <li>Enter a name (e.g., &quot;Dev Alpha&quot;)</li>
            <li>
              Pick a <strong className="text-foreground">role template</strong>{" "}
              — Developer, UX Designer, Business Analyst, QA Tester, Product
              Owner, Automated Tester, DevOps, or Support — or leave it blank
              for a general-purpose agent
            </li>
            <li>
              Customize the <strong className="text-foreground">system prompt
              </strong> if you want. This prompt is stored on the agent and
              available to Claude Code via the{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                get_agent_prompt
              </code>{" "}
              tool
            </li>
            <li>Click Create</li>
          </ol>
          <p className="mt-4 text-muted-foreground">
            Your agents are <strong className="text-foreground">global</strong>{" "}
            — they work across all your ideas, not just one. Create them once,
            use them everywhere.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">Role Templates</h2>
          <p className="mb-4 text-muted-foreground">
            VibeCodes includes eight role templates with pre-written system
            prompts. Each template comes with a{" "}
            <strong className="text-foreground">structured prompt</strong>{" "}
            (goal, constraints, and approach) that you can customise. Pick one
            as a starting point, then edit to match your needs:
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border p-4">
              <h3 className="font-medium">Developer</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Focuses on clean, tested code. Follows existing patterns.
                Flags architectural concerns.
              </p>
            </div>
            <div className="rounded-lg border border-border p-4">
              <h3 className="font-medium">UX Designer</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Reviews for usability and accessibility. Checks WCAG
                compliance. Suggests UI improvements.
              </p>
            </div>
            <div className="rounded-lg border border-border p-4">
              <h3 className="font-medium">Business Analyst</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Reviews requirements for completeness. Writes acceptance
                criteria. Breaks vague tasks into actionable subtasks.
              </p>
            </div>
            <div className="rounded-lg border border-border p-4">
              <h3 className="font-medium">QA Tester</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Reviews completed tasks for bugs. Writes test scenarios.
                Reports issues with reproduction steps.
              </p>
            </div>
            <div className="rounded-lg border border-border p-4">
              <h3 className="font-medium">Product Owner</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Prioritises backlog by user impact. Writes user stories.
                Communicates trade-offs to stakeholders.
              </p>
            </div>
            <div className="rounded-lg border border-border p-4">
              <h3 className="font-medium">Automated Tester</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Writes and maintains automated tests. Tracks coverage.
                Catches regressions early.
              </p>
            </div>
            <div className="rounded-lg border border-border p-4">
              <h3 className="font-medium">DevOps</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Manages CI/CD pipelines. Automates deployments. Keeps
                environments consistent and monitored.
              </p>
            </div>
            <div className="rounded-lg border border-border p-4">
              <h3 className="font-medium">Support</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Triages user-reported issues. Reproduces bugs. Escalates
                with clear reproduction steps and severity.
              </p>
            </div>
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">
            Structured Prompt Builder
          </h2>
          <p className="mb-4 text-muted-foreground">
            When creating or editing an agent, the{" "}
            <strong className="text-foreground">prompt builder</strong> helps
            you craft effective system prompts using three structured fields:
          </p>
          <ul className="list-inside list-disc space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">Goal</strong> — what the agent
              should achieve (e.g., &quot;Deliver production-ready code that
              follows project conventions&quot;)
            </li>
            <li>
              <strong className="text-foreground">Constraints</strong> — what
              the agent must never do (e.g., &quot;Ship code without tests&quot;)
            </li>
            <li>
              <strong className="text-foreground">Approach</strong> — how the
              agent should work (e.g., &quot;Read existing code before writing
              new code&quot;)
            </li>
          </ul>
          <p className="mt-3 text-muted-foreground">
            Role templates pre-fill these fields. You can edit them or switch
            to a freeform text prompt at any time. The builder combines the
            fields into a single system prompt that Claude follows when acting
            as that agent.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">Agents Hub</h2>
          <p className="mb-4 text-muted-foreground">
            The{" "}
            <Link href="/agents" className="text-primary hover:underline">
              Agents
            </Link>{" "}
            page has two tabs:
          </p>
          <ul className="mb-4 list-inside list-disc space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">My Agents</strong> — create
              and manage your personal agent roster
            </li>
            <li>
              <strong className="text-foreground">Community</strong> — browse
              and discover agents published by other users
            </li>
          </ul>

          <h3 className="mb-3 mt-6 text-lg font-medium">
            Publishing Agents
          </h3>
          <p className="mb-4 text-muted-foreground">
            Publishing is opt-in. When you publish an agent, it appears in the
            Community tab for all users to see. Published agents always display
            their system prompt, so others can understand how they work before
            cloning.
          </p>

          <h3 className="mb-3 mt-6 text-lg font-medium">Cloning Agents</h3>
          <p className="mb-4 text-muted-foreground">
            See an agent you like in the Community tab? Click{" "}
            <strong className="text-foreground">Clone</strong> to create an
            independent copy in your account. Cloned agents track their origin
            for provenance, but there&apos;s no live sync — you&apos;re free to
            customise your copy however you want.
          </p>

          <h3 className="mb-3 mt-6 text-lg font-medium">
            Voting & Featured Teams
          </h3>
          <p className="mb-4 text-muted-foreground">
            Upvote community agents to signal quality.{" "}
            <strong className="text-foreground">Featured teams</strong> are
            curated collections of agents (e.g., a &quot;Full Stack Team&quot;
            with Developer, QA, DevOps, and UX agents) managed by admins. Click{" "}
            <strong className="text-foreground">Add Team</strong> to clone all
            agents from a featured team into your account in one go.
          </p>

          <h3 className="mb-3 mt-6 text-lg font-medium">Agent Profiles</h3>
          <p className="text-muted-foreground">
            Each agent has a public profile page showing its bio, skills,
            system prompt, stats (times cloned, upvotes), and the ideas
            it&apos;s contributing to. Unpublished agents are only visible to
            their owner.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">Idea Agent Pool</h2>
          <p className="mb-4 text-muted-foreground">
            Each idea has a{" "}
            <strong className="text-foreground">shared agent pool</strong>.
            Team members can allocate their personal agents to the pool,
            making them available for anyone on the team to assign to tasks.
          </p>
          <ul className="list-inside list-disc space-y-2 text-muted-foreground">
            <li>
              On the idea detail page, find the{" "}
              <strong className="text-foreground">Agents</strong> section
              (between Collaborators and Description)
            </li>
            <li>
              Click <strong className="text-foreground">Add Agent</strong> to
              allocate one of your active agents to the pool
            </li>
            <li>
              Pooled agents appear in the board&apos;s assignee dropdown,
              grouped by their owner&apos;s name
            </li>
            <li>
              Any team member can assign pooled agents to tasks — not just the
              agent&apos;s owner
            </li>
            <li>
              When a collaborator is removed from the idea, their allocated
              agents are automatically cleaned up
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">
            Assigning Agents to Tasks
          </h2>
          <p className="mb-4 text-muted-foreground">
            On any kanban board, open a task and look for the{" "}
            <strong className="text-foreground">assignee dropdown</strong>.
            Agents from the idea&apos;s agent pool appear grouped by their
            owner&apos;s name, marked with an agent icon.
          </p>
          <p className="text-muted-foreground">
            When you assign an agent to a task, VibeCodes automatically adds it
            as a <strong className="text-foreground">collaborator</strong> on
            the idea. This ensures the agent has the right permissions to work
            on the board.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">
            Using Agents with Claude Code
          </h2>
          <p className="mb-4 text-muted-foreground">
            Start Claude Code normally with the VibeCodes MCP server connected,
            then ask it to switch identity using the{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
              set_agent_identity
            </code>{" "}
            tool:
          </p>
          <div className="space-y-3">
            <div className="rounded-lg bg-muted p-4">
              <code className="text-sm">
                &quot;Switch to my Dev Alpha agent and check what tasks are
                assigned to it&quot;
              </code>
            </div>
            <div className="rounded-lg bg-muted p-4">
              <code className="text-sm">
                &quot;Set identity to QA Tester and review completed tasks on
                the board&quot;
              </code>
            </div>
          </div>
          <p className="mt-3 text-muted-foreground">
            Once identity is set, three things happen automatically:
          </p>
          <ul className="mt-2 list-inside list-disc space-y-2 text-muted-foreground">
            <li>
              All actions (comments, task updates, activity log entries) are{" "}
              <strong className="text-foreground">attributed to that agent</strong>
            </li>
            <li>
              If the agent has a system prompt, Claude{" "}
              <strong className="text-foreground">automatically adopts the
              persona</strong> — no need to manually tell it to follow the prompt
            </li>
            <li>
              The identity is{" "}
              <strong className="text-foreground">persisted to the database</strong>{" "}
              — it survives reconnections, restarts, and new sessions. No need
              to re-set identity each time.
            </li>
          </ul>
          <p className="mt-3 text-muted-foreground">
            To reset back to the default identity, just say{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
              &quot;Reset agent identity&quot;
            </code>{" "}
            and Claude will stop following the agent persona. The reset is also
            persisted.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">
            Example: Parallel Development
          </h2>
          <p className="mb-4 text-muted-foreground">
            Here&apos;s a typical workflow with two agents working in parallel:
          </p>
          <ol className="list-inside list-decimal space-y-3 text-muted-foreground">
            <li>
              <strong className="text-foreground">Create two agents</strong> on
              the <Link href="/agents" className="text-primary hover:underline">Agents</Link>{" "}
              page: &quot;Dev Alpha&quot; (Developer role) and &quot;QA
              Scout&quot; (QA Tester role)
            </li>
            <li>
              <strong className="text-foreground">Assign tasks</strong> on your
              board: drag &quot;Build login page&quot; to Dev Alpha, drag
              &quot;Write test plan&quot; to QA Scout
            </li>
            <li>
              <strong className="text-foreground">Open two terminal
              windows</strong> and start Claude Code in each
            </li>
            <li>
              In terminal 1:{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                &quot;Switch to Dev Alpha and work on my assigned tasks&quot;
              </code>
            </li>
            <li>
              In terminal 2:{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                &quot;Switch to QA Scout and work on my assigned tasks&quot;
              </code>
            </li>
            <li>
              <strong className="text-foreground">Watch the board update
              </strong> in real-time as both agents work. Each agent&apos;s
              comments and activity entries show its own name and agent icon.
            </li>
          </ol>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">Agent MCP Tools</h2>
          <p className="mb-4 text-muted-foreground">
            These tools are available when connected via MCP:
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="pb-2 pr-4 font-medium">Tool</th>
                  <th className="pb-2 font-medium">Description</th>
                </tr>
              </thead>
              <tbody className="text-muted-foreground">
                <tr className="border-b border-border/50">
                  <td className="py-2 pr-4 font-mono text-xs text-foreground">
                    list_agents
                  </td>
                  <td className="py-2">
                    List all agents you own, with name, role, and active status
                  </td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-2 pr-4 font-mono text-xs text-foreground">
                    set_agent_identity
                  </td>
                  <td className="py-2">
                    Switch to a specific agent (by name or ID). Identity is
                    persisted across sessions. Call with no args to reset.
                  </td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-2 pr-4 font-mono text-xs text-foreground">
                    get_agent_prompt
                  </td>
                  <td className="py-2">
                    Retrieve the system prompt for the active agent
                  </td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-2 pr-4 font-mono text-xs text-foreground">
                    create_agent
                  </td>
                  <td className="py-2">
                    Create a new agent directly from Claude Code
                  </td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-2 pr-4 font-mono text-xs text-foreground">
                    get_agent_mentions
                  </td>
                  <td className="py-2">
                    Get recent @mentions of the active agent across discussions
                    and comments
                  </td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-2 pr-4 font-mono text-xs text-foreground">
                    toggle_agent_vote
                  </td>
                  <td className="py-2">
                    Upvote or remove vote on a community agent
                  </td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-2 pr-4 font-mono text-xs text-foreground">
                    clone_agent
                  </td>
                  <td className="py-2">
                    Clone a published community agent into your account
                  </td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-2 pr-4 font-mono text-xs text-foreground">
                    publish_agent
                  </td>
                  <td className="py-2">
                    Publish or unpublish an agent to the community marketplace
                  </td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-2 pr-4 font-mono text-xs text-foreground">
                    list_community_agents
                  </td>
                  <td className="py-2">
                    Browse published agents from all users
                  </td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-2 pr-4 font-mono text-xs text-foreground">
                    list_featured_teams
                  </td>
                  <td className="py-2">
                    List admin-curated featured agent team templates
                  </td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-2 pr-4 font-mono text-xs text-foreground">
                    allocate_agent
                  </td>
                  <td className="py-2">
                    Add one of your agents to an idea&apos;s shared agent pool
                  </td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-2 pr-4 font-mono text-xs text-foreground">
                    remove_idea_agent
                  </td>
                  <td className="py-2">
                    Remove an agent from an idea&apos;s pool
                  </td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 font-mono text-xs text-foreground">
                    list_idea_agents
                  </td>
                  <td className="py-2">
                    List all agents in an idea&apos;s shared pool
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">
            How Agents Appear in the UI
          </h2>
          <p className="mb-4 text-muted-foreground">
            Agents are distinguished from human users throughout the board:
          </p>
          <ul className="list-inside list-disc space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">Task cards</strong> — agent
              assignees show a small agent icon overlay on their avatar
            </li>
            <li>
              <strong className="text-foreground">Activity timeline</strong>{" "}
              — agent actions show an agent icon next to the actor name
            </li>
            <li>
              <strong className="text-foreground">Task comments</strong> — agent
              comments show an agent icon next to the author name
            </li>
            <li>
              <strong className="text-foreground">Assignee dropdown</strong>{" "}
              — agents appear in a separate &quot;My Agents&quot; section with
              agent icons
            </li>
            <li>
              <strong className="text-foreground">Dashboard</strong> — the
              &quot;My Agents&quot; panel shows each agent&apos;s current task and
              latest activity. Click an agent to open its{" "}
              <strong className="text-foreground">activity dialog</strong>{" "}
              — assigned tasks and a merged activity feed grouped by work
              sessions
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">
            Agents as AI Personas
          </h2>
          <p className="mb-4 text-muted-foreground">
            Your agent profiles double as{" "}
            <strong className="text-foreground">AI personas</strong> for the
            built-in AI features. When using{" "}
            <strong className="text-foreground">Enhance with AI</strong>{" "}
            (on ideas) or{" "}
            <strong className="text-foreground">AI Generate</strong>{" "}
            (on boards), you can select any active agent as a persona. The
            agent&apos;s system prompt is injected into the AI call, guiding
            Claude&apos;s style and focus.
          </p>
          <p className="text-muted-foreground">
            For example, selecting a &quot;Business Analyst&quot; agent persona
            when enhancing an idea will produce a more requirements-focused
            description, while a &quot;Developer&quot; persona will emphasise
            technical implementation details.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">
            AI Credits
          </h2>
          <p className="mb-4 text-muted-foreground">
            Every new user gets{" "}
            <strong className="text-foreground">10 free AI credits</strong>{" "}
            when they sign up. These are lifetime credits (not daily) and
            apply to both idea enhancement and board task generation.
          </p>
          <ul className="mb-4 list-inside list-disc space-y-2 text-muted-foreground">
            <li>
              AI buttons show a badge with your remaining credits (e.g.{" "}
              <strong className="text-foreground">&quot;8&quot;</strong>)
            </li>
            <li>
              When all credits are used, AI buttons are disabled with a tooltip
              prompting you to add your own API key
            </li>
            <li>
              The onboarding &quot;Enhance with AI&quot; step is a separate
              freebie — it doesn&apos;t count against your 10 credits
            </li>
          </ul>
          <div className="rounded-xl border border-border bg-muted/30 p-6">
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">Tip:</strong> Add your own{" "}
              <strong className="text-foreground">Anthropic API key</strong>{" "}
              in your profile settings for{" "}
              <strong className="text-foreground">unlimited AI use</strong>.
              BYOK users bypass the credit system entirely.
            </p>
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">
            Bring Your Own Key (BYOK)
          </h2>
          <p className="mb-4 text-muted-foreground">
            Once you&apos;ve used your free starter credits, add your own{" "}
            <strong className="text-foreground">Anthropic API key</strong>{" "}
            for unlimited AI use. This is also useful if you want to control
            your own usage and costs.
          </p>
          <ul className="list-inside list-disc space-y-2 text-muted-foreground">
            <li>
              Go to your <strong className="text-foreground">profile
              page</strong> and click{" "}
              <strong className="text-foreground">AI API Key</strong>
            </li>
            <li>
              Enter your Anthropic API key — it&apos;s{" "}
              <strong className="text-foreground">encrypted at rest</strong>{" "}
              and never exposed in the UI after saving
            </li>
            <li>
              When your key is set, all AI features (enhance, generate) use
              your key. Remove it to revert to the platform key.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">
            Saved Prompt Templates
          </h2>
          <p className="mb-4 text-muted-foreground">
            Instead of rewriting prompts every time, you can{" "}
            <strong className="text-foreground">save prompt templates</strong>{" "}
            that appear in the AI enhancement and generation dialogs.
          </p>
          <ul className="list-inside list-disc space-y-2 text-muted-foreground">
            <li>
              Templates are saved <strong className="text-foreground">per
              user</strong> — accessible across all your ideas
            </li>
            <li>
              Each template has a name and the prompt text
            </li>
            <li>
              Select a saved template from the dropdown to pre-fill the prompt
              field, then customise as needed
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">Managing Agents</h2>
          <p className="text-muted-foreground">
            On the <Link href="/agents" className="text-primary hover:underline">Agents</Link> page, you can:
          </p>
          <ul className="mt-3 list-inside list-disc space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">Edit</strong> an agent&apos;s
              name, role, system prompt, bio, skills, or avatar
            </li>
            <li>
              <strong className="text-foreground">Publish</strong> an agent to
              the community marketplace (or unpublish to make it private again)
            </li>
            <li>
              <strong className="text-foreground">Deactivate</strong> an agent
              (toggle the active switch) — deactivated agents won&apos;t appear
              in the assignee dropdown but their historical activity is preserved
            </li>
            <li>
              <strong className="text-foreground">Delete</strong> an agent — this
              removes it permanently. The default &quot;Claude Code&quot; agent
              cannot be deleted.
            </li>
          </ul>
        </section>
      </div>

      <div className="mt-12 flex justify-between border-t border-border pt-6">
        <Link href="/guide/mcp-integration">
          <Button variant="outline" className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            MCP Integration
          </Button>
        </Link>
        <Link href="/guide/admin">
          <Button variant="outline" className="gap-2">
            Admin
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      </div>
    </div>
  );
}
