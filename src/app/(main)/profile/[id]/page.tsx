import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ProfileHeader } from "@/components/profile/profile-header";
import { ProfileTabs } from "@/components/profile/profile-tabs";
import { ProfileSettingsMenu } from "@/components/profile/profile-settings-menu";
import { DeleteUserButton } from "@/components/profile/delete-user-button";
import { EditProfileDialog } from "@/components/profile/edit-profile-dialog";
import { NotificationSettings } from "@/components/profile/notification-settings";
import { ApiKeySettings } from "@/components/profile/api-key-settings";
import { BoardColumnSettings } from "@/components/profile/board-column-settings";
import Link from "next/link";
import { Bot } from "lucide-react";
import { stripMarkdownForMeta } from "@/lib/utils";
import type { IdeaWithAuthor } from "@/types";
import type { Metadata } from "next";

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://vibecodes.co.uk";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("users")
    .select("full_name, bio")
    .eq("id", id)
    .maybeSingle();

  if (!profile) return { title: "User Not Found" };

  const displayName = profile.full_name ?? "User";
  const description = profile.bio
    ? stripMarkdownForMeta(profile.bio)
    : `${displayName} — Member of VibeCodes`;

  return {
    title: displayName,
    description,
    alternates: { canonical: `${appUrl}/profile/${id}` },
    openGraph: {
      title: displayName,
      description,
      type: "profile",
      url: `${appUrl}/profile/${id}`,
    },
    twitter: {
      card: "summary",
      title: displayName,
      description,
    },
  };
}

export default async function ProfilePage({ params }: PageProps) {
  const { id } = await params;
  const { user: currentUser, supabase } = await requireAuth();

  // Fetch profile user
  const { data: profileUser } = await supabase
    .from("users")
    .select("*")
    .eq("id", id)
    .single();

  if (!profileUser) notFound();

  // Fetch user's ideas
  const { data: ideas } = await supabase
    .from("ideas")
    .select("*, author:users!ideas_author_id_fkey(*)")
    .eq("author_id", id)
    .order("created_at", { ascending: false });

  // Fetch collaborations
  const { data: collaborations } = await supabase
    .from("collaborators")
    .select("idea_id")
    .eq("user_id", id);

  let collabIdeas: IdeaWithAuthor[] = [];
  if (collaborations && collaborations.length > 0) {
    const ideaIds = collaborations.map((c) => c.idea_id);
    const { data } = await supabase
      .from("ideas")
      .select("*, author:users!ideas_author_id_fkey(*)")
      .in("id", ideaIds)
      .order("created_at", { ascending: false });
    collabIdeas = (data as unknown as IdeaWithAuthor[]) ?? [];
  }

  // Fetch user's comments with idea titles
  const { data: rawComments } = await supabase
    .from("comments")
    .select("*, author:users!comments_author_id_fkey(*)")
    .eq("author_id", id)
    .order("created_at", { ascending: false })
    .limit(50);

  // Get idea titles for comments
  const commentIdeaIds = [...new Set(rawComments?.map((c) => c.idea_id) ?? [])];
  let ideaTitleMap: Record<string, string> = {};
  if (commentIdeaIds.length > 0) {
    const { data: ideaTitles } = await supabase
      .from("ideas")
      .select("id, title")
      .in("id", commentIdeaIds);
    ideaTitleMap = Object.fromEntries(
      (ideaTitles ?? []).map((i) => [i.id, i.title])
    );
  }

  const comments = (rawComments ?? []).map((c) => ({
    ...c,
    idea_title: ideaTitleMap[c.idea_id],
  }));

  // Fetch task statistics for profile user
  const [{ count: tasksCreatedCount }, { data: doneColumnIds }] =
    await Promise.all([
      supabase
        .from("board_tasks")
        .select("*", { count: "exact", head: true })
        .eq("assignee_id", id),
      supabase
        .from("board_columns")
        .select("id")
        .eq("is_done_column", true),
    ]);
  let tasksCompletedCount = 0;
  const doneIds = (doneColumnIds ?? []).map((c) => c.id);
  if (doneIds.length > 0) {
    const { count } = await supabase
      .from("board_tasks")
      .select("*", { count: "exact", head: true })
      .eq("assignee_id", id)
      .in("column_id", doneIds);
    tasksCompletedCount = count ?? 0;
  }

  // Get current user's votes and admin status
  let userVotes: string[] = [];
  let isCurrentUserAdmin = false;
  if (currentUser) {
    const { data: votes } = await supabase
      .from("votes")
      .select("idea_id")
      .eq("user_id", currentUser.id);
    userVotes = votes?.map((v) => v.idea_id) ?? [];

    const { data: adminCheck } = await supabase
      .from("users")
      .select("is_admin")
      .eq("id", currentUser.id)
      .single();
    isCurrentUserAdmin = adminCheck?.is_admin ?? false;
  }

  // Fetch task counts for displayed ideas
  const allProfileIdeaIds = [
    ...(ideas ?? []).map((i) => i.id),
    ...collabIdeas.map((i) => i.id),
  ];
  const taskCounts: Record<string, number> = {};
  if (allProfileIdeaIds.length > 0) {
    const { data: taskRows } = await supabase
      .from("board_tasks")
      .select("idea_id")
      .in("idea_id", allProfileIdeaIds);
    for (const row of taskRows ?? []) {
      taskCounts[row.idea_id] = (taskCounts[row.idea_id] ?? 0) + 1;
    }
  }

  const showDeleteButton =
    isCurrentUserAdmin &&
    currentUser?.id !== id &&
    !profileUser.is_admin;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <ProfileHeader
        user={profileUser}
        ideaCount={ideas?.length ?? 0}
        collaborationCount={collaborations?.length ?? 0}
        commentCount={rawComments?.length ?? 0}
        tasksCreated={tasksCreatedCount ?? 0}
        tasksCompleted={tasksCompletedCount}
      />
      {(currentUser?.id === id || showDeleteButton) && (
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {currentUser?.id === id && (
            <>
              {/* Desktop: all buttons visible */}
              <div className="hidden sm:contents">
                <EditProfileDialog user={profileUser} />
                <NotificationSettings preferences={profileUser.notification_preferences} />
                <BoardColumnSettings columns={profileUser.default_board_columns} />
                <ApiKeySettings hasKey={!!profileUser.encrypted_anthropic_key} />
              </div>
              {/* Mobile: Edit Profile visible + rest in dropdown */}
              <div className="contents sm:hidden">
                <EditProfileDialog user={profileUser} />
                <ProfileSettingsMenu
                  preferences={profileUser.notification_preferences}
                  columns={profileUser.default_board_columns}
                  hasApiKey={!!profileUser.encrypted_anthropic_key}
                />
              </div>
            </>
          )}
          {showDeleteButton && (
            <DeleteUserButton userId={id} userName={profileUser.full_name} redirectTo="/ideas" />
          )}
        </div>
      )}
      {currentUser?.id === id && (
        <div className="mt-4">
          <Link
            href="/agents"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <Bot className="h-4 w-4" />
            Manage agents
          </Link>
        </div>
      )}
      <ProfileTabs
        ideas={(ideas as unknown as IdeaWithAuthor[]) ?? []}
        collaborations={collabIdeas}
        comments={comments as any}
        userVotes={userVotes}
        taskCounts={taskCounts}
        isOwnProfile={currentUser?.id === id}
      />
    </div>
  );
}
