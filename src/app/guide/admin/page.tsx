import Link from "next/link";
import { Shield, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

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
            <li>Toggle AI access on or off for any user</li>
            <li>Adjust per-user daily AI call limits</li>
            <li>Delete any idea (not just their own)</li>
            <li>Delete non-admin user accounts</li>
            <li>View private ideas (even without being a collaborator)</li>
          </ul>
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
              who may need their daily limits adjusted.
            </p>
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">User Management</h2>
          <p className="mb-4 text-muted-foreground">
            The admin dashboard includes a user management table where you can
            control AI access for each user:
          </p>
          <ul className="list-inside list-disc space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">Toggle AI access</strong>{" "}
              — enable or disable AI features for any user. When disabled, all
              AI buttons are hidden from that user&apos;s interface.
            </li>
            <li>
              <strong className="text-foreground">Set daily limits</strong>{" "}
              — adjust the per-user daily AI call cap. The default is 10 calls
              per day. Set to unlimited for trusted users.
            </li>
            <li>
              <strong className="text-foreground">View usage</strong> — see
              each user&apos;s current usage against their daily limit
            </li>
          </ul>
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

      <div className="mt-12 flex justify-start border-t border-border pt-6">
        <Link href="/guide/ai-agent-teams">
          <Button variant="outline" className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            AI Agent Teams
          </Button>
        </Link>
      </div>
    </div>
  );
}
