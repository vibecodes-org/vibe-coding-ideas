import { notFound } from "next/navigation";
import Link from "next/link";
import { Users, Pencil, LayoutDashboard, MessageSquare, Trash2, Sparkles } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getIdeaTeam } from "@/lib/idea-team";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { IdeaStatusBadge } from "@/components/ideas/idea-status-badge";
import { VoteButton } from "@/components/ideas/vote-button";
import { CollaboratorButton } from "@/components/ideas/collaborator-button";
import { StatusSelect } from "@/components/ideas/status-select";
import { CommentThread } from "@/components/comments/comment-thread";
import { IdeaDetailRealtime } from "@/components/ideas/idea-detail-realtime";
import { DeleteIdeaButton } from "@/components/ideas/delete-idea-button";
import { EnhanceIdeaButton } from "@/components/ideas/enhance-idea-button";
import { IdeaActionsMenu } from "@/components/ideas/idea-actions-menu";
import { AddCollaboratorPopover } from "@/components/ideas/add-collaborator-popover";
import { RemoveCollaboratorButton } from "@/components/ideas/remove-collaborator-button";
import { InlineIdeaHeader } from "@/components/ideas/inline-idea-header";
import { InlineIdeaBody } from "@/components/ideas/inline-idea-body";
import { InlineIdeaTags } from "@/components/ideas/inline-idea-tags";
import { IdeaAttachmentsSection } from "@/components/ideas/idea-attachments-section";
import { IdeaAgentsSection } from "@/components/ideas/idea-agents-section";
import { formatRelativeTime, stripMarkdownForMeta } from "@/lib/utils";
import { PendingRequests } from "@/components/ideas/pending-requests";
import type { CommentWithAuthor, CollaboratorWithUser, CollaborationRequestWithRequester, BotProfile } from "@/types";
import type { Metadata } from "next";

export const maxDuration = 120;

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data: idea } = await supabase
    .from("ideas")
    .select("title, description, visibility")
    .eq("id", id)
    .single();

  if (!idea) return { title: "Idea Not Found" };

  if (idea.visibility === "private") {
    return {
      title: "Private Idea",
      description: "Sign in to VibeCodes to view this idea.",
      openGraph: {
        title: "Private Idea on VibeCodes",
        description: "Sign in to VibeCodes to view this idea.",
      },
    };
  }

  const description = idea.description
    ? stripMarkdownForMeta(idea.description)
    : "An idea on VibeCodes";

  return {
    title: idea.title,
    description,
    openGraph: {
      title: idea.title,
      description,
      type: "article",
    },
    twitter: {
      card: "summary_large_image",
      title: idea.title,
      description,
    },
  };
}

