import { Github, Calendar, AtSign, ShieldCheck } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { formatRelativeTime, getInitials } from "@/lib/utils";
import type { User } from "@/types";

interface ProfileHeaderProps {
  user: User;
  ideaCount: number;
  collaborationCount: number;
  commentCount: number;
  tasksCreated?: number;
  tasksCompleted?: number;
}

export function ProfileHeader({
  user,
  ideaCount,
  collaborationCount,
  commentCount,
  tasksCreated = 0,
  tasksCompleted = 0,
}: ProfileHeaderProps) {
  const initials = getInitials(user.full_name);

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="flex flex-col items-center gap-4 sm:flex-row">
        <Avatar className="h-20 w-20">
          <AvatarImage src={user.avatar_url ?? undefined} />
          <AvatarFallback className="text-2xl">{initials}</AvatarFallback>
        </Avatar>
        <div className="flex-1 text-center sm:text-left">
          <div className="flex items-center justify-center gap-2 sm:justify-start">
            <h1 className="text-2xl font-bold">
              {user.full_name ?? "Anonymous"}
            </h1>
            {user.is_admin && (
              <Badge variant="secondary" className="gap-1">
                <ShieldCheck className="h-3 w-3" />
                Admin
              </Badge>
            )}
          </div>
          {user.bio && (
            <p className="mt-1 text-muted-foreground">{user.bio}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center justify-center gap-3 sm:justify-start">
            {user.github_username && (
              <a
                href={`https://github.com/${user.github_username}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              >
                <Github className="h-4 w-4" />
                {user.github_username}
              </a>
            )}
            {user.contact_info && (
              <span className="flex items-center gap-1 text-sm text-muted-foreground">
                <AtSign className="h-4 w-4" />
                {user.contact_info}
              </span>
            )}
            <span className="flex items-center gap-1 text-sm text-muted-foreground">
              <Calendar className="h-4 w-4" />
              Joined {formatRelativeTime(user.created_at)}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-3 gap-4 border-t border-border pt-4 sm:grid-cols-5">
        <div className="text-center">
          <p className="text-2xl font-bold">{ideaCount}</p>
          <p className="text-sm text-muted-foreground">Ideas</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold">{collaborationCount}</p>
          <p className="text-sm text-muted-foreground">Collaborating</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold">{commentCount}</p>
          <p className="text-sm text-muted-foreground">Comments</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold">{tasksCreated}</p>
          <p className="text-sm text-muted-foreground">Tasks</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold">{tasksCompleted}</p>
          <p className="text-sm text-muted-foreground">Completed</p>
        </div>
      </div>
    </div>
  );
}
