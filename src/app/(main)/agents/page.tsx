import { Info } from "lucide-react";
import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { AgentsHub } from "@/components/agents/agents-hub";
import type { BotProfile, BotProfileWithOwner, FeaturedTeamWithAgents } from "@/types";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Agents Hub",
  robots: { index: false, follow: false },
};

export default async function AgentsPage() {
  const { user, supabase } = await requireAuth();

  // Fetch user's bots
  const { data: bots } = await supabase
    .from("bot_profiles")
    .select("*")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: true });

  const myBots = (bots ?? []) as BotProfile[];

  // Fetch bot stats: task count, idea count, and assigned count per bot
  const botIds = myBots.map((b) => b.id);
  const botStats: Record<string, { taskCount: number; ideaCount: number; assignedCount: number }> = {};

  if (botIds.length > 0) {
    // All tasks per bot (for "tasks done" count)
    const { data: taskData } = await supabase
      .from("board_tasks")
      .select("assignee_id, board_columns!inner(is_done_column)")
      .in("assignee_id", botIds)
      .eq("archived", false);

    // Idea agent pool count per bot
    const { data: ideaAgentData } = await supabase
      .from("idea_agents")
      .select("bot_id")
      .in("bot_id", botIds);

    for (const id of botIds) {
      const botTasks = (taskData ?? []).filter((t) => t.assignee_id === id);
      const doneTasks = botTasks.filter(
        (t) => (t.board_columns as { is_done_column: boolean }).is_done_column
      );
      const activeTasks = botTasks.filter(
        (t) => !(t.board_columns as { is_done_column: boolean }).is_done_column
      );

      botStats[id] = {
        taskCount: doneTasks.length,
        ideaCount: (ideaAgentData ?? []).filter((ia) => ia.bot_id === id).length,
        assignedCount: activeTasks.length,
      };
    }
  }

  // Collect user's existing roles for duplicate detection in featured teams
  const userExistingRoles = new Set(
    myBots.map((b) => (b.role ?? "").toLowerCase()).filter(Boolean)
  );

  // Fetch all published community bots (including own — so authors can see their listing)
  const { data: communityData } = await supabase
    .from("bot_profiles")
    .select("*, owner:users!bot_profiles_owner_id_fkey(id, full_name, avatar_url)")
    .eq("is_published", true)
    .order("community_upvotes", { ascending: false })
    .limit(50);

  const communityBots = (communityData ?? []) as BotProfileWithOwner[];

  // Fetch user's agent votes
  const { data: votesData } = await supabase
    .from("agent_votes")
    .select("bot_id")
    .eq("user_id", user.id);

  const userVotedBotIds = new Set((votesData ?? []).map((v) => v.bot_id));

  // Fetch active featured teams with agents
  const { data: teamsData } = await supabase
    .from("featured_teams")
    .select("*, agents:featured_team_agents(*, bot:bot_profiles(*))")
    .eq("is_active", true)
    .order("display_order", { ascending: true });

  const featuredTeams = (teamsData ?? []) as unknown as FeaturedTeamWithAgents[];

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <AgentsHub
        myBots={myBots}
        botStats={botStats}
        communityBots={communityBots}
        userVotedBotIds={userVotedBotIds}
        userExistingRoles={userExistingRoles}
        featuredTeams={featuredTeams}
      />

      <div className="mt-6 flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-4">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Monitor agent activity and current task assignments on your{" "}
          <Link href="/dashboard" className="text-primary hover:underline">
            Dashboard
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
