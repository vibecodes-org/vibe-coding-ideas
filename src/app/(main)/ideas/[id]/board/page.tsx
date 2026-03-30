export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { initializeBoardColumns } from "@/actions/board";
import { getIdeaTeam } from "@/lib/idea-team";
import { KanbanBoard } from "@/components/board/kanban-board";
import { BoardRealtime } from "@/components/board/board-realtime";
import { GuestBoardBanner } from "@/components/board/guest-board-banner";
import { BoardPageTabs } from "@/components/board/board-page-tabs";
import { KitAppliedToast } from "@/components/board/kit-applied-toast";
import { McpConnectionBanner } from "@/components/shared/mcp-connection-banner";
import type {
  BoardColumnWithTasks,
  BoardTaskWithAssignee,
  BoardLabel,
  User,
} from "@/types";
import type { Metadata } from "next";

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://vibecodes.co.uk";

export const maxDuration = 120;

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ taskId?: string; tab?: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data: idea } = await supabase
    .from("ideas")
    .select("title, visibility")
    .eq("id", id)
    .single();

  if (!idea) return { title: "Board Not Found" };

  if (idea.visibility === "private") {
    return {
      title: "Private Board",
      description: "Sign in to VibeCodes to view this board.",
      robots: { index: false, follow: false },
    };
  }

  const ogTitle = `${idea.title} — Board`;
  const ogDescription = `Kanban board for ${idea.title} — plan, track, and ship on VibeCodes`;

  return {
    title: `${idea.title} — Board`,
    description: ogDescription,
    alternates: { canonical: `${appUrl}/ideas/${id}/board` },
    openGraph: {
      title: ogTitle,
      description: ogDescription,
      url: `${appUrl}/ideas/${id}/board`,
    },
    twitter: {
      card: "summary_large_image",
      title: ogTitle,
      description: ogDescription,
    },
  };
}

