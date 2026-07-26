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
import { ModelTierSettings } from "@/components/profile/model-tier-settings";
import { BoardColumnSettings } from "@/components/profile/board-column-settings";
import { McpApiKeys } from "@/components/profile/mcp-api-keys";
import { GithubConnection } from "@/components/profile/github-connection";
import Link from "next/link";
import { Bot } from "lucide-react";
import { stripMarkdownForMeta } from "@/lib/utils";
import type { Comment, IdeaWithAuthor, User } from "@/types";
import type { Metadata } from "next";

/** The settings-only columns: never fetched unless the viewer IS the profile
 *  owner (see the `isOwnProfile` query below) — narrowing the `select()`
 *  column list alone still put these in the RSC payload for every viewer, so
 *  the query itself has to be conditional, not just its shape.
 *
 *  `has_anthropic_key` (generated column, migration 00152) stands in for
 *  `encrypted_anthropic_key` — `authenticated` no longer has SELECT on the
 *  ciphertext column at all, even for a user's own row, and this page only
 *  ever renders the BYOK/Platform truthiness (see `ApiKeySettings` /
 *  `ProfileSettingsMenu` below). */
type OwnProfileSettings = Pick<
  User,
  "notification_preferences" | "default_board_columns" | "has_anthropic_key" | "model_tier_map"
>;

/** IdeaCard's entire use of `idea.author` (see src/components/ideas/idea-card.tsx) —
 *  avatar, display name, admin badge. A wildcard embedded-resource select on the
 *  author here would hand every field of the author's row (including
 *  encrypted_anthropic_key) to any logged-in viewer of this page. */
const IDEA_AUTHOR_SELECT = "author:users!ideas_author_id_fkey(id, full_name, avatar_url, is_admin)";

/** What ProfileTabs actually renders for a comment — no author, see below. */
type ProfileComment = Comment & { idea_title?: string };

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
  const isOwnProfile = currentUser?.id === id;

  // Fetch profile user. Scoped to exactly the public columns ProfileHeader/
  // EditProfileDialog render — `select("*")` on an arbitrary route-param id
  // used to hand every logged-in viewer another user's encrypted API key
  // ciphertext, admin flags, and credit balance via the RSC payload.
  const { data: profileUser } = await supabase
    .from("users")
    .select("id, full_name, avatar_url, bio, github_username, contact_info, created_at, is_admin")
    .eq("id", id)
    .single();

  if (!profileUser) notFound();

  // Settings-only columns (notification_preferences, default_board_columns,
  // encrypted_anthropic_key, model_tier_map): fetched ONLY when the viewer is
  // the profile owner. A narrower `select()` column list isn't enough on its
  // own — an unconditional fetch still lands these in the RSC payload for
  // anyone viewing anyone's profile, since the settings buttons below are
  // only gated on *rendering*, not on whether the data was ever requested.
  let ownSettings: OwnProfileSettings | null = null;
  if (isOwnProfile) {
    const { data } = await supabase
      .from("users")
      .select("notification_preferences, default_board_columns, has_anthropic_key, model_tier_map")
      .eq("id", id)
      .single();
    ownSettings = data;
  }

  // Fetch user's ideas. The author is by definition someone else's row (or,
  // on this page, possibly the profile owner's) — scoped to exactly what
  // IdeaCard renders for an author (avatar, name, admin badge), not select("*").
  const { data: ideas } = await supabase
    .from("ideas")
    .select(`*, ${IDEA_AUTHOR_SELECT}`)
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
      .select(`*, ${IDEA_AUTHOR_SELECT}`)
      .in("id", ideaIds)
      .order("created_at", { ascending: false });
    collabIdeas = (data as unknown as IdeaWithAuthor[]) ?? [];
  }

  // Fetch user's comments with idea titles. No author join — ProfileTabs
  // never renders comment.author (every comment here is already known to be
  // the profile owner's, via `.eq("author_id", id)`), so it was dead weight
  // pulling a full stranger's-eye-view user row for nothing.
  const { data: rawComments } = await supabase
    .from("comments")
    .select("*")
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
  let isCurrentUserSuperAdmin = false;
  if (currentUser) {
    const { data: votes } = await supabase
      .from("votes")
      .select("idea_id")
      .eq("user_id", currentUser.id);
    userVotes = votes?.map((v) => v.idea_id) ?? [];

    const { data: adminCheck } = await supabase
      .from("users")
      .select("is_admin, is_super_admin")
      .eq("id", currentUser.id)
      .single();
    isCurrentUserAdmin = adminCheck?.is_admin ?? false;
    isCurrentUserSuperAdmin = adminCheck?.is_super_admin ?? false;
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
    isCurrentUserSuperAdmin &&
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
      {(isOwnProfile || showDeleteButton) && (
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {isOwnProfile && (
            <>
              {/* Desktop: all buttons visible */}
              <div className="hidden sm:contents">
                <EditProfileDialog user={profileUser} />
                {ownSettings && (
                  <>
                    <NotificationSettings preferences={ownSettings.notification_preferences} />
                    <BoardColumnSettings columns={ownSettings.default_board_columns} />
                    <ApiKeySettings hasKey={!!ownSettings.has_anthropic_key} />
                    <ModelTierSettings map={ownSettings.model_tier_map} />
                  </>
                )}
                <McpApiKeys />
                <GithubConnection />
              </div>
              {/* Mobile: Edit Profile visible + rest in dropdown */}
              <div className="contents sm:hidden">
                <EditProfileDialog user={profileUser} />
                {ownSettings && (
                  <ProfileSettingsMenu
                    preferences={ownSettings.notification_preferences}
                    columns={ownSettings.default_board_columns}
                    hasApiKey={!!ownSettings.has_anthropic_key}
                    modelTierMap={ownSettings.model_tier_map}
                  />
                )}
              </div>
            </>
          )}
          {showDeleteButton && (
            <DeleteUserButton userId={id} userName={profileUser.full_name} redirectTo="/ideas" />
          )}
        </div>
      )}
      {isOwnProfile && (
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
        comments={comments as unknown as ProfileComment[]}
        userVotes={userVotes}
        taskCounts={taskCounts}
        isOwnProfile={isOwnProfile}
      />
    </div>
  );
}
