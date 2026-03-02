import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { AgentProfile } from "@/components/agents/agent-profile";
import type { BotProfile } from "@/types";
import type { Metadata } from "next";

interface AgentPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: AgentPageProps): Promise<Metadata> {
  const { id } = await params;
  const { supabase } = await requireAuth();

  const { data: bot } = await supabase
    .from("bot_profiles")
    .select("name, role, bio")
    .eq("id", id)
    .maybeSingle();

  if (!bot) return { title: "Agent Not Found" };

  return {
    title: `${bot.name}${bot.role ? ` — ${bot.role}` : ""}`,
    description: bot.bio ?? `${bot.name} agent profile`,
    robots: { index: false, follow: false },
  };
}

export default async function AgentPage({ params }: AgentPageProps) {
  const { id } = await params;
  const { user, supabase } = await requireAuth();

  // Fetch bot profile with owner
  const { data: bot, error } = await supabase
    .from("bot_profiles")
    .select("*, owner:users!bot_profiles_owner_id_fkey(id, full_name, avatar_url)")
    .eq("id", id)
    .maybeSingle();

  if (error || !bot) notFound();

  // If not published and not the owner, 404
  const isOwner = bot.owner_id === user.id;
  if (!bot.is_published && !isOwner) notFound();

  const typedBot = bot as BotProfile & {
    owner: { id: string; full_name: string | null; avatar_url: string | null };
  };

  // Check if current user has voted
  const { data: voteData } = await supabase
    .from("agent_votes")
    .select("id")
    .eq("bot_id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  const hasVoted = !!voteData;

  // Fetch active (non-done, non-archived) tasks
  const { data: activeTasks } = await supabase
    .from("board_tasks")
    .select("id, title, archived, board_columns!inner(title, is_done_column, idea_id)")
    .eq("assignee_id", id)
    .eq("archived", false)
    .limit(20);

  const tasks = (activeTasks ?? []) as Array<{
    id: string;
    title: string;
    archived: boolean;
    board_columns: { title: string; is_done_column: boolean; idea_id: string };
  }>;

  // Count completed tasks (done column tasks)
  const { count: completedCount } = await supabase
    .from("board_tasks")
    .select("id", { count: "exact", head: true })
    .eq("assignee_id", id)
    .eq("board_columns.is_done_column", true);

  // The currently assigned = non-done tasks
  const currentlyAssigned = tasks.filter((t) => !t.board_columns.is_done_column);

  // Fetch ideas this agent is allocated to
  const { data: ideaAgentData } = await supabase
    .from("idea_agents")
    .select("idea_id, ideas!inner(id, title)")
    .eq("bot_id", id)
    .limit(10);

  const contributingIdeas = (ideaAgentData ?? []).map((ia) => ({
    id: (ia.ideas as { id: string; title: string }).id,
    title: (ia.ideas as { id: string; title: string }).title,
  }));

  // Count how many tasks assigned per idea
  const ideaTaskCounts: Record<string, number> = {};
  for (const task of currentlyAssigned) {
    const ideaId = task.board_columns.idea_id;
    ideaTaskCounts[ideaId] = (ideaTaskCounts[ideaId] ?? 0) + 1;
  }

  const contributingIdeasWithAssignment = contributingIdeas.map((idea) => ({
    ...idea,
    assignedCount: ideaTaskCounts[idea.id] ?? 0,
  }));

  // Fetch recent activity
  const { data: recentActivity } = await supabase
    .from("board_task_activity")
    .select("id, action, details, created_at, board_tasks!inner(title, board_columns!inner(idea_id))")
    .eq("user_id", id)
    .order("created_at", { ascending: false })
    .limit(5);

  // Cloned from info
  let clonedFromBot: { id: string; name: string } | null = null;
  if (typedBot.cloned_from) {
    const { data: sourceBot } = await supabase
      .from("bot_profiles")
      .select("id, name")
      .eq("id", typedBot.cloned_from)
      .maybeSingle();
    clonedFromBot = sourceBot;
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <AgentProfile
        bot={typedBot}
        isOwner={isOwner}
        hasVoted={hasVoted}
        tasks={currentlyAssigned}
        completedTaskCount={completedCount ?? 0}
        contributingIdeas={contributingIdeasWithAssignment}
        recentActivity={(recentActivity ?? []).map((a) => ({
          id: a.id,
          action: a.action,
          details: a.details as Record<string, string> | null,
          created_at: a.created_at,
          taskTitle: (a.board_tasks as { title: string }).title,
        }))}
        clonedFromBot={clonedFromBot}
      />
    </div>
  );
}
