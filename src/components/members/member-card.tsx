import Link from "next/link";
import { Calendar } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { DeleteUserButton } from "@/components/profile/delete-user-button";
import { getInitials } from "@/lib/utils";
import type { MemberWithCounts } from "./member-directory";

interface MemberCardProps {
  member: MemberWithCounts;
  isAdmin: boolean;
  isCurrentUser: boolean;
}

export function MemberCard({ member, isAdmin, isCurrentUser }: MemberCardProps) {
  const initials = getInitials(member.full_name);

  const joinDate = new Date(member.created_at).toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric",
  });

  const canDelete = isAdmin && !isCurrentUser && !member.is_admin;

  return (
    <Link
      href={`/profile/${member.id}`}
      className="group block rounded-lg border border-border bg-card p-5 transition-colors hover:bg-accent/50"
    >
      <div className="flex flex-col items-center text-center">
        {/* Avatar */}
        <Avatar className="mb-3 h-16 w-16">
          <AvatarImage src={member.avatar_url ?? undefined} />
          <AvatarFallback className="text-xl">{initials}</AvatarFallback>
        </Avatar>

        {/* Name + admin badge */}
        <div className="mb-1 flex items-center gap-2">
          <h3 className="text-base font-semibold">
            {member.full_name ?? "Anonymous"}
          </h3>
          {member.is_admin && (
            <Badge variant="secondary" className="text-[10px]">
              Admin
            </Badge>
          )}
        </div>

        {/* Email — admin only */}
        {isAdmin && (
          <p className="mb-1 text-xs text-muted-foreground">{member.email}</p>
        )}

        {/* Bio */}
        {member.bio && (
          <p className="mb-2 line-clamp-2 text-sm text-muted-foreground">
            {member.bio}
          </p>
        )}

        {/* Stats */}
        <p className="mb-1 text-xs text-muted-foreground">
          {member.idea_count} {member.idea_count === 1 ? "idea" : "ideas"} &middot;{" "}
          {member.collab_count} {member.collab_count === 1 ? "collab" : "collabs"}
        </p>

        {/* Join date */}
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <Calendar className="h-3 w-3" />
          Joined {joinDate}
        </p>

        {/* Admin delete action */}
        {canDelete && (
          <div
            className="mt-3"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <DeleteUserButton userId={member.id} userName={member.full_name} />
          </div>
        )}
      </div>
    </Link>
  );
}
