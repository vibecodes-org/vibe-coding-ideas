import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { AdminTabs } from "@/components/admin/admin-tabs";
import { VIBECODES_USER_ID } from "@/lib/constants";
import type { BotProfile, FeaturedTeamWithAgents } from "@/types";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

interface PageProps {
  searchParams: Promise<{
    tab?: string;
    from?: string;
    to?: string;
    action?: string;
    source?: string;
    category?: string;
    status?: string;
  }>;
}

export default async function AdminPage({ searchParams }: PageProps) {
  const { tab, from, to, action, source, category, status } = await searchParams;
  const { user, supabase } = await requireAuth();

  // Check admin
  const { data: currentUser } = await supabase
    .from("users")
    .select("is_admin")
    .eq("id", user.id)
    .single();

  if (!currentUser?.is_admin) redirect("/dashboard");

  // Fetch usage logs with filters
  let usageQuery = supabase
    .from("ai_usage_log")
    .select("*, user:users!ai_usage_log_user_id_fkey(id, full_name, email, avatar_url)")
    .order("created_at", { ascending: false })
    .limit(1000);

  if (from) usageQuery = usageQuery.gte("created_at", `${from}T00:00:00Z`);
  if (to) usageQuery = usageQuery.lte("created_at", `${to}T23:59:59Z`);
  if (action && action !== "all") {
    usageQuery = usageQuery.eq(
      "action_type",
      action as "enhance_description" | "generate_questions" | "enhance_with_context" | "generate_board_tasks" | "enhance_task_description"
    );
  }
  if (source && source !== "all") {
    usageQuery = usageQuery.eq("key_type", source as "platform" | "byok");
  }

  const { data: usageLogs } = await usageQuery;

  // Fetch feedback with filters
  let feedbackQuery = supabase
    .from("feedback")
    .select("*, user:users!feedback_user_id_fkey(id, full_name, email, avatar_url)")
    .order("created_at", { ascending: false })
    .limit(500);

  if (category && category !== "all") {
    feedbackQuery = feedbackQuery.eq("category", category as "bug" | "suggestion" | "question" | "other");
  }
  if (status && status !== "all") {
    feedbackQuery = feedbackQuery.eq("status", status as "new" | "reviewed" | "archived");
  }

  const { data: feedback } = await feedbackQuery;

  // Count unreviewed feedback for badge
  const { count: newFeedbackCount } = await supabase
    .from("feedback")
    .select("id", { count: "exact", head: true })
    .eq("status", "new");

  // Fetch VibeCodes admin agents (exclude the system user itself)
  const { data: adminAgentsData } = await supabase
    .from("bot_profiles")
    .select("*")
    .eq("owner_id", VIBECODES_USER_ID)
    .neq("id", VIBECODES_USER_ID)
    .order("created_at", { ascending: true });

  const adminAgents = (adminAgentsData ?? []) as BotProfile[];

  // Fetch featured teams with agents
  const { data: teamsData } = await supabase
    .from("featured_teams")
    .select("*, agents:featured_team_agents(*, bot:bot_profiles(id, name, role, avatar_url, bio, is_published))")
    .order("display_order", { ascending: true });

  const featuredTeams = (teamsData ?? []) as unknown as FeaturedTeamWithAgents[];

  // Fetch published community agents for team bundling picker
  const { data: communityData } = await supabase
    .from("bot_profiles")
    .select("*")
    .eq("is_published", true)
    .neq("owner_id", VIBECODES_USER_ID)
    .order("community_upvotes", { ascending: false })
    .limit(100);

  const communityAgents = (communityData ?? []) as BotProfile[];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold">Admin</h1>
      <AdminTabs
        activeTab={tab ?? "ai-usage"}
        usageLogs={(usageLogs ?? []) as UsageLogWithUser[]}
        usageFilters={{ from: from ?? "", to: to ?? "", action: action ?? "all", source: source ?? "all" }}
        feedback={(feedback ?? []) as FeedbackWithUser[]}
        feedbackFilters={{ category: category ?? "all", status: status ?? "all" }}
        newFeedbackCount={newFeedbackCount ?? 0}
        adminAgents={adminAgents}
        featuredTeams={featuredTeams}
        communityAgents={communityAgents}
      />
    </div>
  );
}

// Types for the serialized data passed to the client components
export type UsageLogWithUser = {
  id: string;
  user_id: string;
  action_type: string;
  input_tokens: number;
  output_tokens: number;
  model: string;
  key_type: string;
  idea_id: string | null;
  created_at: string;
  user: {
    id: string;
    full_name: string | null;
    email: string;
    avatar_url: string | null;
  };
};

export type FeedbackWithUser = {
  id: string;
  user_id: string;
  category: "bug" | "suggestion" | "question" | "other";
  content: string;
  page_url: string | null;
  status: "new" | "reviewed" | "archived";
  created_at: string;
  user: {
    id: string;
    full_name: string | null;
    email: string;
    avatar_url: string | null;
  };
};
