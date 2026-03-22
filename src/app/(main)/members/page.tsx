import { requireAuth } from "@/lib/auth";
import { MemberDirectory } from "@/components/members/member-directory";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Members",
  description: "Browse and search VibeCodes community members.",
  openGraph: {
    title: "Members",
    description: "Browse and search VibeCodes community members.",
  },
};

const PAGE_SIZE = 12;

type MemberSort = "newest" | "most_ideas" | "most_collabs";

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; sort?: string; page?: string }>;
}) {
  const params = await searchParams;
  const search = params.q || "";
  const sort = (params.sort as MemberSort) || "newest";
  const page = Math.max(1, parseInt(params.page || "1", 10));
  const { user, supabase } = await requireAuth();

  // Check if current user is admin / super admin
  const { data: profile } = await supabase
    .from("users")
    .select("is_admin, is_super_admin")
    .eq("id", user.id)
    .single();
  const isAdmin = profile?.is_admin ?? false;
  const isSuperAdmin = profile?.is_super_admin ?? false;

  // Build query — exclude bots
  let query = supabase
    .from("users")
    .select("id, full_name, email, avatar_url, bio, github_username, is_admin, created_at", {
      count: "exact",
    })
    .eq("is_bot", false);

  // Search filter
  if (search) {
    query = query.or(`full_name.ilike.%${search}%,email.ilike.%${search}%`);
  }

  // Sort — "newest" is always the DB sort; count-based sorts happen client-side
  query = query.order("created_at", { ascending: false });

  const { data: members, count } = await query;

  // Fetch idea and collaboration counts for all members
  const memberIds = (members ?? []).map((m) => m.id);
  const ideaCounts: Record<string, number> = {};
  const collabCounts: Record<string, number> = {};

  if (memberIds.length > 0) {
    const [ideasResult, collabsResult] = await Promise.all([
      supabase
        .from("ideas")
        .select("author_id")
        .in("author_id", memberIds),
      supabase
        .from("collaborators")
        .select("user_id")
        .in("user_id", memberIds),
    ]);

    for (const row of ideasResult.data ?? []) {
      ideaCounts[row.author_id] = (ideaCounts[row.author_id] ?? 0) + 1;
    }
    for (const row of collabsResult.data ?? []) {
      collabCounts[row.user_id] = (collabCounts[row.user_id] ?? 0) + 1;
    }
  }

  // Attach counts and apply client-side sort for count-based sorts
  const membersWithCounts = (members ?? []).map((m) => ({
    ...m,
    idea_count: ideaCounts[m.id] ?? 0,
    collab_count: collabCounts[m.id] ?? 0,
  }));

  if (sort === "most_ideas") {
    membersWithCounts.sort((a, b) => b.idea_count - a.idea_count);
  } else if (sort === "most_collabs") {
    membersWithCounts.sort((a, b) => b.collab_count - a.collab_count);
  }

  // Paginate after sort
  const totalCount = count ?? membersWithCounts.length;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const from = (page - 1) * PAGE_SIZE;
  const paginatedMembers = membersWithCounts.slice(from, from + PAGE_SIZE);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <MemberDirectory
        members={paginatedMembers}
        currentSearch={search}
        currentSort={sort}
        currentPage={page}
        totalPages={totalPages}
        isAdmin={isAdmin}
        isSuperAdmin={isSuperAdmin}
        currentUserId={user?.id}
      />
    </div>
  );
}
