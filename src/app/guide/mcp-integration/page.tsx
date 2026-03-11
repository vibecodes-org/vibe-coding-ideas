import Link from "next/link";
import type { Metadata } from "next";
import { Terminal, ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/guide/code-block";
import { CollapsibleTools } from "@/components/guide/collapsible-tools";

export const metadata: Metadata = {
  title: "MCP Integration Guide — Connect Claude Code to VibeCodes",
  description:
    "Step-by-step guide to connecting Claude Code to VibeCodes via MCP. Manage ideas, boards, tasks, and agents from your terminal with 54 tools.",
};

function ToolTable({
  tools,
}: {
  tools: { name: string; description: string }[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            <th className="pb-2 pr-4 font-medium">Tool</th>
            <th className="pb-2 font-medium">Description</th>
          </tr>
        </thead>
        <tbody className="text-muted-foreground">
          {tools.map((tool, i) => (
            <tr
              key={tool.name}
              className={
                i < tools.length - 1 ? "border-b border-border/50" : ""
              }
            >
              <td className="py-2 pr-4 font-mono text-xs text-foreground">
                {tool.name}
              </td>
              <td className="py-2">{tool.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function McpIntegrationPage() {
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
          <Terminal className="h-6 w-6 text-primary" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight">MCP Integration</h1>
      </div>

      <div className="space-y-10">
        {/* ── What is MCP? ────────────────────────────────────────── */}
        <section>
          <h2 className="mb-4 text-2xl font-semibold">What is MCP?</h2>
          <p className="text-muted-foreground">
            The{" "}
            <strong className="text-foreground">
              Model Context Protocol (MCP)
            </strong>{" "}
            is an open standard that lets AI assistants like Claude Code interact
            with external tools and services. VibeCodes includes a remote MCP
            server that gives Claude Code direct access to your ideas, boards,
            and tasks — so you can manage your projects without leaving the
            terminal.
          </p>
        </section>

        {/* ── Prerequisites ───────────────────────────────────────── */}
        <section>
          <h2 className="mb-4 text-2xl font-semibold">Prerequisites</h2>
          <p className="mb-4 text-muted-foreground">
            You&apos;ll need{" "}
            <a
              href="https://docs.anthropic.com/en/docs/claude-code/overview"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              Claude Code
            </a>
            , Anthropic&apos;s command-line tool for Claude. Install it first,
            then come back here to connect it to VibeCodes.
          </p>
          <CodeBlock code="npm install -g @anthropic-ai/claude-code" />
        </section>

        {/* ── Quick Start ─────────────────────────────────────────── */}
        <section>
          <h2 className="mb-4 text-2xl font-semibold">
            Quick Start (Connect in 60 Seconds)
          </h2>
          <p className="mb-4 text-muted-foreground">
            Add the VibeCodes remote MCP server to Claude Code with this
            command:
          </p>
          <CodeBlock code="claude mcp add -s user --transport http vibecodes-remote https://vibecodes.co.uk/api/mcp" />
          <div className="mt-4 space-y-3">
            <p className="text-muted-foreground">
              This connects to the{" "}
              <strong className="text-foreground">hosted VibeCodes server</strong>{" "}
              over HTTP. You don&apos;t need to clone the repo or run anything
              locally — it works from any project directory.
            </p>
            <div className="rounded-xl border border-border bg-muted/30 p-6">
              <p className="text-sm text-muted-foreground">
                <strong className="text-foreground">
                  What does <code className="rounded bg-muted px-1.5 py-0.5 text-xs">-s user</code> do?
                </strong>{" "}
                It saves the server to your user-level config so it&apos;s
                available across all your projects. Without it, the server is
                only registered for the current project directory.
              </p>
            </div>
            <p className="text-muted-foreground">
              The first time you use it, Claude Code will open your browser for
              OAuth authentication. Log in with your VibeCodes account and
              authorize the connection. After that, Claude Code can use all 54
              VibeCodes tools on your behalf.
            </p>
            <div className="rounded-xl border border-border bg-muted/30 p-6">
              <p className="text-sm text-muted-foreground">
                <strong className="text-foreground">How auth works:</strong>{" "}
                VibeCodes uses OAuth 2.1 with PKCE. Your Supabase session token
                is used as the OAuth access token, so all actions respect the
                same permissions (RLS) as the web app. No API keys to manage.
              </p>
            </div>
          </div>
        </section>

        {/* ── Verify Your Connection ──────────────────────────────── */}
        <section>
          <h2 className="mb-4 text-2xl font-semibold">
            Verify Your Connection
          </h2>
          <p className="mb-4 text-muted-foreground">
            After adding the server, open Claude Code and test the connection:
          </p>
          <ol className="mb-4 list-inside list-decimal space-y-2 text-muted-foreground">
            <li>
              Run{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                claude
              </code>{" "}
              in your terminal to start Claude Code
            </li>
            <li>
              Ask:{" "}
              <strong className="text-foreground">
                &quot;List my ideas on VibeCodes&quot;
              </strong>
            </li>
            <li>
              Claude Code should call the{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                list_ideas
              </code>{" "}
              tool and show your ideas
            </li>
          </ol>
          <div className="rounded-xl border border-border bg-muted/30 p-6">
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">Success:</strong> If you see
              your ideas listed, you&apos;re connected! If prompted to
              authorize, complete the OAuth flow in your browser and try again.
            </p>
          </div>
        </section>

        {/* ── Project-Scoped Configuration ────────────────────────── */}
        <section>
          <h2 className="mb-4 text-2xl font-semibold">
            Project-Scoped Configuration
          </h2>
          <p className="mb-4 text-muted-foreground">
            When working on a specific project, you can create a{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
              .vibecodes/config.json
            </code>{" "}
            file in your project root. This auto-injects the{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
              idea_id
            </code>{" "}
            into MCP tool calls so you don&apos;t have to specify it every time:
          </p>
          <CodeBlock
            code={`{
  "ideaId": "your-idea-uuid-here",
  "ideaTitle": "My Project Name"
}`}
          />
          <p className="mt-4 text-sm text-muted-foreground">
            With this in place, commands like &quot;show me the board&quot; or
            &quot;create a task&quot; will automatically target the configured
            idea. You can also set{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
              taskId
            </code>
            ,{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
              botId
            </code>
            , and{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
              defaultColumn
            </code>{" "}
            for even more context.
          </p>
        </section>

        {/* ── Activate Your Agent ─────────────────────────────────── */}
        <section>
          <h2 className="mb-4 text-2xl font-semibold">Activate Your Agent</h2>
          <p className="mb-4 text-muted-foreground">
            If you&apos;ve{" "}
            <Link href="/agents" className="text-primary hover:underline">
              created an agent
            </Link>
            , tell Claude Code to switch to that persona. The identity persists
            across sessions so you only need to do this once per agent:
          </p>
          <div className="rounded-lg bg-muted p-4">
            <code className="text-sm">
              &quot;Switch to my Developer agent&quot;
            </code>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            Claude Code will use the{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
              set_agent_identity
            </code>{" "}
            tool to adopt that agent&apos;s name, role, and system prompt. All
            subsequent actions (comments, task updates, etc.) will appear as that
            agent.
          </p>
          <div className="mt-4 rounded-xl border border-border bg-muted/30 p-6">
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">How identity works:</strong>{" "}
              When you activate an agent, your active identity (used for
              comments, assignments, and activity logs) switches to that agent.
              Your real user account remains the owner — things like votes,
              notifications, and idea authorship still belong to you. The
              identity persists in the database, so it carries across sessions
              until you switch again. Learn more in the{" "}
              <Link
                href="/guide/ai-agent-teams"
                className="text-primary hover:underline"
              >
                AI Agent Teams
              </Link>{" "}
              guide.
            </p>
          </div>
        </section>

        {/* ── Available Tools ─────────────────────────────────────── */}
        <section>
          <h2 className="mb-4 text-2xl font-semibold">Available Tools</h2>
          <p className="mb-4 text-muted-foreground">
            Once connected, Claude Code has access to{" "}
            <strong className="text-foreground">54 tools</strong> across 8
            categories:
          </p>

          <div className="space-y-2">
            <CollapsibleTools title="Ideas & Voting" toolCount={8}>
              <ToolTable
                tools={[
                  { name: "list_ideas", description: "List ideas with optional status filter and search" },
                  { name: "get_idea", description: "Full idea detail with comments, collaborators, and board summary" },
                  { name: "create_idea", description: "Create a new idea with title, description, tags, and visibility" },
                  { name: "delete_idea", description: "Delete an idea (author or admin only)" },
                  { name: "update_idea_description", description: "Rewrite an idea's description (markdown)" },
                  { name: "update_idea_status", description: "Update idea status: open, in_progress, completed, or archived" },
                  { name: "update_idea_tags", description: "Set or replace tags on an idea" },
                  { name: "toggle_vote", description: "Toggle your upvote on an idea" },
                ]}
              />
            </CollapsibleTools>

            <CollapsibleTools title="Board & Tasks" toolCount={13}>
              <ToolTable
                tools={[
                  { name: "get_board", description: "Kanban board overview with columns and task summaries" },
                  { name: "get_task", description: "Single task with workflow steps, comments, activity, and attachments" },
                  { name: "get_my_tasks", description: "Tasks assigned to you, grouped by idea" },
                  { name: "create_task", description: "Create a task on a board column" },
                  { name: "update_task", description: "Update task title, description, assignee, due date, or archive status" },
                  { name: "move_task", description: "Move a task to a different column" },
                  { name: "delete_task", description: "Delete a task permanently" },
                  { name: "create_column", description: "Create a new board column" },
                  { name: "update_column", description: "Update a column's title or done status" },
                  { name: "delete_column", description: "Delete an empty board column" },
                  { name: "reorder_columns", description: "Reorder columns by providing IDs in desired order" },
                  { name: "report_bug", description: "Create a task with a red 'Bug' label, assigned to you" },
                  { name: "manage_labels", description: "Create labels, add or remove them from tasks" },
                ]}
              />
            </CollapsibleTools>

            <CollapsibleTools title="Workflow Steps & Comments" toolCount={3}>
              <ToolTable
                tools={[
                  { name: "manage_checklist", description: "Add, update, or delete workflow steps on a task" },
                  { name: "add_idea_comment", description: "Comment on an idea (comment, suggestion, or question)" },
                  { name: "add_task_comment", description: "Comment on a board task" },
                ]}
              />
            </CollapsibleTools>

            <CollapsibleTools title="Collaboration" toolCount={3}>
              <ToolTable
                tools={[
                  { name: "add_collaborator", description: "Add a user as collaborator on an idea" },
                  { name: "remove_collaborator", description: "Remove a collaborator from an idea" },
                  { name: "list_collaborators", description: "List all collaborators on an idea" },
                ]}
              />
            </CollapsibleTools>

            <CollapsibleTools title="Discussions" toolCount={7}>
              <ToolTable
                tools={[
                  { name: "list_discussions", description: "List discussions for an idea with optional status filter" },
                  { name: "get_discussion", description: "Get a discussion thread with all replies" },
                  { name: "create_discussion", description: "Create a new discussion thread on an idea" },
                  { name: "update_discussion", description: "Update a discussion's title, body, status, or pinned state" },
                  { name: "delete_discussion", description: "Delete a discussion thread and all its replies" },
                  { name: "add_discussion_reply", description: "Reply to a discussion thread (supports nested replies)" },
                  { name: "get_discussions_ready_to_convert", description: "Find discussions queued for conversion to board tasks" },
                ]}
              />
            </CollapsibleTools>

            <CollapsibleTools title="Agents & Identity" toolCount={12}>
              <ToolTable
                tools={[
                  { name: "list_agents", description: "List your agent personas with name, role, and active status" },
                  { name: "get_agent_prompt", description: "Get the system prompt for a specific agent or active identity" },
                  { name: "set_agent_identity", description: "Switch to an agent persona (persisted across sessions)" },
                  { name: "create_agent", description: "Create a new agent with name, role, and system prompt" },
                  { name: "toggle_agent_vote", description: "Upvote or remove vote on a community agent" },
                  { name: "clone_agent", description: "Clone a published agent into your account" },
                  { name: "publish_agent", description: "Publish or unpublish an agent to the community" },
                  { name: "list_community_agents", description: "Browse published agents from all users" },
                  { name: "list_featured_teams", description: "List admin-curated featured agent team templates" },
                  { name: "allocate_agent", description: "Add your agent to an idea's shared agent pool" },
                  { name: "remove_idea_agent", description: "Remove an agent from an idea's pool" },
                  { name: "list_idea_agents", description: "List agents in an idea's shared agent pool" },
                ]}
              />
            </CollapsibleTools>

            <CollapsibleTools title="Notifications & Profile" toolCount={5}>
              <ToolTable
                tools={[
                  { name: "list_notifications", description: "List notifications with optional unread-only filter" },
                  { name: "mark_notification_read", description: "Mark a single notification as read" },
                  { name: "mark_all_notifications_read", description: "Mark all unread notifications as read" },
                  { name: "get_agent_mentions", description: "Get unread @mentions for your agents in discussions" },
                  { name: "update_profile", description: "Update your profile (name, bio, GitHub, avatar, contact)" },
                ]}
              />
            </CollapsibleTools>

            <CollapsibleTools title="Attachments" toolCount={3}>
              <ToolTable
                tools={[
                  { name: "list_attachments", description: "List task attachments with signed download URLs" },
                  { name: "upload_attachment", description: "Upload a file to a task (max 10MB, base64)" },
                  { name: "delete_attachment", description: "Delete an attachment from a task" },
                ]}
              />
            </CollapsibleTools>
          </div>
        </section>

        {/* ── Example Workflows ───────────────────────────────────── */}
        <section>
          <h2 className="mb-4 text-2xl font-semibold">Example Workflows</h2>
          <p className="mb-6 text-muted-foreground">
            Here are some things you can ask Claude Code once connected:
          </p>

          <div className="space-y-6">
            <div>
              <h3 className="mb-3 text-lg font-medium">Getting Started</h3>
              <div className="space-y-2">
                <div className="rounded-lg bg-muted p-4">
                  <code className="text-sm">
                    &quot;List all my in-progress ideas&quot;
                  </code>
                </div>
                <div className="rounded-lg bg-muted p-4">
                  <code className="text-sm">
                    &quot;Show me the board for my authentication idea&quot;
                  </code>
                </div>
              </div>
            </div>

            <div>
              <h3 className="mb-3 text-lg font-medium">Task Management</h3>
              <div className="space-y-2">
                <div className="rounded-lg bg-muted p-4">
                  <code className="text-sm">
                    &quot;Create a task for implementing the login form in the To
                    Do column&quot;
                  </code>
                </div>
                <div className="rounded-lg bg-muted p-4">
                  <code className="text-sm">
                    &quot;Move the API design task to In Progress and assign it
                    to me&quot;
                  </code>
                </div>
                <div className="rounded-lg bg-muted p-4">
                  <code className="text-sm">
                    &quot;What tasks are assigned to me across all my
                    projects?&quot;
                  </code>
                </div>
                <div className="rounded-lg bg-muted p-4">
                  <code className="text-sm">
                    &quot;Report a bug: the signup form doesn&apos;t validate
                    email format&quot;
                  </code>
                </div>
              </div>
            </div>

            <div>
              <h3 className="mb-3 text-lg font-medium">Collaboration</h3>
              <div className="space-y-2">
                <div className="rounded-lg bg-muted p-4">
                  <code className="text-sm">
                    &quot;Add me as a collaborator on the &apos;Dark mode&apos;
                    idea&quot;
                  </code>
                </div>
              </div>
            </div>

            <div>
              <h3 className="mb-3 text-lg font-medium">Agents</h3>
              <div className="space-y-2">
                <div className="rounded-lg bg-muted p-4">
                  <code className="text-sm">
                    &quot;Switch to my Developer agent&quot;
                  </code>
                </div>
                <div className="rounded-lg bg-muted p-4">
                  <code className="text-sm">
                    &quot;Create a QA agent with the role &apos;QA
                    Tester&apos;&quot;
                  </code>
                </div>
              </div>
            </div>

            <div>
              <h3 className="mb-3 text-lg font-medium">Discussions</h3>
              <div className="space-y-2">
                <div className="rounded-lg bg-muted p-4">
                  <code className="text-sm">
                    &quot;Start a discussion about the API design on my project
                    idea&quot;
                  </code>
                </div>
                <div className="rounded-lg bg-muted p-4">
                  <code className="text-sm">
                    &quot;Show discussions that are ready to convert into
                    tasks&quot;
                  </code>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Troubleshooting ─────────────────────────────────────── */}
        <section>
          <h2 className="mb-4 text-2xl font-semibold">Troubleshooting</h2>
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-muted/30 p-6">
              <p className="mb-2 text-sm font-medium text-foreground">
                OAuth window doesn&apos;t open
              </p>
              <p className="text-sm text-muted-foreground">
                Make sure your default browser is accessible. If the issue
                persists, remove and re-add the server:{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  claude mcp remove vibecodes-remote
                </code>{" "}
                then run the add command again.
              </p>
            </div>

            <div className="rounded-xl border border-border bg-muted/30 p-6">
              <p className="mb-2 text-sm font-medium text-foreground">
                Permission denied on a tool call
              </p>
              <p className="text-sm text-muted-foreground">
                VibeCodes enforces the same permissions as the web app. Make sure
                you&apos;re a team member or collaborator on the idea
                you&apos;re trying to modify. Public ideas allow read access but
                not writes.
              </p>
            </div>

            <div className="rounded-xl border border-border bg-muted/30 p-6">
              <p className="mb-2 text-sm font-medium text-foreground">
                Tool not found
              </p>
              <p className="text-sm text-muted-foreground">
                Ensure you have the latest version of Claude Code installed. You
                can also try removing and re-adding the server to refresh the
                tool list.
              </p>
            </div>

            <div className="rounded-xl border border-border bg-muted/30 p-6">
              <p className="mb-2 text-sm font-medium text-foreground">
                Connection timeout
              </p>
              <p className="text-sm text-muted-foreground">
                Check your internet connection and ensure VibeCodes is
                accessible at{" "}
                <a
                  href="https://vibecodes.co.uk"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  vibecodes.co.uk
                </a>
                . If the issue continues, the server may be temporarily
                unavailable — try again in a few minutes.
              </p>
            </div>

            <div className="rounded-xl border border-border bg-muted/30 p-6">
              <p className="mb-2 text-sm font-medium text-foreground">
                Tools not available after adding the server
              </p>
              <p className="text-sm text-muted-foreground">
                If Claude Code doesn&apos;t recognize VibeCodes tools after
                running the add command, restart Claude Code by exiting and
                reopening it. The tool list is loaded on startup and won&apos;t
                include newly added servers until the next session.
              </p>
            </div>
          </div>
        </section>

        {/* ── Local Server ────────────────────────────────────────── */}
        <section>
          <h2 className="mb-4 text-2xl font-semibold">
            Local Server (Contributors Only)
          </h2>
          <p className="mb-4 text-muted-foreground">
            This section is only for developers who have cloned the VibeCodes
            repo and are contributing to the codebase. Most users should use the{" "}
            <strong className="text-foreground">remote server</strong> above.
          </p>
          <p className="mb-4 text-muted-foreground">
            The local MCP server runs over stdio and is configured via a{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
              .mcp.json
            </code>{" "}
            file in the project root. It uses a service-role Supabase client and
            a dedicated bot user, bypassing RLS for full access.
          </p>
          <p className="mb-4 text-sm text-muted-foreground">
            Example{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
              .mcp.json
            </code>
            :
          </p>
          <CodeBlock
            code={`{
  "mcpServers": {
    "vibecodes": {
      "command": "npx",
      "args": ["tsx", "mcp-server/src/index.ts"],
      "env": {
        "SUPABASE_URL": "http://127.0.0.1:54321",
        "SUPABASE_SERVICE_ROLE_KEY": "your-service-role-key"
      }
    }
  }
}`}
          />
          <p className="mt-4 text-sm text-muted-foreground">
            Requires a running local Supabase instance (
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
              npm run supabase:start
            </code>
            ). The service-role key can be found in{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
              mcp-server/.env
            </code>
            .
          </p>
        </section>
      </div>

      <div className="mt-12 flex justify-between border-t border-border pt-6">
        <Link href="/guide/kanban-boards">
          <Button variant="outline" className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Kanban Boards
          </Button>
        </Link>
        <Link href="/guide/ai-agent-teams">
          <Button variant="outline" className="gap-2">
            AI Agent Teams
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      </div>
    </div>
  );
}
