import Link from "next/link";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { IdeaCard } from "@/components/ideas/idea-card";
import type { IdeaWithAuthor, Comment } from "@/types";
import { formatRelativeTime } from "@/lib/utils";
import { CommentTypeBadge } from "@/components/comments/comment-type-badge";
import { Markdown } from "@/components/ui/markdown";

interface ProfileTabsProps {
  ideas: IdeaWithAuthor[];
  collaborations: IdeaWithAuthor[];
  // No `author` — this tab never renders it (every comment here is already
  // known to be the profile owner's), so the page doesn't fetch a full
  // stranger's-eye-view user row just to satisfy this prop's type.
  comments: (Comment & { idea_title?: string })[];
  userVotes: string[];
  taskCounts: Record<string, number>;
  isOwnProfile?: boolean;
}

export function ProfileTabs({
  ideas,
  collaborations,
  comments,
  userVotes,
  taskCounts,
  isOwnProfile,
}: ProfileTabsProps) {
  return (
    <Tabs defaultValue="ideas" className="mt-6">
      <TabsList className="w-full justify-start">
        <TabsTrigger value="ideas">{isOwnProfile ? "My Ideas" : "Ideas"} ({ideas.length})</TabsTrigger>
        <TabsTrigger value="collaborating">
          {isOwnProfile ? "Collaborating" : "Collaborations"} ({collaborations.length})
        </TabsTrigger>
        <TabsTrigger value="comments">Comments ({comments.length})</TabsTrigger>
      </TabsList>
      <TabsContent value="ideas" className="mt-4">
        {ideas.length === 0 ? (
          <p className="py-8 text-center text-muted-foreground">
            No ideas yet.
          </p>
        ) : (
          <div className="space-y-4">
            {ideas.map((idea) => (
              <IdeaCard
                key={idea.id}
                idea={idea}
                hasVoted={userVotes.includes(idea.id)}
                taskCount={taskCounts[idea.id]}
              />
            ))}
          </div>
        )}
      </TabsContent>
      <TabsContent value="collaborating" className="mt-4">
        {collaborations.length === 0 ? (
          <p className="py-8 text-center text-muted-foreground">
            Not collaborating on any ideas yet.
          </p>
        ) : (
          <div className="space-y-4">
            {collaborations.map((idea) => (
              <IdeaCard
                key={idea.id}
                idea={idea}
                hasVoted={userVotes.includes(idea.id)}
                taskCount={taskCounts[idea.id]}
              />
            ))}
          </div>
        )}
      </TabsContent>
      <TabsContent value="comments" className="mt-4">
        {comments.length === 0 ? (
          <p className="py-8 text-center text-muted-foreground">
            No comments yet.
          </p>
        ) : (
          <div className="space-y-3">
            {comments.map((comment) => (
              <div
                key={comment.id}
                className="rounded-lg border border-border bg-card p-4"
              >
                <div className="flex items-center gap-2 mb-2">
                  <CommentTypeBadge type={comment.type} />
                  <span className="text-xs text-muted-foreground">
                    {formatRelativeTime(comment.created_at)}
                  </span>
                  <span className="text-xs text-muted-foreground">on</span>
                  <Link
                    href={`/ideas/${comment.idea_id}`}
                    className="text-xs font-medium text-primary hover:underline truncate"
                  >
                    {comment.idea_title ?? "Idea"}
                  </Link>
                </div>
                <div className="text-sm">
                  <Markdown>{comment.content}</Markdown>
                </div>
              </div>
            ))}
          </div>
        )}
      </TabsContent>
    </Tabs>
  );
}
