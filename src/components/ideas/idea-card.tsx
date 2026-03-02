import Link from "next/link";
import { MessageSquare, Users, LayoutDashboard, Github, Lock, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { IdeaStatusBadge } from "./idea-status-badge";
import { VoteButton } from "./vote-button";
import { formatRelativeTime, getInitials, stripMarkdown } from "@/lib/utils";
import type { IdeaWithAuthor } from "@/types";

interface IdeaCardProps {
  idea: IdeaWithAuthor;
  hasVoted: boolean;
  taskCount?: number;
}

export function IdeaCard({ idea, hasVoted, taskCount }: IdeaCardProps) {
  const initials = getInitials(idea.author.full_name);

  return (
    <Card data-testid={`idea-card-${idea.id}`} className="group/card relative transition-colors hover:border-primary/30">
      {/* Full-card clickable overlay */}
      <Link
        href={`/ideas/${idea.id}`}
        className="absolute inset-0 z-0"
        aria-label={idea.title}
        tabIndex={-1}
      />
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <div className="relative z-10">
            <VoteButton
              ideaId={idea.id}
              upvotes={idea.upvotes}
              hasVoted={hasVoted}
            />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <Link
                href={`/ideas/${idea.id}`}
                className="relative z-10 text-lg font-semibold hover:text-primary transition-colors line-clamp-1"
              >
                {idea.title}
              </Link>
              {idea.visibility === "private" && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Lock className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>Private</TooltipContent>
                </Tooltip>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
              {stripMarkdown(idea.description)}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center gap-2">
          <IdeaStatusBadge status={idea.status} />
          {idea.tags.slice(0, 3).map((tag) => (
            <Badge key={tag} variant="secondary" className="text-xs">
              {tag}
            </Badge>
          ))}
          {idea.tags.length > 3 && (
            <Badge variant="secondary" className="text-xs">
              +{idea.tags.length - 3}
            </Badge>
          )}
        </div>
        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <Avatar className="h-5 w-5">
                <AvatarImage src={idea.author.avatar_url ?? undefined} />
                <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
              </Avatar>
              <span>{idea.author.full_name ?? "Anonymous"}</span>
              {idea.author.is_admin && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <ShieldCheck className="h-3 w-3 text-primary" />
                  </TooltipTrigger>
                  <TooltipContent>Admin</TooltipContent>
                </Tooltip>
              )}
            </div>
            <span>{formatRelativeTime(idea.created_at)}</span>
          </div>
          <div className="relative z-10 flex items-center gap-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex items-center gap-1">
                  <MessageSquare className="h-3.5 w-3.5" />
                  {idea.comment_count}
                </span>
              </TooltipTrigger>
              <TooltipContent>Comments</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex items-center gap-1">
                  <Users className="h-3.5 w-3.5" />
                  {idea.collaborator_count}
                </span>
              </TooltipTrigger>
              <TooltipContent>Collaborators</TooltipContent>
            </Tooltip>
            {taskCount != null && taskCount > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    href={`/ideas/${idea.id}/board`}
                    className="flex items-center gap-1 hover:text-primary transition-colors"
                  >
                    <LayoutDashboard className="h-3.5 w-3.5" />
                    {taskCount}
                  </Link>
                </TooltipTrigger>
                <TooltipContent>View board</TooltipContent>
              </Tooltip>
            )}
            {idea.github_url && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex items-center gap-1">
                    <Github className="h-3.5 w-3.5" />
                  </span>
                </TooltipTrigger>
                <TooltipContent>GitHub repository</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
