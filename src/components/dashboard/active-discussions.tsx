import Link from "next/link";
import { MessageSquare, MessagesSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatRelativeTime } from "@/lib/utils";

export interface ActiveDiscussion {
  id: string;
  idea_id: string;
  title: string;
  status: string;
  reply_count: number;
  last_activity_at: string;
  idea_title: string;
}

interface ActiveDiscussionsProps {
  discussions: ActiveDiscussion[];
}

const STATUS_CLASSES: Record<string, string> = {
  open: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  ready_to_convert: "bg-amber-500/10 text-amber-400 border-amber-500/20",
};

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  ready_to_convert: "Ready",
};

export function ActiveDiscussions({ discussions }: ActiveDiscussionsProps) {
  if (discussions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center">
        <MessagesSquare className="mx-auto h-8 w-8 text-muted-foreground/50" />
        <p className="mt-3 text-sm font-medium">Active Discussions</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Plan features with your team before building. Discussions are available on each idea page.
        </p>
        <div className="mt-4">
          <Link href="/ideas">
            <Button variant="outline" size="sm">
              Browse ideas &rarr;
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {discussions.map((d) => (
        <Link
          key={d.id}
          href={`/ideas/${d.idea_id}/discussions/${d.id}`}
          className="flex items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-muted/50 transition-colors"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-sm">{d.title}</p>
            <p className="truncate text-xs text-muted-foreground">{d.idea_title}</p>
          </div>
          <Badge variant="outline" className={`shrink-0 text-[10px] ${STATUS_CLASSES[d.status] ?? ""}`}>
            {STATUS_LABELS[d.status] ?? d.status}
          </Badge>
          <span className="shrink-0 flex items-center gap-1 text-xs text-muted-foreground">
            <MessageSquare className="h-3 w-3" />
            {d.reply_count}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground whitespace-nowrap">
            {formatRelativeTime(d.last_activity_at)}
          </span>
        </Link>
      ))}
    </div>
  );
}
