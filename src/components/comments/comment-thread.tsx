import { Separator } from "@/components/ui/separator";
import { CommentItem } from "./comment-item";
import { CommentForm } from "./comment-form";
import { ScrollToHash } from "@/components/scroll-to-hash";
import type { CommentWithAuthor, User } from "@/types";

interface CommentThreadProps {
  comments: CommentWithAuthor[];
  ideaId: string;
  ideaAuthorId: string;
  currentUserId?: string;
  userBotIds?: string[];
  teamMembers?: User[];
}

export function CommentThread({
  comments,
  ideaId,
  ideaAuthorId,
  currentUserId,
  userBotIds,
  teamMembers = [],
}: CommentThreadProps) {
  return (
    <div>
      <ScrollToHash />
      <h3 className="mb-4 text-lg font-semibold">
        Comments ({comments.length})
      </h3>

      {currentUserId && (
        <>
          <CommentForm
            ideaId={ideaId}
            teamMembers={teamMembers}
            currentUserId={currentUserId}
          />
          <Separator className="my-6" />
        </>
      )}

      {comments.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No comments yet. Be the first to share your thoughts!
        </p>
      ) : (
        <div className="divide-y divide-border">
          {comments.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              ideaId={ideaId}
              ideaAuthorId={ideaAuthorId}
              currentUserId={currentUserId}
              userBotIds={userBotIds}
              teamMembers={teamMembers}
            />
          ))}
        </div>
      )}
    </div>
  );
}
