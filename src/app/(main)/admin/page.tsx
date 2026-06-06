import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { AdminTabs } from "@/components/admin/admin-tabs";
import { VIBECODES_USER_ID } from "@/lib/constants";
import { getRegisteredToolNames } from "../../../../mcp-server/src/register-tools";
import type { BotProfile, FeaturedTeamWithAgents, WorkflowLibraryTemplate } from "@/types";
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
    .select("is_admin, is_super_admin")
    .eq("id", user.id)
    .single();

  if (!currentUser?.is_admin) redirect("/dashboard");

  const isSuperAdmin = currentUser?.is_super_admin ?? false;

  // Build the two filtered query builders (not awaited yet).
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

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // All admin dashboard queries are independent of one another (only the
  // auth/admin check above is sequential), so run them in ONE parallel batch
  // instead of ~11 serial round-trips. This is the bulk of the page's load time,
  // and it's paid again on every sub-tab switch (which re-renders this page).
  const [
    { data: usageLogs },
    { data: feedback },
    { count: newFeedbackCount },
    { data: adminAgentsData },
    { data: teamsData },
    { data: communityData },
    { data: libraryTemplatesData },
    { data: allPlatformLogs },
    { data: userCreditsData },
    { data: mcpToolLogs },
    { data: mcpToolStats },
  ] = await Promise.all([
    usageQuery,
    feedbackQuery,
    // Count unreviewed feedback for badge
    supabase.from("feedback").select("id", { count: "exact", head: true }).eq("status", "new"),
    // VibeCodes admin agents (exclude the system user itself)
    supabase
      .from("bot_profiles")
      .select("*")
      .eq("owner_id", VIBECODES_USER_ID)
      .neq("id", VIBECODES_USER_ID)
      .order("created_at", { ascending: true }),
    // Featured teams with agents
    supabase
      .from("featured_teams")
      .select("*, agents:featured_team_agents(*, bot:bot_profiles(id, name, role, avatar_url, bio, is_published))")
      .order("display_order", { ascending: true }),
    // Published community agents for the team bundling picker
    supabase
      .from("bot_profiles")
      .select("*")
      .eq("is_published", true)
      .neq("owner_id", VIBECODES_USER_ID)
      .order("community_upvotes", { ascending: false })
      .limit(100),
    // Workflow library templates
    supabase.from("workflow_library_templates").select("*").order("display_order", { ascending: true }),
    // ALL platform usage logs (unfiltered) for the credits table
    supabase
      .from("ai_usage_log")
      .select("user_id, input_tokens, output_tokens, key_type")
      .eq("key_type", "platform")
      .order("created_at", { ascending: false })
      .limit(5000),
    // Non-bot users with credit + key info for the admin credits table
    supabase
      .from("users")
      .select("id, full_name, email, avatar_url, ai_starter_credits, encrypted_anthropic_key")
      .eq("is_bot", false)
      .order("full_name", { ascending: true }),
    // MCP tool logs (last 30 days)
    supabase
      .from("mcp_tool_log")
      .select("*, user:users!mcp_tool_log_user_id_fkey(full_name, avatar_url, is_bot)")
      .gte("created_at", thirtyDaysAgo)
      .order("created_at", { ascending: false })
      .limit(500),
    // MCP tool stats (all time, aggregated)
    supabase
      .from("mcp_tool_stats")
      .select("tool_name, user_id, call_count, error_count, avg_duration_ms, max_duration_ms, user:users!mcp_tool_stats_user_id_fkey(full_name, avatar_url, is_bot)")
      .order("call_count", { ascending: false })
      .limit(1000),
  ]);

  const adminAgents = (adminAgentsData ?? []) as BotProfile[];
  const featuredTeams = (teamsData ?? []) as unknown as FeaturedTeamWithAgents[];
  const communityAgents = (communityData ?? []) as BotProfile[];
  const libraryTemplates = (libraryTemplatesData ?? []) as WorkflowLibraryTemplate[];
  const userCredits = (userCreditsData ?? []) as UserCreditInfo[];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold">Admin</h1>
      <AdminTabs
        activeTab={tab ?? "ai-usage"}
        isSuperAdmin={isSuperAdmin}
        usageLogs={(usageLogs ?? []) as UsageLogWithUser[]}
        usageFilters={{ from: from ?? "", to: to ?? "", action: action ?? "all", source: source ?? "all" }}
        feedback={(feedback ?? []) as FeedbackWithUser[]}
        feedbackFilters={{ category: category ?? "all", status: status ?? "all" }}
        newFeedbackCount={newFeedbackCount ?? 0}
        adminAgents={adminAgents}
        featuredTeams={featuredTeams}
        communityAgents={communityAgents}
        libraryTemplates={libraryTemplates}
        userCredits={userCredits}
        allPlatformLogs={(allPlatformLogs ?? []) as PlatformLogEntry[]}
        mcpToolLogs={(mcpToolLogs ?? []) as import("@/components/admin/admin-mcp-tools-dashboard").McpToolLogWithUser[]}
        mcpToolStats={(mcpToolStats ?? []) as import("@/components/admin/admin-mcp-tools-dashboard").McpToolStatsRow[]}
        allMcpToolNames={getRegisteredToolNames()}
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

export type PlatformLogEntry = {
  user_id: string;
  input_tokens: number;
  output_tokens: number;
  key_type: string;
};

export type UserCreditInfo = {
  id: string;
  full_name: string | null;
  email: string;
  avatar_url: string | null;
  ai_starter_credits: number;
  encrypted_anthropic_key: string | null;
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
