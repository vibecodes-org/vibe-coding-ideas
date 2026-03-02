import type React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Bell,
  Bot,
  CheckSquare,
  LayoutDashboard,
  Lightbulb,
  Plus,
  Users,
} from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { getDueDateStatus } from "@/lib/utils";
import { DEFAULT_PANEL_ORDER } from "@/lib/dashboard-order";
import { StatsCards } from "@/components/dashboard/stats-cards";
import { WelcomeExperience } from "@/components/dashboard/welcome-experience";
import { OnboardingWrapper } from "@/components/onboarding/onboarding-wrapper";
import { OnboardingChecklist } from "@/components/onboarding/onboarding-checklist";
import { ActiveBoards } from "@/components/dashboard/active-boards";
import type { ActiveBoard } from "@/components/dashboard/active-boards";
import { MyBots } from "@/components/dashboard/my-bots";
import { MyTasksList } from "@/components/dashboard/my-tasks-list";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { CollapsibleSection } from "@/components/dashboard/collapsible-section";
import { DashboardGrid } from "@/components/dashboard/dashboard-grid";
import { IdeaCard } from "@/components/ideas/idea-card";
import { Button } from "@/components/ui/button";
import type {
  IdeaWithAuthor,
  NotificationWithDetails,
  DashboardTask,
  DashboardBot,
  DashboardBotTask,
  DashboardBotActivity,
  BoardLabel,
  BotProfile,
  FeaturedTeamWithAgents,
} from "@/types";

export const metadata: Metadata = {
  title: "Dashboard",
  robots: { index: false, follow: false },
};

