import { requireAuth } from "@/lib/auth";
import { IdeaFeed } from "@/components/ideas/idea-feed";
import { CompleteProfileBanner } from "@/components/profile/complete-profile-banner";
import type { SortOption, IdeaStatus, IdeaWithAuthor } from "@/types";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Ideas",
  description: "Discover and vote on vibe coding project ideas on VibeCodes.",
  openGraph: {
    title: "Ideas",
    description: "Discover and vote on vibe coding project ideas on VibeCodes.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Ideas",
    description: "Discover and vote on vibe coding project ideas on VibeCodes.",
  },
};

const PAGE_SIZE = 10;

export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; q?: string; tag?: string; status?: string; page?: string; view?: string }>;
}) {
  const params = await searchParams;
  const sort = (params.sort as SortOption) || "newest";
  const search = params.q || "";
  const tag = params.tag || "";
  const status = (params.status as IdeaStatus) || "";
  const view = (params.view as "all" | "mine" | "collaborating") || "all";
  const page = Math.max(1, parseInt(params.page || "1", 10));
  const { user, supabase } = await requireAuth();

  // For "collaborating" view, fetch idea IDs where user is a collaborator
  let collaboratingIdeaIds: string[] = [];
  if (view === "collaborating" && user) {
    const { data: collabs } = await supabase
      .from("collaborators")
      .select("idea_id")
      .eq("user_id", user.id);
    collaboratingIdeaIds = collabs?.map((c) => c.idea_id) ?? [];
  }

  let query = supabase
    .from("ideas")
    .select("*, author:users!ideas_author_id_fkey(*)", { count: "exact" })
    .not("title", "like", "[E2E]%");

  // View filter
  if (view === "mine" && user) {
    query = query.eq("author_id", user.id);
  } else if (view === "collaborating" && user) {
    if (collaboratingIdeaIds.length === 0) {
      // No collaborations — short-circuit to empty result
      query = query.in("id", ["00000000-0000-0000-0000-000000000000"]);
    } else {
      query = query.in("id", collaboratingIdeaIds);
    }
  }

  // Search filter
  if (search) {
    query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
  }

  // Tag filter
  if (tag) {
    query = query.contains("tags", [tag]);
  }

  // Status filter
  if (status) {
    query = query.eq("status", status);
  }

  // Sorting
  switch (sort) {
    case "popular":
      query = query.order("upvotes", { ascending: false });
      break;
    case "discussed":
      query = query.order("comment_count", { ascending: false });
      break;
    case "newest":
    default:
      query = query.order("created_at", { ascending: false });
      break;
  }

  // Pagination
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  query = query.range(from, to);

  const { data: ideas, count } = await query;
  const totalPages = Math.ceil((count ?? 0) / PAGE_SIZE);

  // Get user votes and profile completeness
  let userVotes: string[] = [];
  let showProfileBanner = false;
  if (user) {
    const { data: votes } = await supabase
      .from("votes")
      .select("idea_id")
      .eq("user_id", user.id);
    userVotes = votes?.map((v) => v.idea_id) ?? [];

    const { data: profile } = await supabase
      .from("users")
      .select("full_name, bio, contact_info")
      .eq("id", user.id)
      .single();
    showProfileBanner = !profile?.full_name || !profile?.bio || !profile?.contact_info;
  }

  // Get all unique tags for the filter and task counts
  const ideaIds = (ideas ?? []).map((i) => i.id);
  const [allIdeasResult, taskCountsResult, latestDiscussionsResult] = await Promise.all([
    supabase.from("ideas").select("tags"),
    ideaIds.length > 0
      ? supabase
          .from("board_tasks")
          .select("idea_id")
          .in("idea_id", ideaIds)
      : Promise.resolve({ data: [] }),
    ideaIds.length > 0
      ? supabase
          .from("idea_discussions")
          .select("idea_id, id, title, last_activity_at")
          .in("idea_id", ideaIds)
          .order("last_activity_at", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);
  const allTags = [...new Set((allIdeasResult.data ?? []).flatMap((i) => i.tags))].sort();
  const taskCounts: Record<string, number> = {};
  for (const row of taskCountsResult.data ?? []) {
    taskCounts[row.idea_id] = (taskCounts[row.idea_id] ?? 0) + 1;
  }
  const latestDiscussions: Record<string, { id: string; title: string }> = {};
  for (const row of latestDiscussionsResult.data ?? []) {
    if (!latestDiscussions[row.idea_id]) {
      latestDiscussions[row.idea_id] = { id: row.id, title: row.title };
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      {showProfileBanner && user && (
        <CompleteProfileBanner userId={user.id} />
      )}
      <IdeaFeed
        ideas={(ideas as unknown as IdeaWithAuthor[]) ?? []}
        userVotes={userVotes}
        taskCounts={taskCounts}
        latestDiscussions={latestDiscussions}
        currentSort={sort}
        currentSearch={search}
        currentTag={tag}
        currentStatus={status}
        currentView={view}
        currentPage={page}
        totalPages={totalPages}
        allTags={allTags}
      />
    </div>
  );
}
