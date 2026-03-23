import Link from "next/link";
import {
  MessageSquare,
  Check,
  ClipboardCheck,
  ArrowRightLeft,
  Archive,
  Pin,
  MessagesSquare,
  Plus,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatRelativeTime } from "@/lib/utils";
import type { IdeaDiscussionWithAuthor } from "@/types";

const STATUS_CONFIG = {
  open: { label: "Open", icon: MessageSquare, className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  resolved: { label: "Resolved", icon: Check, className: "bg-violet-500/10 text-violet-400 border-violet-500/20" },
  ready_to_convert: { label: "Ready", icon: ClipboardCheck, className: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  converted: { label: "Converted", icon: ArrowRightLeft, className: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  archived: { label: "Archived", icon: Archive, className: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20" },
} as const;

interface RecentDiscussionsPreviewProps {
  discussions: IdeaDiscussionWithAuthor[];
  ideaId: string;
  discussionCount: number;
  isTeamMember: boolean;
}

export function RecentDiscussionsPreview({
  discussions,
  ideaId,
  discussionCount,
  isTeamMember,
}: RecentDiscussionsPreviewProps) {
  return (
    <div className="mt-4 rounded-xl border border-border bg-card p-4 sm:p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <MessagesSquare className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Discussions</h3>
          {discussionCount > 0 && (
            <span className="rounded-full bg-violet-500/10 border border-violet-500/20 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-violet-400">
              {discussionCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isTeamMember && (
            <Link href={`/ideas/${ideaId}/discussions/new`}>
              <Button variant="outline" size="sm" className="h-7 gap-1 text-xs">
                <Plus className="h-3 w-3" />
                New
              </Button>
            </Link>
          )}
          {discussionCount > 0 && (
            <Link
              href={`/ideas/${ideaId}/discussions`}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              View All &rarr;
            </Link>
          )}
        </div>
      </div>

      {/* Discussion rows or empty state */}
      {discussions.length > 0 ? (
        <div className="space-y-1">
          {discussions.map((d) => {
            const config = STATUS_CONFIG[d.status];
            const StatusIcon = config.icon;
            return (
              <Link
                key={d.id}
                href={`/ideas/${ideaId}/discussions/${d.id}`}
                className="flex items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50 transition-colors"
              >
                {d.pinned && <Pin className="h-3 w-3 shrink-0 text-amber-400" />}
                <span className="flex-1 truncate">{d.title}</span>
                <Badge variant="outline" className={`shrink-0 text-[10px] gap-1 ${config.className}`}>
                  <StatusIcon className="h-2.5 w-2.5" />
                  {config.label}
                </Badge>
                <span className="shrink-0 flex items-center gap-1 text-xs text-muted-foreground">
                  <MessageSquare className="h-3 w-3" />
                  {d.reply_count}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatRelativeTime(d.last_activity_at)}
                </span>
              </Link>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground py-2">
          Start a discussion to plan features, debate approaches, or gather feedback before creating board tasks.
        </p>
      )}
    </div>
  );
}
