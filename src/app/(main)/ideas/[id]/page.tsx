import { notFound } from "next/navigation";
import Link from "next/link";
import { Pencil, LayoutDashboard, MessageSquare } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getIdeaTeam } from "@/lib/idea-team";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
import { InlineIdeaHeader } from "@/components/ideas/inline-idea-header";
import { InlineIdeaBody } from "@/components/ideas/inline-idea-body";
import { InlineIdeaTags } from "@/components/ideas/inline-idea-tags";
import { IdeaAttachmentsSection } from "@/components/ideas/idea-attachments-section";
import { IdeaAgentsSection } from "@/components/ideas/idea-agents-section";
import { formatRelativeTime, getInitials, stripMarkdownForMeta } from "@/lib/utils";
import { BotRolesProvider } from "@/components/bot-roles-context";
import { PendingRequests } from "@/components/ideas/pending-requests";
import type { CommentWithAuthor, CollaboratorWithUser, CollaborationRequestWithRequester, BotProfile } from "@/types";
import type { Metadata } from "next";

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://vibecodes.co.uk";

export const maxDuration = 120;

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data: idea } = await supabase
    .from("ideas")
    .select("title, description, visibility, created_at, updated_at, author_id, author:users!ideas_author_id_fkey(full_name)")
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
    alternates: { canonical: `${appUrl}/ideas/${id}` },
    openGraph: {
      title: idea.title,
      description,
      type: "article",
      url: `${appUrl}/ideas/${id}`,
      publishedTime: idea.created_at,
      modifiedTime: idea.updated_at ?? undefined,
      authors: [`${appUrl}/profile/${idea.author_id}`],
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
      .select("is_admin, encrypted_anthropic_key, ai_starter_credits")
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
  const userHasByokKey = !!profile?.encrypted_anthropic_key;
  const userStarterCredits = profile?.ai_starter_credits ?? 0;
  const userCanUseAi = userHasByokKey || userStarterCredits > 0;
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
  const authorInitials = getInitials(author.full_name);

  const collabList = (collaborators as unknown as CollaboratorWithUser[]) ?? [];

  const jsonLd = idea.visibility === "public" ? {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: idea.title,
    description: idea.description ? stripMarkdownForMeta(idea.description) : undefined,
    author: {
      "@type": "Person",
      name: (idea.author as unknown as { full_name: string | null })?.full_name ?? "VibeCodes User",
    },
    datePublished: idea.created_at,
    dateModified: idea.updated_at,
    publisher: {
      "@type": "Organization",
      name: "VibeCodes",
      url: appUrl,
    },
    mainEntityOfPage: `${appUrl}/ideas/${idea.id}`,
    interactionStatistic: {
      "@type": "InteractionCounter",
      interactionType: "https://schema.org/LikeAction",
      userInteractionCount: idea.upvotes,
    },
  } : null;

  return (
    <div className="mx-auto max-w-3xl px-4 pt-6 pb-4">
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
        />
      )}
      <IdeaDetailRealtime ideaId={idea.id} />

      {/* ══ Hero Card ══════════════════════════════════════ */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {/* Title row: Vote + Title + Actions */}
        <div className="flex items-start gap-3 p-4 pb-0 sm:p-5 sm:pb-0">
          <VoteButton
            ideaId={idea.id}
            upvotes={idea.upvotes}
            hasVoted={hasVoted}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <InlineIdeaHeader
                ideaId={idea.id}
                title={idea.title}
                visibility={idea.visibility}
                isAuthor={isAuthor}
              />
              {/* Actions: Enhance (prominent) + Edit/Delete (icon buttons) */}
              <div className="flex shrink-0 items-center gap-1.5">
                {isAuthor && (
                  <span className="hidden sm:inline-flex">
                    <EnhanceIdeaButton
                      ideaId={idea.id}
                      ideaTitle={idea.title}
                      currentDescription={idea.description}
                      bots={userBots}
                      disabled={!userCanUseAi}
                      hasByokKey={userHasByokKey}
                      starterCredits={userStarterCredits}
                    />
                  </span>
                )}
                {isAuthor && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Link href={`/ideas/${idea.id}/edit`} className="hidden sm:inline-flex">
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </Link>
                    </TooltipTrigger>
                    <TooltipContent>Edit</TooltipContent>
                  </Tooltip>
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
                    canUseAi={userCanUseAi}
                    hasByokKey={userHasByokKey}
                    starterCredits={userStarterCredits}
                    bots={userBots}
                  />
                )}
              </div>
            </div>

            {/* Meta row: Status + Visibility + Author + Time */}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {isAuthor ? (
                <StatusSelect ideaId={idea.id} currentStatus={idea.status} />
              ) : (
                <IdeaStatusBadge status={idea.status} />
              )}
              {user && !isAuthor && (
                <CollaboratorButton
                  ideaId={idea.id}
                  isCollaborator={isCollaborator}
                  isAuthor={isAuthor}
                  pendingRequestId={pendingRequestId}
                />
              )}
              <span className="text-muted-foreground/40">·</span>
              <Link
                href={`/profile/${idea.author_id}`}
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
              >
                <Avatar className="h-4 w-4">
                  <AvatarImage src={author.avatar_url ?? undefined} />
                  <AvatarFallback className="text-[8px]">
                    {authorInitials}
                  </AvatarFallback>
                </Avatar>
                {author.full_name ?? "Anonymous"}
              </Link>
              <span className="text-xs text-muted-foreground">
                {formatRelativeTime(idea.created_at)}
              </span>
            </div>
          </div>
        </div>

        {/* Metadata strip: Tags | Team | Agents */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-4 py-3 sm:px-5">
          {/* Tags */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/60">Tags</span>
            <InlineIdeaTags ideaId={idea.id} tags={idea.tags} isAuthor={isAuthor} />
          </div>

          {/* Team (avatar stack) */}
          {(collabList.length > 0 || isAuthor) && (
            <>
              <div className="hidden h-5 w-px bg-border sm:block" />
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/60">Team</span>
                <div className="flex items-center">
                  {/* Author avatar */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Link href={`/profile/${idea.author_id}`} className="-ml-0 first:ml-0">
                        <Avatar className="h-6 w-6 border-2 border-card">
                          <AvatarImage src={author.avatar_url ?? undefined} />
                          <AvatarFallback className="text-[9px]">{authorInitials}</AvatarFallback>
                        </Avatar>
                      </Link>
                    </TooltipTrigger>
                    <TooltipContent>{author.full_name ?? "Author"}</TooltipContent>
                  </Tooltip>
                  {/* Collaborator avatars */}
                  {collabList.map((c) => (
                    <Tooltip key={c.id}>
                      <TooltipTrigger asChild>
                        <Link href={`/profile/${c.user_id}`} className="-ml-1.5">
                          <Avatar className="h-6 w-6 border-2 border-card">
                            <AvatarImage src={c.user.avatar_url ?? undefined} />
                            <AvatarFallback className="text-[9px]">{getInitials(c.user.full_name)}</AvatarFallback>
                          </Avatar>
                        </Link>
                      </TooltipTrigger>
                      <TooltipContent>{c.user.full_name ?? "Collaborator"}</TooltipContent>
                    </Tooltip>
                  ))}
                </div>
                {(1 + collabList.length) > 1 && (
                  <span className="text-xs text-muted-foreground">{1 + collabList.length}</span>
                )}
                {isAuthor && (
                  <AddCollaboratorPopover
                    ideaId={idea.id}
                    authorId={idea.author_id}
                    existingCollaboratorIds={collabList.map((c) => c.user_id)}
                  />
                )}
              </div>
            </>
          )}

          {/* Agent Pool (avatar stack) */}
          {(ideaAgents.length > 0 || (isAuthor || isCollaborator)) && (
            <>
              <div className="hidden h-5 w-px bg-border sm:block" />
              <IdeaAgentsSection
                ideaId={idea.id}
                ideaAgents={ideaAgents}
                currentUserId={user.id}
                isAuthor={isAuthor}
                isTeamMember={isAuthor || isCollaborator}
                userBots={userBots}
              />
            </>
          )}
        </div>

        {/* Pending collaboration requests (author only) */}
        {isAuthor && pendingRequests.length > 0 && (
          <div className="border-t border-border px-4 py-3 sm:px-5">
            <PendingRequests ideaId={idea.id} requests={pendingRequests} />
          </div>
        )}
      </div>

      {/* ══ Navigation Buttons ═════════════════════════════ */}
      {(isAuthor || isCollaborator || idea.visibility === "public") && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
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
                <span className="rounded-full bg-violet-500/10 border border-violet-500/20 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-violet-400">
                  {idea.discussion_count}
                </span>
              )}
            </Button>
          </Link>
        </div>
      )}

      {/* ══ Description (promoted to top of content) ═══════ */}
      <div className="mt-6">
        <InlineIdeaBody
          ideaId={idea.id}
          description={idea.description}
          githubUrl={idea.github_url}
          isAuthor={isAuthor}
        />
      </div>

      {/* ══ Attachments ════════════════════════════════════ */}
      <Separator className="my-6" />
      <IdeaAttachmentsSection
        ideaId={idea.id}
        currentUserId={user?.id ?? ""}
        isAuthor={isAuthor}
        isTeamMember={isAuthor || isCollaborator}
      />

      {/* ══ Comments ═══════════════════════════════════════ */}
      <Separator className="my-6" />
      <BotRolesProvider botRoles={ideaTeam.botRoles}>
        <CommentThread
          comments={topLevelComments}
          ideaId={idea.id}
          ideaAuthorId={idea.author_id}
          currentUserId={user?.id}
          userBotIds={ideaTeam.currentUserBotIds}
          teamMembers={ideaTeam.allMentionable}
        />
      </BotRolesProvider>
    </div>
  );
}