export default async function IdeaDetailPage({ params }: PageProps) {
  const { id } = await params;
  const { user, supabase } = await requireAuth();

  // Fetch idea with author
  const { data: idea } = await supabase
    .from("ideas")
    .select("*, author:users!ideas_author_id_fkey(*)")
    .eq("id", id)
    .single();

  if (!idea) notFound();

  // Phase 2: Run all independent queries in parallel
  const [
    { data: rawComments },
    { data: collaborators },
    { data: vote },
    { data: collab },
    { data: profile },
    { data: bots },
    ideaTeam,
  ] = await Promise.all([
    supabase
      .from("comments")
      .select("*, author:users!comments_author_id_fkey(*)")
      .eq("idea_id", id)
      .order("created_at", { ascending: true }),
    supabase
      .from("collaborators")
      .select("*, user:users!collaborators_user_id_fkey(*)")
      .eq("idea_id", id),
    supabase
      .from("votes")
      .select("id")
      .eq("idea_id", id)
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("collaborators")
      .select("id")
      .eq("idea_id", id)
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("users")
      .select("is_admin, encrypted_anthropic_key")
      .eq("id", user.id)
      .single(),
    supabase
      .from("bot_profiles")
      .select("*")
      .eq("owner_id", user.id)
      .eq("is_active", true)
      .order("created_at", { ascending: true }),
    getIdeaTeam(supabase, id, idea.author_id, user.id),
  ]);

  const hasVoted = !!vote;
  const isCollaborator = !!collab;
  const isAdmin = profile?.is_admin ?? false;
  const userHasApiKey = !!profile?.encrypted_anthropic_key;
  const userBots = (bots ?? []) as BotProfile[];
  const ideaAgents = ideaTeam.ideaAgentDetails;

  // Build threaded comments
  const commentMap = new Map<string, CommentWithAuthor>();
  const topLevelComments: CommentWithAuthor[] = [];

  (rawComments ?? []).forEach((c) => {
    const comment = { ...c, replies: [] } as unknown as CommentWithAuthor;
    commentMap.set(comment.id, comment);
  });

  commentMap.forEach((comment) => {
    if (comment.parent_comment_id) {
      const parent = commentMap.get(comment.parent_comment_id);
      if (parent) {
        parent.replies = parent.replies ?? [];
        parent.replies.push(comment);
      } else {
        topLevelComments.push(comment);
      }
    } else {
      topLevelComments.push(comment);
    }
  });

  // Phase 3: Conditional queries that depend on Phase 2 results
  const [pendingRequestId, pendingRequests] = await Promise.all([
    (!isCollaborator && user.id !== idea.author_id)
      ? supabase
          .from("collaboration_requests")
          .select("id")
          .eq("idea_id", id)
          .eq("requester_id", user.id)
          .eq("status", "pending")
          .maybeSingle()
          .then(({ data }) => data?.id ?? null)
      : Promise.resolve(null),
    (user.id === idea.author_id)
      ? supabase
          .from("collaboration_requests")
          .select("*, requester:users!collaboration_requests_requester_id_fkey(*)")
          .eq("idea_id", id)
          .eq("status", "pending")
          .order("created_at", { ascending: true })
          .then(({ data }) => (data ?? []) as unknown as CollaborationRequestWithRequester[])
      : Promise.resolve([] as CollaborationRequestWithRequester[]),
  ]);

  const isAuthor = user?.id === idea.author_id;
  const canDelete = isAuthor || isAdmin;

  const author = idea.author as unknown as { full_name: string | null; avatar_url: string | null; id: string };
  const authorInitials =
    author.full_name
      ?.split(" ")
      .map((n: string) => n[0])
      .join("")
      .toUpperCase() ?? "?";

  return (
    <div className="mx-auto max-w-3xl px-4 pt-10 pb-4">
      <IdeaDetailRealtime ideaId={idea.id} />
      {/* Header */}
      <div className="flex items-start gap-4">
        <VoteButton
          ideaId={idea.id}
          upvotes={idea.upvotes}
          hasVoted={hasVoted}
        />
        <div className="flex-1">
          <InlineIdeaHeader
            ideaId={idea.id}
            title={idea.title}
            visibility={idea.visibility}
            isAuthor={isAuthor}
          />
          <div className="mt-3 flex items-center gap-3">
            <Link
              href={`/profile/${idea.author_id}`}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <Avatar className="h-5 w-5">
                <AvatarImage src={author.avatar_url ?? undefined} />
                <AvatarFallback className="text-[10px]">
                  {authorInitials}
                </AvatarFallback>
              </Avatar>
              {author.full_name ?? "Anonymous"}
            </Link>
            <span className="text-sm text-muted-foreground">
              {formatRelativeTime(idea.created_at)}
            </span>
          </div>
        </div>
      </div>

      {/* Status and Actions */}
      <div className="mt-8 flex flex-wrap items-center gap-3">
        {isAuthor ? (
          <StatusSelect ideaId={idea.id} currentStatus={idea.status} />
        ) : (
          <IdeaStatusBadge status={idea.status} />
        )}
        {user && (
          <CollaboratorButton
            ideaId={idea.id}
            isCollaborator={isCollaborator}
            isAuthor={isAuthor}
            pendingRequestId={pendingRequestId}
          />
        )}
        {(isAuthor || isCollaborator || idea.visibility === "public") && (
          <>
            <Link href={`/ideas/${idea.id}/board`}>
              <Button variant="outline" size="sm" className="gap-2">
                <LayoutDashboard className="h-4 w-4" />
                Board
              </Button>
            </Link>
            <Link href={`/ideas/${idea.id}/discussions`}>
              <Button variant="outline" size="sm" className="gap-2">
                <MessageSquare className="h-4 w-4" />
                Discussions
                {idea.discussion_count > 0 && (
                  <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] leading-none">
                    {idea.discussion_count}
                  </span>
                )}
              </Button>
            </Link>
          </>
        )}
        {/* Desktop: show Edit, Enhance, Delete inline */}
        {isAuthor && (
          <Link href={`/ideas/${idea.id}/edit`} className="hidden sm:inline-flex">
            <Button variant="outline" size="sm" className="gap-2">
              <Pencil className="h-4 w-4" />
              Edit
            </Button>
          </Link>
        )}
        {isAuthor && (
          <span className="hidden sm:inline-flex">
            <EnhanceIdeaButton
              ideaId={idea.id}
              ideaTitle={idea.title}
              currentDescription={idea.description}
              bots={userBots}
              disabled={!userHasApiKey}
            />
          </span>
        )}
        {canDelete && (
          <span className="hidden sm:inline-flex">
            <DeleteIdeaButton ideaId={idea.id} />
          </span>
        )}
        {/* Mobile: "More" dropdown for Edit, Enhance, Delete */}
        {(isAuthor || canDelete) && (
          <IdeaActionsMenu
            ideaId={idea.id}
            ideaTitle={idea.title}
            currentDescription={idea.description}
            isAuthor={isAuthor}
            canDelete={canDelete}
            hasApiKey={userHasApiKey}
            bots={userBots}
          />
        )}
      </div>

      {/* Tags */}
      <InlineIdeaTags ideaId={idea.id} tags={idea.tags} isAuthor={isAuthor} />

      {/* Collaborators */}
      {(isAuthor || (collaborators as unknown as CollaboratorWithUser[])?.length > 0) && (
        <div className="mt-6">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Users className="h-4 w-4" />
            Collaborators ({(collaborators as unknown as CollaboratorWithUser[])?.length ?? 0})
            {isAuthor && (
              <AddCollaboratorPopover
                ideaId={idea.id}
                authorId={idea.author_id}
                existingCollaboratorIds={(collaborators as unknown as CollaboratorWithUser[])?.map((c) => c.user_id) ?? []}
              />
            )}
          </h3>
          <div className="flex flex-wrap gap-2">
            {(collaborators as unknown as CollaboratorWithUser[])?.map((collab) => {
              const collabInitials =
                collab.user.full_name
                  ?.split(" ")
                  .map((n) => n[0])
                  .join("")
                  .toUpperCase() ?? "?";
              return (
                <div
                  key={collab.id}
                  className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-sm transition-colors hover:border-primary"
                >
                  <Link
                    href={`/profile/${collab.user_id}`}
                    className="flex items-center gap-1.5"
                  >
                    <Avatar className="h-5 w-5">
                      <AvatarImage src={collab.user.avatar_url ?? undefined} />
                      <AvatarFallback className="text-[10px]">
                        {collabInitials}
                      </AvatarFallback>
                    </Avatar>
                    {collab.user.full_name ?? "Anonymous"}
                  </Link>
                  {isAuthor && (
                    <RemoveCollaboratorButton
                      ideaId={idea.id}
                      userId={collab.user_id}
                      userName={collab.user.full_name ?? undefined}
                    />
                  )}
                </div>
              );
            })}
          </div>
          {isAuthor && <PendingRequests ideaId={idea.id} requests={pendingRequests} />}
        </div>
      )}

      {/* Agent Pool */}
      <IdeaAgentsSection
        ideaId={idea.id}
        ideaAgents={ideaAgents}
        currentUserId={user.id}
        isAuthor={isAuthor}
        isTeamMember={isAuthor || isCollaborator}
        userBots={userBots}
      />

      {/* Description + GitHub URL */}
      <Separator className="mt-8 mb-6" />
      <InlineIdeaBody
        ideaId={idea.id}
        description={idea.description}
        githubUrl={idea.github_url}
        isAuthor={isAuthor}
      />

      {/* Attachments — team members always see it; others see it if attachments exist (component handles this) */}
      <Separator className="my-6" />
      <IdeaAttachmentsSection
        ideaId={idea.id}
        currentUserId={user?.id ?? ""}
        isAuthor={isAuthor}
        isTeamMember={isAuthor || isCollaborator}
      />

      {/* Comments */}
      <Separator className="my-6" />
      <CommentThread
        comments={topLevelComments}
        ideaId={idea.id}
        ideaAuthorId={idea.author_id}
        currentUserId={user?.id}
        userBotIds={ideaTeam.currentUserBotIds}
        teamMembers={ideaTeam.allMentionable}
      />
    </div>
  );
}
