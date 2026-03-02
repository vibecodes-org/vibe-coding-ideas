import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getIdeaTeam } from "@/lib/idea-team";
import { DiscussionThread } from "@/components/discussions/discussion-thread";
import type {
  IdeaDiscussionDetail,
  IdeaDiscussionReplyWithAuthor,
  User,
  BoardColumn,
} from "@/types";
import type { Metadata } from "next";

interface PageProps {
  params: Promise<{ id: string; discussionId: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id, discussionId } = await params;
  const supabase = await createClient();

  const { data: discussion } = await supabase
    .from("idea_discussions")
    .select("title")
    .eq("id", discussionId)
    .maybeSingle();

  return {
    title: discussion?.title ?? "Discussion",
  };
}

export default async function DiscussionDetailPage({ params }: PageProps) {
  const { id: ideaId, discussionId } = await params;
  const { user } = await requireAuth();

  const supabase = await createClient();

  // Fetch idea
  const { data: idea } = await supabase
    .from("ideas")
    .select("id, title, author_id, visibility")
    .eq("id", ideaId)
    .maybeSingle();

  if (!idea) notFound();

  // Check team membership
  const isAuthor = idea.author_id === user.id;
  const { data: collab } = await supabase
    .from("collaborators")
    .select("id")
    .eq("idea_id", ideaId)
    .eq("user_id", user.id)
    .maybeSingle();

  const isTeamMember = isAuthor || !!collab;

  // Fetch discussion with author
  const { data: discussion } = await supabase
    .from("idea_discussions")
    .select("*, author:users!idea_discussions_author_id_fkey(*)")
    .eq("id", discussionId)
    .eq("idea_id", ideaId)
    .maybeSingle();

  if (!discussion) notFound();

  // Fetch replies with authors
  const { data: replies } = await supabase
    .from("idea_discussion_replies")
    .select("*, author:users!idea_discussion_replies_author_id_fkey(*)")
    .eq("discussion_id", discussionId)
    .order("created_at", { ascending: true });

  const typedReplies = (replies ?? []) as IdeaDiscussionReplyWithAuthor[];

  const discussionDetail: IdeaDiscussionDetail = {
    ...discussion,
    author: discussion.author as User,
    replies: typedReplies,
  };

  // Check if user is the discussion author or idea owner
  const isAuthorOrOwner =
    user.id === discussion.author_id || user.id === idea.author_id;

  // Fetch columns, current user, vote status, converted task, and team info in parallel
  const [
    { data: columns },
    { data: currentUser },
    { data: vote },
    convertedTaskResult,
    ideaTeam,
  ] = await Promise.all([
    supabase
      .from("board_columns")
      .select("*")
      .eq("idea_id", ideaId)
      .order("position", { ascending: true }),
    supabase
      .from("users")
      .select("*")
      .eq("id", user.id)
      .single(),
    supabase
      .from("discussion_votes")
      .select("id")
      .eq("discussion_id", discussionId)
      .eq("user_id", user.id)
      .maybeSingle(),
    discussion.status === "converted"
      ? supabase
          .from("board_tasks")
          .select("id")
          .eq("discussion_id", discussionId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    getIdeaTeam(supabase, ideaId, idea.author_id, user.id),
  ]);

  const typedColumns = (columns ?? []) as BoardColumn[];
  const hasVotedOnDiscussion = !!vote;
  const convertedTaskId = convertedTaskResult.data?.id ?? null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link
        href={`/ideas/${ideaId}/discussions`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Discussions
      </Link>

      <DiscussionThread
        discussion={discussionDetail}
        ideaId={ideaId}
        currentUser={currentUser as User | null}
        isAuthorOrOwner={isAuthorOrOwner}
        isTeamMember={isTeamMember}
        columns={typedColumns}
        convertedTaskId={convertedTaskId}
        hasVoted={hasVotedOnDiscussion}
        teamMembers={ideaTeam.allMentionable}
        hasApiKey={!!(currentUser as User | null)?.encrypted_anthropic_key}
      />
    </div>
  );
}
