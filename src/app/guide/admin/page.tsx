import Link from "next/link";
import { Shield, ArrowLeft } from "lucide-react";

export const metadata = {
  title: "Admin Guide",
  description:
    "Admin features on VibeCodes: AI usage and costs, feedback, the agent and workflow libraries, featured teams, and the cost report.",
};

export default function AdminPage() {
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
          <Shield className="h-6 w-6 text-violet-400" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Admin</h1>
      </div>

      <div className="space-y-10">
        <section>
          <h2 className="mb-4 text-2xl font-semibold">Admin Role</h2>
          <p className="mb-4 text-muted-foreground">
            Admin users have elevated permissions across VibeCodes. The admin
            role is controlled by the{" "}
            <strong className="text-foreground">is_admin</strong> flag on the
            user record. Admins can:
          </p>
          <ul className="list-inside list-disc space-y-2 text-muted-foreground">
            <li>Open the Admin page and its tabs (listed below)</li>
            <li>View per-user credit balances and platform AI costs</li>
            <li>Manage the library of ready-made agents, workflows and Featured Teams</li>
            <li>Read user feedback and the MCP tool usage figures</li>
            <li>Delete any idea</li>
            <li>View private ideas (even without being a collaborator)</li>
          </ul>
          <div className="mt-4 rounded-xl border border-border bg-muted/30 p-6">
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">Super admins:</strong>{" "}
              a few operations are gated behind a separate{" "}
              <strong className="text-foreground">is_super_admin</strong>{" "}
              flag: granting AI credits, deleting users, and the Platform tab.
              A regular admin can monitor everything else, including deleting
              an idea, but cannot do these.
            </p>
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">In-app AI Dashboard</h2>
          <p className="mb-4 text-muted-foreground">
            The admin page at{" "}
            <strong className="text-foreground">/admin</strong> has these
            tabs:{" "}
            <strong className="text-foreground">In-app AI</strong>,{" "}
            <strong className="text-foreground">Feedback</strong>,{" "}
            <strong className="text-foreground">Agents</strong>,{" "}
            <strong className="text-foreground">Teams</strong>,{" "}
            <strong className="text-foreground">Workflows</strong>,{" "}
            <strong className="text-foreground">MCP Tools</strong>,{" "}
            <strong className="text-foreground">Token usage</strong> and{" "}
            <strong className="text-foreground">Platform</strong> (super admins
            only). The In-app AI tab shows AI usage across the platform and
            includes:
          </p>
          <ul className="mb-4 list-inside list-disc space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">Stats cards</strong> — total
              AI calls, total tokens used, estimated cost, and a breakdown of
              platform vs BYOK (bring-your-own-key) usage
            </li>
            <li>
              <strong className="text-foreground">Filter bar</strong> — filter
              by date range and action type (draft or expand an idea, generate tasks, etc.)
            </li>
            <li>
              <strong className="text-foreground">Recent activity log</strong>{" "}
              — a chronological list of the latest 1,000 AI calls showing
              user, action, source, token counts and time
            </li>
          </ul>
          <div className="rounded-xl border border-border bg-muted/30 p-6">
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">Tip:</strong> Use the date
              range filter to track usage trends over time and identify users
              who may need more starter credits.
            </p>
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">User Credits</h2>
          <p className="mb-4 text-muted-foreground">
            The admin dashboard includes a{" "}
            <strong className="text-foreground">
              User Credits &amp; Platform Costs
            </strong>{" "}
            table showing each user&apos;s AI allowance:
          </p>
          <ul className="list-inside list-disc space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">Grant credits</strong>{" "}
              (super admins only) — add AI starter credits to any user (1–100
              at a time). New users start with 10 starter credits; these are a
              lifetime allowance, not a daily reset.
            </li>
            <li>
              <strong className="text-foreground">View balances</strong>{" "}
              — see each user&apos;s credits remaining, credits used, and the
              estimated platform cost they&apos;ve incurred.
            </li>
            <li>
              <strong className="text-foreground">Bring-your-own-key</strong>{" "}
              — users who add their own Anthropic API key bypass the credit
              system entirely, so they never consume starter credits.
            </li>
          </ul>
          <div className="mt-4 rounded-xl border border-border bg-muted/30 p-6">
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">Daily safety cap:</strong>{" "}
              separately from credits, the platform limits how many
              platform-key AI calls each person can make per day (the{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                PLATFORM_AI_DAILY_LIMIT
              </code>{" "}
              environment variable, default 50). This is an abuse backstop, not
              an allowance.
            </p>
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">Token Usage</h2>
          <p className="mb-4 text-muted-foreground">
            The <strong className="text-foreground">Token usage</strong> tab
            shows what workflow steps cost, whether that is going up or down,
            and what each step contributes, for one board or all boards,
            over the last 30, 60 or 90 days or all time. For each template it
            lists every step&apos;s runs, how often its agent caught a problem
            and sent work back, how often a person rejected it at its approval
            gate, how often it had to redo work, its median time, the model it
            ran on, and its cost per run. The main table lists every step of
            the template as it is now, marked &ldquo;Not run yet&rdquo; until
            one has run, and counts only runs that used exactly those steps.
            Runs of the template&apos;s earlier versions are listed separately,
            all their steps included, so old and new numbers don&apos;t mix.
            Under the steps, <strong className="text-foreground">Sum of steps</strong>{" "}
            adds up the rows above it (a * means a step with no figure was
            skipped), and <strong className="text-foreground">Typical whole
            run (incl. redos)</strong> is the median of real finished runs,
            redo rounds counted. The two won&apos;t match, because the step
            rows are medians of single steps.
          </p>
          <p className="mb-4 text-muted-foreground">
            Above the tables, three charts follow the Board and Period
            filters. <strong className="text-foreground">Cost per week, by model</strong>{" "}
            stacks Opus, Sonnet and other models (bars are days when the period
            is 30 days, weeks otherwise; this week is drawn lighter and marked
            &ldquo;so far&rdquo;). Under each bar is the share of finished steps
            that recorded a cost, shown in amber when it is under 80%, because
            that bar is then short of the real cost. Numbered dashed lines mark
            the dates a change to how steps run went live, with a list under the
            chart. <strong className="text-foreground">Typical cost of a finished run</strong>{" "}
            draws one line per workflow (the three with the most runs): the
            median per week of runs where every finished step has a cost.
            That is looser than the &ldquo;Typical whole run&rdquo; figure in
            the tables, which also needs the run to use exactly today&apos;s
            steps, so the two differ a little.{" "}
            <strong className="text-foreground">Runs sent back at least once</strong>{" "}
            shows the share of finished runs that had work sent back, so a
            cheaper run can&apos;t hide worse work. Only workflow steps record
            their cost: terminal chat between cards, Codex steps, steps
            finished in a different session from the one that started them and
            the app&apos;s own AI buttons (the In-app AI tab) are not counted.
            Each chart has a &ldquo;Show these figures as a table&rdquo; link.
          </p>
          <p className="mb-4 text-muted-foreground">
            Cost is what the tokens would cost at Anthropic API prices. When a
            step&apos;s work is done, the Claude Code session totals its own
            token use since the claim, plus that of any subagent that did the
            work, from its local transcripts, and reports it with the step.
            A Claude step can&apos;t be finished without that report, or a
            stated reason it couldn&apos;t be made, so a cost is never lost
            silently. When a session says why a step&apos;s cost couldn&apos;t
            be measured, the reason is kept with the step, and the Token usage
            page counts those steps separately from ones where nothing was
            reported.
            Output tokens are estimated from text length, so totals are within
            about 10%. Codex steps and steps run in a different session from
            the one that claimed them show no cost.
          </p>
          <p className="mb-4 text-muted-foreground">
            The same prices and per-step costs are available to agents through
            the read-only <code className="rounded bg-muted px-1.5 py-0.5 text-xs">get_cost_report</code>{" "}
            MCP tool, as weekly figures for the boards the caller belongs to.
            It returns names and numbers only, never card content or prompts.
            It also reports the main window&apos;s own usage between steps, per
            board and week, and the week&apos;s busiest sessions. Those figures
            come from in-app Claude sessions only, as totals the Mac app sends
            (a Mac app older than the release that added this shows zero), and
            never overlap the step figures.
          </p>
          <p className="text-muted-foreground">
            For runs from before cost tracking, run{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
              node scripts/step-usage-backfill.mjs
            </code>{" "}
            from the VibeCodes repo on each machine that ran workflow steps. It
            reads the transcripts still on disk (Claude Code keeps about 30
            days), works out each step attempt&apos;s cost the same way, and
            writes a file holding only step ids, times and token counts. Choose{" "}
            <strong className="text-foreground">Import past cost</strong> on the
            report and pick that file. Steps that already have a cost are left
            alone, so importing a file twice changes nothing. If a step&apos;s
            helper cost was imported on its own, run the script with{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
              --session-share --steps &lt;file&gt;
            </code>{" "}
            to add just the claiming session&apos;s share to steps that already
            have a cost; importing that file twice still changes nothing.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">
            Agents, Teams and Workflows
          </h2>
          <p className="mb-4 text-muted-foreground">
            The <strong className="text-foreground">Agents</strong> tab manages
            the VibeCodes agents that appear in the library of ready-made
            agents. The <strong className="text-foreground">Teams</strong> tab
            manages{" "}
            <strong className="text-foreground">Featured Agent Teams</strong>{" "}
            — curated collections of agents that appear in the Agents Hub for
            all users to add in one go. The{" "}
            <strong className="text-foreground">Workflows</strong> tab manages
            the library of ready-made workflows users can import. Project types
            have no admin screen; they are set up by the VibeCodes team.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">Content Moderation</h2>
          <p className="mb-4 text-muted-foreground">
            Admins have moderation capabilities to keep the platform clean:
          </p>
          <ul className="list-inside list-disc space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">Delete any idea</strong>{" "}
              — remove ideas that violate guidelines, along with all associated
              data (comments, votes, boards)
            </li>
            <li>
              <strong className="text-foreground">Delete users</strong>{" "}
              (super admins only) — remove non-admin user accounts. This permanently deletes the
              user and cascades to all their data. Admin accounts are protected from deletion by other admins.
            </li>
          </ul>
          <div className="rounded-xl border border-border bg-muted/30 p-6">
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">Note:</strong> Deletion is
              permanent and cannot be undone.
            </p>
          </div>
        </section>
      </div>

    </div>
  );
}
