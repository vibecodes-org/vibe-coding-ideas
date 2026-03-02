import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getIdeaTeam } from "@/lib/idea-team";
import { NewDiscussionForm } from "@/components/discussions/new-discussion-form";
import type { Metadata } from "next";

interface PageProps {
  params: Promise<{ id: string }>;
}

export const metadata: Metadata = {
  title: "New Discussion",
};

export default async function NewDiscussionPage({ params }: PageProps) {
  const { id: ideaId } = await params;
  const { user } = await requireAuth();

  const supabase = await createClient();

  // Verify idea exists and user is a team member
  const { data: idea } = await supabase
    .from("ideas")
    .select("id, title, author_id")
    .eq("id", ideaId)
    .maybeSingle();

  if (!idea) notFound();

  const isAuthor = idea.author_id === user.id;
  const { data: collab } = await supabase
    .from("collaborators")
    .select("id")
    .eq("idea_id", ideaId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!isAuthor && !collab) {
    notFound();
  }

  // Fetch current user profile + team info in parallel
  const [{ data: currentUserProfile }, ideaTeam] = await Promise.all([
    supabase.from("users").select("*").eq("id", user.id).single(),
    getIdeaTeam(supabase, ideaId, idea.author_id, user.id),
  ]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link
        href={`/ideas/${ideaId}/discussions`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Discussions
      </Link>

      <h1 className="mb-6 text-xl font-bold sm:text-2xl">New Discussion</h1>

      <NewDiscussionForm
        ideaId={ideaId}
        teamMembers={ideaTeam.allMentionable}
        currentUserId={user.id}
        hasApiKey={!!currentUserProfile?.encrypted_anthropic_key}
      />
    </div>
  );
}
