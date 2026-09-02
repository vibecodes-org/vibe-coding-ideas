import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { DiscussionList } from "@/components/discussions/discussion-list";
import { DiscussionEmpty } from "@/components/discussions/discussion-empty";
import type { IdeaDiscussionWithAuthor } from "@/types";
import type { Metadata } from "next";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data: idea } = await supabase
    .from("ideas")
    .select("title")
    .eq("id", id)
    .maybeSingle();

  return {
    title: idea ? `Discussions — ${idea.title}` : "Discussions",
  };
}

export default async function DiscussionsPage({ params }: PageProps) {
  const { id: ideaId } = await params;
  const { user } = await requireAuth();

  const supabase = await createClient();

  // Fetch idea to verify access and get title
  const { data: idea } = await supabase
    .from("ideas")
    .select("id, title, author_id, visibility")
    .eq("id", ideaId)
    .maybeSingle();

  if (!idea) notFound();

  // Check if user is a team member
  const isAuthor = idea.author_id === user.id;
  const { data: collab } = await supabase
    .from("collaborators")
    .select("id")
    .eq("idea_id", ideaId)
    .eq("user_id", user.id)
    .maybeSingle();

  const isTeamMember = isAuthor || !!collab;

  // Fetch discussions with author info — column-scoped to what
  // discussion-list.tsx renders (avatar, displayName()/full_name, bot badge).
  const { data: discussions } = await supabase
    .from("idea_discussions")
    .select("*, author:users!idea_discussions_author_id_fkey(id, full_name, email, avatar_url, is_bot)")
    .eq("idea_id", ideaId)
    .order("last_activity_at", { ascending: false });

  const typedDiscussions = (discussions ?? []) as IdeaDiscussionWithAuthor[];

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      {/* Back link */}
      <Link
        href={`/ideas/${ideaId}`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to {idea.title}
      </Link>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold sm:text-2xl">Discussions</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Plan, debate, and refine before creating board tasks
          </p>
        </div>
        {isTeamMember && (
          <Link href={`/ideas/${ideaId}/discussions/new`}>
            <Button size="sm" className="gap-2">
              <Plus className="h-4 w-4" />
              New Discussion
            </Button>
          </Link>
        )}
      </div>

      {/* Content */}
      {typedDiscussions.length === 0 ? (
        <DiscussionEmpty ideaId={ideaId} canCreate={isTeamMember} />
      ) : (
        <DiscussionList
          discussions={typedDiscussions}
          ideaId={ideaId}
        />
      )}
    </div>
  );
}