export default async function DashboardPage() {
  const { user, supabase } = await requireAuth();

  // Phase 1: Independent queries
  const [
    myIdeasResult,
    ideasCountResult,
    myIdeaIdsResult,
    collabResult,
    upvotesResult,
    votesResult,
    notificationsResult,
    tasksResult,
    botProfilesResult,
    userProfileResult,
    featuredTeamsResult,
  ] = await Promise.all([
    // My ideas (limit 5)
    supabase
      .from("ideas")
      .select("*, author:users!ideas_author_id_fkey(*)")
      .eq("author_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(5),
    // Total ideas count
    supabase
      .from("ideas")
      .select("*", { head: true, count: "exact" })
      .eq("author_id", user.id),
    // All my idea IDs (for board queries)
    supabase
      .from("ideas")
      .select("id")
      .eq("author_id", user.id),
    // Collaborations with count
    supabase
      .from("collaborators")
      .select("idea_id", { count: "exact" })
      .eq("user_id", user.id),
    // Upvotes on user's ideas
    supabase
      .from("ideas")
      .select("upvotes")
      .eq("author_id", user.id),
    // User's votes (for IdeaCard hasVoted)
    supabase
      .from("votes")
      .select("idea_id")
      .eq("user_id", user.id),
    // Recent notifications
    supabase
      .from("notifications")
      .select(
        "*, actor:users!notifications_actor_id_fkey(id, full_name, avatar_url, email, bio, github_username, created_at, updated_at), idea:ideas!notifications_idea_id_fkey(id, title)"
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(15),
    // Tasks assigned to user (exclude archived and tasks in done columns)
    supabase
      .from("board_tasks")
      .select(
        "*, column:board_columns!board_tasks_column_id_fkey(id, title, is_done_column), idea:ideas!board_tasks_idea_id_fkey(id, title), assignee:users!board_tasks_assignee_id_fkey(*)"
      )
      .eq("assignee_id", user.id)
      .eq("archived", false),
    // Bot profiles owned by user
    supabase
      .from("bot_profiles")
      .select("*")
      .eq("owner_id", user.id)
      .order("created_at"),
    // User profile for onboarding state
    supabase
      .from("users")
      .select("onboarding_completed_at, full_name, avatar_url, github_username")
      .eq("id", user.id)
      .maybeSingle(),
    // Featured teams for onboarding
    supabase
      .from("featured_teams")
      .select("*, agents:featured_team_agents(*, bot:bot_profiles(*))")
      .eq("is_active", true)
      .order("display_order", { ascending: true }),
  ]);

  const myIdeas = (myIdeasResult.data ?? []) as unknown as IdeaWithAuthor[];
  const ideasCount = ideasCountResult.count ?? 0;
  const collabIdeaIds = (collabResult.data ?? []).map((c) => c.idea_id);
  const collaborationsCount = collabResult.count ?? 0;
  const totalUpvotes = (upvotesResult.data ?? []).reduce(
    (sum, idea) => sum + idea.upvotes,
    0
  );
  const votedIdeaIds = new Set((votesResult.data ?? []).map((v) => v.idea_id));
  const notifications = (notificationsResult.data ?? []) as unknown as NotificationWithDetails[];

  // Process tasks — exclude tasks in done columns
  const rawTasks = (
    (tasksResult.data ?? []) as unknown as DashboardTask[]
  ).filter((t) => !t.column.is_done_column);

  // Bot profiles
  const botProfiles = (botProfilesResult.data ?? []) as BotProfile[];
  const botUserIds = botProfiles.map((b) => b.id);

  // User profile for onboarding
  const userProfile = userProfileResult.data as {
    onboarding_completed_at: string | null;
    full_name: string | null;
    avatar_url: string | null;
    github_username: string | null;
  } | null;
  const onboardingCompleted = !!userProfile?.onboarding_completed_at;
  const isNewUser = !onboardingCompleted && ideasCount === 0 && collaborationsCount === 0;
  const featuredTeams = (featuredTeamsResult.data ?? []) as unknown as FeaturedTeamWithAgents[];

  // All idea IDs the user owns or collaborates on (for board queries)
  const myIdeaIds = (myIdeaIdsResult.data ?? []).map((i) => i.id);
  const allUserIdeaIds = [...new Set([...myIdeaIds, ...collabIdeaIds])];

  // Phase 2: Dependent queries
  const [collabIdeasResult, taskLabelsResult, boardColumnsResult, boardTasksResult, botTasksResult, botActivityResult, displayedTaskCountsResult] = await Promise.all([
    // Collaboration idea details
    collabIdeaIds.length > 0
      ? supabase
          .from("ideas")
          .select("*, author:users!ideas_author_id_fkey(*)")
          .in("id", collabIdeaIds)
          .order("created_at", { ascending: false })
          .limit(5)
      : Promise.resolve({ data: [] }),
    // Task labels
    rawTasks.length > 0
      ? supabase
          .from("board_task_labels")
          .select("task_id, label:board_labels!board_task_labels_label_id_fkey(*)")
          .in(
            "task_id",
            rawTasks.map((t) => t.id)
          )
      : Promise.resolve({ data: [] }),
    // Board columns for user's ideas (with idea title for active boards)
    allUserIdeaIds.length > 0
      ? supabase
          .from("board_columns")
          .select("id, idea_id, title, is_done_column, position, idea:ideas!board_columns_idea_id_fkey(id, title)")
          .in("idea_id", allUserIdeaIds)
          .order("position")
      : Promise.resolve({ data: [] }),
    // Board tasks for user's ideas (non-archived only)
    allUserIdeaIds.length > 0
      ? supabase
          .from("board_tasks")
          .select("idea_id, column_id, updated_at")
          .in("idea_id", allUserIdeaIds)
          .eq("archived", false)
      : Promise.resolve({ data: [] }),
    // Tasks assigned to bots (non-archived, with column + idea info)
    botUserIds.length > 0
      ? supabase
          .from("board_tasks")
          .select(
            "id, title, assignee_id, updated_at, column:board_columns!board_tasks_column_id_fkey(title, is_done_column), idea:ideas!board_tasks_idea_id_fkey(id, title)"
          )
          .in("assignee_id", botUserIds)
          .eq("archived", false)
          .order("updated_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    // Recent activity by bots
    botUserIds.length > 0
      ? supabase
          .from("board_task_activity")
          .select("actor_id, action, created_at")
          .in("actor_id", botUserIds)
          .order("created_at", { ascending: false })
          .limit(botUserIds.length * 3)
      : Promise.resolve({ data: [] }),
    // Task counts for all user ideas (for IdeaCard badge) — covers displayed ideas
    allUserIdeaIds.length > 0
      ? supabase
          .from("board_tasks")
          .select("idea_id")
          .in("idea_id", allUserIdeaIds)
      : Promise.resolve({ data: [] }),
  ]);

  const collabIdeas = (collabIdeasResult.data ?? []) as unknown as IdeaWithAuthor[];

  // Process bot dashboard data
  type BotTaskRow = { id: string; title: string; assignee_id: string; updated_at: string; column: { title: string; is_done_column: boolean }; idea: { id: string; title: string } };
  type BotActivityRow = { actor_id: string; action: string; created_at: string };
  const botTaskRows = (botTasksResult.data ?? []) as unknown as BotTaskRow[];
  const botActivityRows = (botActivityResult.data ?? []) as BotActivityRow[];

  // Find most recent non-done-column task per bot
  const botCurrentTask = new Map<string, DashboardBotTask>();
  for (const t of botTaskRows) {
    if (t.column.is_done_column) continue;
    if (!botCurrentTask.has(t.assignee_id)) {
      botCurrentTask.set(t.assignee_id, {
        id: t.id,
        title: t.title,
        idea: t.idea,
        column: { title: t.column.title },
      });
    }
  }

  // Find most recent activity per bot
  const botLastActivity = new Map<string, DashboardBotActivity>();
  for (const a of botActivityRows) {
    if (!botLastActivity.has(a.actor_id)) {
      botLastActivity.set(a.actor_id, {
        action: a.action,
        created_at: a.created_at,
      });
    }
  }

  // Assemble DashboardBot[] — sorted by latest activity (most recent first),
  // bots with no activity fall to the bottom sorted by creation date
  const MCP_ACTIVE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
  const now = Date.now();
  const dashboardBots: DashboardBot[] = botProfiles
    .map((bot) => {
      const lastActivity = botLastActivity.get(bot.id) ?? null;
      const lastActivityAge = lastActivity
        ? now - new Date(lastActivity.created_at).getTime()
        : Infinity;
      return {
        ...bot,
        currentTask: botCurrentTask.get(bot.id) ?? null,
        lastActivity,
        isActiveMcpBot: lastActivityAge < MCP_ACTIVE_THRESHOLD_MS,
      };
    })
    .sort((a, b) => {
      const aTime = a.lastActivity?.created_at;
      const bTime = b.lastActivity?.created_at;
      if (aTime && bTime) return bTime.localeCompare(aTime);
      if (aTime && !bTime) return -1;
      if (!aTime && bTime) return 1;
      return a.created_at.localeCompare(b.created_at);
    });

  // Process active boards data
  type BoardColumnRow = { id: string; idea_id: string; title: string; is_done_column: boolean; position: number; idea: { id: string; title: string } };
  const boardColumns = (boardColumnsResult.data ?? []) as unknown as BoardColumnRow[];
  const boardTasks = (boardTasksResult.data ?? []) as { idea_id: string; column_id: string; updated_at: string }[];

  // Build idea title map from column joins (covers all ideas with boards)
  const ideaTitleMap = new Map<string, string>();
  for (const col of boardColumns) {
    if (col.idea && !ideaTitleMap.has(col.idea_id)) {
      ideaTitleMap.set(col.idea_id, col.idea.title);
    }
  }

  // Group columns by idea
  const columnsByIdea = new Map<string, BoardColumnRow[]>();
  for (const col of boardColumns) {
    const arr = columnsByIdea.get(col.idea_id) ?? [];
    arr.push(col);
    columnsByIdea.set(col.idea_id, arr);
  }

  // Count tasks per column and track most recent activity per idea
  const taskCountByColumn = new Map<string, number>();
  const lastActivityByIdea = new Map<string, string>();
  for (const task of boardTasks) {
    taskCountByColumn.set(task.column_id, (taskCountByColumn.get(task.column_id) ?? 0) + 1);
    const existing = lastActivityByIdea.get(task.idea_id);
    if (!existing || task.updated_at > existing) {
      lastActivityByIdea.set(task.idea_id, task.updated_at);
    }
  }

  // Build active boards — only ideas with at least one task
  const activeBoards: ActiveBoard[] = [];
  for (const [ideaId, columns] of columnsByIdea) {
    const totalTasks = columns.reduce((sum, col) => sum + (taskCountByColumn.get(col.id) ?? 0), 0);
    if (totalTasks === 0) continue;

    const title = ideaTitleMap.get(ideaId);
    if (!title) continue;

    const columnSummary = columns
      .map((col) => ({
        title: col.title,
        count: taskCountByColumn.get(col.id) ?? 0,
        isDone: col.is_done_column,
      }))
      .filter((c) => c.count > 0);

    activeBoards.push({
      ideaId,
      ideaTitle: title,
      totalTasks,
      columnSummary,
      lastActivity: lastActivityByIdea.get(ideaId) ?? new Date().toISOString(),
    });
  }

  // Sort by most recent activity and limit to 5
  activeBoards.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
  const topActiveBoards = activeBoards.slice(0, 5);

  // Build task counts from Phase 2 result (no extra sequential query needed)
  const taskCounts: Record<string, number> = {};
  for (const row of displayedTaskCountsResult.data ?? []) {
    const r = row as { idea_id: string };
    taskCounts[r.idea_id] = (taskCounts[r.idea_id] ?? 0) + 1;
  }

  // Build labels map
  const labelsMap = new Map<string, BoardLabel[]>();
  for (const row of taskLabelsResult.data ?? []) {
    const r = row as unknown as { task_id: string; label: BoardLabel };
    const existing = labelsMap.get(r.task_id) ?? [];
    existing.push(r.label);
    labelsMap.set(r.task_id, existing);
  }

  // Attach labels & sort tasks by urgency
  const duePriority = { overdue: 0, due_soon: 1, on_track: 2 };
  const tasks: DashboardTask[] = rawTasks
    .map((t) => ({ ...t, labels: labelsMap.get(t.id) ?? [] }))
    .sort((a, b) => {
      const aPri = a.due_date
        ? duePriority[getDueDateStatus(a.due_date)]
        : 3;
      const bPri = b.due_date
        ? duePriority[getDueDateStatus(b.due_date)]
        : 3;
      return aPri - bPri;
    });

  // Build sections record — order controlled by DashboardGrid
  const sections: Record<string, React.ReactNode> = {
    "active-boards": (
      <CollapsibleSection
        sectionId="active-boards"
        title="Active Boards"
        icon={<LayoutDashboard className="h-5 w-5" />}
        count={topActiveBoards.length}
      >
        <ActiveBoards boards={topActiveBoards} />
      </CollapsibleSection>
    ),
    "my-tasks": (
      <CollapsibleSection
        sectionId="my-tasks"
        title="My Tasks"
        icon={<CheckSquare className="h-5 w-5" />}
        count={tasks.length}
      >
        <MyTasksList tasks={tasks} />
      </CollapsibleSection>
    ),
    "my-ideas": (
      <CollapsibleSection
        sectionId="my-ideas"
        title="My Ideas"
        icon={<Lightbulb className="h-5 w-5" />}
        count={ideasCount}
        headerRight={
          myIdeas.length > 0 ? (
            <Link
              href="/ideas?view=mine"
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              View all
              <ArrowRight className="h-4 w-4" />
            </Link>
          ) : undefined
        }
      >
        {myIdeas.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center">
            <p className="text-sm text-muted-foreground">
              You haven&apos;t created any ideas yet.
            </p>
            <Link href="/ideas/new">
              <Button variant="outline" size="sm" className="mt-3 gap-2">
                <Plus className="h-4 w-4" />
                Create your first idea
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {myIdeas.map((idea) => (
              <IdeaCard
                key={idea.id}
                idea={idea}
                hasVoted={votedIdeaIds.has(idea.id)}
                taskCount={taskCounts[idea.id]}
              />
            ))}
          </div>
        )}
      </CollapsibleSection>
    ),
    collaborations: (
      <CollapsibleSection
        sectionId="collaborations"
        title="Collaborations"
        icon={<Users className="h-5 w-5" />}
        count={collaborationsCount}
        headerRight={
          collabIdeas.length > 0 ? (
            <Link
              href="/ideas?view=collaborating"
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              View all
              <ArrowRight className="h-4 w-4" />
            </Link>
          ) : undefined
        }
      >
        {collabIdeas.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center">
            <p className="text-sm text-muted-foreground">
              Not collaborating on any ideas yet.
            </p>
            <Link href="/ideas">
              <Button variant="outline" size="sm" className="mt-3">
                Browse the feed
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {collabIdeas.map((idea) => (
              <IdeaCard
                key={idea.id}
                idea={idea}
                hasVoted={votedIdeaIds.has(idea.id)}
                taskCount={taskCounts[idea.id]}
              />
            ))}
          </div>
        )}
      </CollapsibleSection>
    ),
    "recent-activity": (
      <CollapsibleSection
        sectionId="recent-activity"
        title="Recent Activity"
        icon={<Bell className="h-5 w-5" />}
        count={notifications.length}
      >
        <ActivityFeed notifications={notifications} />
      </CollapsibleSection>
    ),
  };

  // Conditionally add my-bots section
  if (dashboardBots.length > 0) {
    sections["my-bots"] = (
      <CollapsibleSection
        sectionId="my-bots"
        title="My Agents"
        icon={<Bot className="h-5 w-5" />}
        count={dashboardBots.length}
        headerRight={
          <Link
            href="/agents"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Manage
          </Link>
        }
      >
        <MyBots bots={dashboardBots} />
      </CollapsibleSection>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:py-8 sm:px-6 lg:px-8">
      <h1 className="mb-4 sm:mb-6 text-2xl sm:text-3xl font-bold">Dashboard</h1>

      {/* Onboarding: new users get the guided wizard, legacy users get the static card */}
      {isNewUser ? (
        <OnboardingWrapper
          userFullName={userProfile?.full_name ?? null}
          userAvatarUrl={userProfile?.avatar_url ?? null}
          userGithubUsername={userProfile?.github_username ?? null}
          featuredTeams={featuredTeams}
        />
      ) : !onboardingCompleted && ideasCount === 0 && collaborationsCount === 0 ? (
        <WelcomeExperience />
      ) : null}

      {/* Stats — full width */}
      <StatsCards
        ideasCount={ideasCount}
        collaborationsCount={collaborationsCount}
        upvotesReceived={totalUpvotes}
        tasksAssigned={tasks.length}
      />

      {/* Reorderable two-column grid */}
      <DashboardGrid sections={sections} defaultOrder={DEFAULT_PANEL_ORDER} />

      {/* Persistent onboarding checklist for users who completed the wizard but still have steps */}
      {onboardingCompleted && (
        <OnboardingChecklist
          hasProfile={!!userProfile?.full_name}
          hasIdea={ideasCount > 0}
          hasAgent={botProfiles.length > 0}
        />
      )}
    </div>
  );
}
