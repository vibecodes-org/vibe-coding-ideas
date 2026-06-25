import Link from "next/link";
import { Shield, ArrowLeft } from "lucide-react";

export const metadata = {
  title: "Admin Guide",
  description:
    "Admin features on VibeCodes — AI usage analytics, per-user rate limits, user management, and content moderation.",
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
            <li>View the AI usage analytics dashboard</li>
            <li>Grant AI starter credits to any user</li>
            <li>View per-user credit balances and platform AI costs</li>
            <li>Manage Featured Agent Teams and Project Kits</li>
            <li>View private ideas (even without being a collaborator)</li>
          </ul>
          <div className="mt-4 rounded-xl border border-border bg-muted/30 p-6">
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">Super admins:</strong>{" "}
              destructive operations — such as deleting other users&apos;
              ideas or non-admin accounts — are gated behind a separate{" "}
              <strong className="text-foreground">is_super_admin</strong>{" "}
              flag. A regular admin can monitor and grant credits but cannot
              perform these destructive actions.
            </p>
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">AI Usage Dashboard</h2>
          <p className="mb-4 text-muted-foreground">
            The admin page at{" "}
            <strong className="text-foreground">/admin</strong> provides a
            comprehensive view of AI usage across the platform. The dashboard
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
              by date range and action type (enhance idea, generate tasks, etc.)
            </li>
            <li>
              <strong className="text-foreground">Recent activity log</strong>{" "}
              — a chronological list of all AI calls showing user, action,
              token counts, and model used
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
            table for managing each user&apos;s free AI allowance:
          </p>
          <ul className="list-inside list-disc space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">Grant credits</strong>{" "}
              — add AI starter credits to any user (1–100 at a time). New users
              start with 10 free credits; these are a lifetime allowance, not a
              daily reset.
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
              separately from per-user credits, the platform enforces a global
              daily limit on platform-key AI calls (the{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                PLATFORM_AI_DAILY_LIMIT
              </code>{" "}
              environment variable, default 50). This is an abuse backstop, not
              a per-user allocation.
            </p>
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">
            Featured Teams & Project Kits
          </h2>
          <p className="mb-4 text-muted-foreground">
            Admins can also manage{" "}
            <strong className="text-foreground">Featured Agent Teams</strong>{" "}
            — curated collections of agents that appear in the Agents Hub for
            all users to clone.{" "}
            <strong className="text-foreground">Project Kits</strong>, which
            bundle agents, workflows, labels, and triggers for specific project
            types, are also managed by admins.
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
              — remove non-admin user accounts. This permanently deletes the
              user and cascades to all their data. Admin accounts cannot be
              deleted by other admins.
            </li>
          </ul>
          <div className="rounded-xl border border-border bg-muted/30 p-6">
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">Note:</strong> Deletion is
              permanent and cannot be undone. Notifications that referenced
              deleted ideas will persist but show the idea as removed.
            </p>
          </div>
        </section>
      </div>

    </div>
  );
}