export default async function BoardPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { taskId: initialTaskId } = await searchParams;
  const { user, supabase } = await requireAuth();

  // Fetch idea (include visibility for access control)
  const { data: idea } = await supabase
    .from("ideas")
    .select("id, title, description, author_id, visibility, project_kit:project_kits!ideas_project_kit_id_fkey(name, icon)")
    .eq("id", id)
    .single();

  if (!idea) notFound();

  // Check if user is author or collaborator
  const isAuthor = user.id === idea.author_id;
  let isCollaborator = false;
  if (!isAuthor) {
    const { data: collab } = await supabase
      .from("collaborators")
      .select("id")
      .eq("idea_id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    isCollaborator = !!collab;
  }

  const isTeamMember = isAuthor || isCollaborator;
  const isReadOnly = !isTeamMember;

  // Non-team-members can only view public idea boards
  if (isReadOnly && idea.visibility !== "public") {
    notFound();
  }

  // Check if guest has a pending collaboration request
  let hasRequested = false;
  if (isReadOnly) {
    const { data: pendingRequest } = await supabase
      .from("collaboration_requests")
      .select("id")
      .eq("idea_id", id)
      .eq("requester_id", user.id)
      .eq("status", "pending")
      .maybeSingle();
    hasRequested = !!pendingRequest;
  }

  // Only initialize columns for team members (guests see what exists)
  if (isTeamMember) {
    await initializeBoardColumns(id);
  }

  // Phase 2: Parallel fetch of all board data + team info
  const [
    { data: rawColumns },
    { data: rawTasks },
    { data: boardLabels },
    { data: userProfile },
    ideaTeam,
    { data: userBotProfiles },
    { count: workflowTemplateCount },
  ] = await Promise.all([
    supabase.from("board_columns").select("*").eq("idea_id", id).order("position", { ascending: true }),
    supabase
      .from("board_tasks")
      .select("*, assignee:users!board_tasks_assignee_id_fkey(*)")
      .eq("idea_id", id)
      .order("position", { ascending: true }),
    supabase
      .from("board_labels")
      .select("*")
      .eq("idea_id", id)
      .order("created_at", { ascending: true }),
    isTeamMember
      ? supabase
          .from("users")
          .select("encrypted_anthropic_key, ai_starter_credits, is_admin, mcp_connected_at")
          .eq("id", user.id)
          .single()
      : Promise.resolve({ data: null }),
    getIdeaTeam(supabase, id, idea.author_id, user.id),
    isTeamMember
      ? supabase
          .from("bot_profiles")
          .select("*")
          .eq("owner_id", user.id)
          .eq("is_active", true)
      : Promise.resolve({ data: null }),
    // Workflow template count for nudge banners
    supabase
      .from("workflow_templates")
      .select("*", { head: true, count: "exact" })
      .eq("idea_id", id),
  ]);

  const hasWorkflowTemplates = (workflowTemplateCount ?? 0) > 0;
  const { teamMembers, ideaAgents, botProfiles: ideaAgentBotProfiles, ideaAgentDetails } = ideaTeam;

  // Phase 3: Queries that depend on Phase 2 results
  const taskIds = (rawTasks ?? []).map((t) => t.id);

  const { data: taskLabelRows } = taskIds.length > 0
    ? await supabase
        .from("board_task_labels")
        .select("task_id, label:board_labels!board_task_labels_label_id_fkey(*)")
        .in("task_id", taskIds)
    : { data: null };

  // Build taskLabelsMap: Record<taskId, BoardLabel[]>
  const taskLabelsMap: Record<string, BoardLabel[]> = {};
  if (taskLabelRows) {
    for (const row of taskLabelRows) {
      if (!row.label) continue;
      const label = row.label as unknown as BoardLabel;
      if (!taskLabelsMap[row.task_id]) {
        taskLabelsMap[row.task_id] = [];
      }
      taskLabelsMap[row.task_id].push(label);
    }
  }

  const userHasByokKey = !isReadOnly && !!userProfile?.encrypted_anthropic_key;
  const starterCredits = userProfile?.ai_starter_credits ?? 0;
  const userCanUseAi = !isReadOnly && (userHasByokKey || starterCredits > 0);

  // Batch-create signed URLs for cover images (single API call instead of N)
  const coverPaths = (rawTasks ?? []).map((t) => t.cover_image_path).filter((p): p is string => !!p);
  const coverImageUrls: Record<string, string> = {};
  if (coverPaths.length > 0) {
    const { data: signedUrls } = await supabase.storage.from("task-attachments").createSignedUrls(coverPaths, 3600);
    if (signedUrls) {
      for (const entry of signedUrls) {
        if (entry.signedUrl && entry.path) {
          coverImageUrls[entry.path] = entry.signedUrl;
        }
      }
    }
  }

  // Assemble columns with tasks (including labels)
  const columns: BoardColumnWithTasks[] = (rawColumns ?? []).map((col) => ({
    ...col,
    tasks: (rawTasks ?? [])
      .filter((t) => t.column_id === col.id)
      .map((t) => ({
        ...t,
        assignee: (t.assignee as unknown as User) ?? null,
        labels: taskLabelsMap[t.id] ?? [],
      })) as BoardTaskWithAssignee[],
  }));

  return (
    <div className="flex h-full flex-col overflow-hidden px-4 sm:px-6 lg:px-8">
      <BoardRealtime ideaId={id} />

      {/* Breadcrumb header */}
      <nav aria-label="Breadcrumb" className="flex shrink-0 items-center gap-1.5 py-4 text-sm">
        <Link href="/dashboard" className="text-muted-foreground transition-colors hover:text-foreground">
          Dashboard
        </Link>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />
        <Link href={`/ideas/${id}`} className="text-muted-foreground transition-colors hover:text-foreground">
          {idea.title}
        </Link>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />
        <span className="font-medium text-foreground">Board</span>
      </nav>

      {/* Guest banner */}
      {isReadOnly && (
        <div className="mb-4 shrink-0">
          <GuestBoardBanner ideaId={id} hasRequested={hasRequested} />
        </div>
      )}

      {/* MCP connection banner (compact) for team members */}
      {isTeamMember && !userProfile?.mcp_connected_at && (
        <div className="mb-3 shrink-0">
          <McpConnectionBanner
            agentCount={ideaAgents.length}
            taskCount={(rawTasks ?? []).length}
            compact
          />
        </div>
      )}

      {/* Tabbed board content */}
      <BoardPageTabs
        ideaId={id}
        boardLabels={(boardLabels ?? []) as BoardLabel[]}
        isReadOnly={isReadOnly}
        ideaAgentDetails={ideaAgentDetails}
        userBotProfiles={(userBotProfiles ?? []) as import("@/types").BotProfile[]}
        currentUserId={user.id}
        isAuthor={isAuthor}
        isTeamMember={isTeamMember}
        kitName={(idea as unknown as { project_kit: { name: string; icon: string } | null }).project_kit ? `${(idea as unknown as { project_kit: { icon: string; name: string } }).project_kit.icon} ${(idea as unknown as { project_kit: { name: string } }).project_kit.name}` : null}
      >
        <KanbanBoard
          columns={columns}
          ideaId={id}
          ideaDescription={idea.description}
          teamMembers={teamMembers}
          boardLabels={(boardLabels ?? []) as BoardLabel[]}
          currentUserId={user.id}
          initialTaskId={initialTaskId}
          ideaAgents={ideaAgents}
          canUseAi={userCanUseAi}
          hasByokKey={userHasByokKey}
          starterCredits={starterCredits}
          botProfiles={ideaAgentBotProfiles}
          userBotProfiles={(userBotProfiles ?? []) as import("@/types").BotProfile[]}
          coverImageUrls={coverImageUrls}
          isReadOnly={isReadOnly}
          hasWorkflowTemplates={hasWorkflowTemplates}
        />
      </BoardPageTabs>
      <KitAppliedToast />
    </div>
  );
}
