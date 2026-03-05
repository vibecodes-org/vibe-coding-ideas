import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { initializeBoardColumns } from "@/actions/board";
import { KanbanBoard } from "@/components/board/kanban-board";
import { BoardRealtime } from "@/components/board/board-realtime";
import { GuestBoardBanner } from "@/components/board/guest-board-banner";
import { Button } from "@/components/ui/button";
import type {
  BoardColumnWithTasks,
  BoardTaskWithAssignee,
  BoardLabel,
  BoardChecklistItem,
  User,
  BotProfile,
} from "@/types";
import type { Metadata } from "next";

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://vibecodes.co.uk";

export const maxDuration = 120;

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ taskId?: string }>;
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
    .select("id, title, description, author_id, visibility")
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

  // Phase 2: Parallel fetch of all board data
  const [
    { data: rawColumns },
    { data: rawTasks },
    { data: boardLabels },
    { data: rawChecklistItems },
    { data: collabs },
    { data: author },
    { data: rawUserBots },
    { data: userProfile },
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
    supabase
      .from("board_checklist_items")
      .select("*")
      .eq("idea_id", id)
      .order("position", { ascending: true }),
    supabase
      .from("collaborators")
      .select("user:users!collaborators_user_id_fkey(*)")
      .eq("idea_id", id),
    supabase
      .from("users")
      .select("*")
      .eq("id", idea.author_id)
      .single(),
    // Write-only fetches — skip for read-only guests
    isTeamMember
      ? supabase
          .from("bot_profiles")
          .select("*")
          .eq("owner_id", user.id)
          .eq("is_active", true)
      : Promise.resolve({ data: null }),
    isTeamMember
      ? supabase
          .from("users")
          .select("encrypted_anthropic_key")
          .eq("id", user.id)
          .single()
      : Promise.resolve({ data: null }),
  ]);

  // Phase 3: Queries that depend on Phase 2 results
  const taskIds = (rawTasks ?? []).map((t) => t.id);
  const userBotProfiles = (rawUserBots ?? []) as BotProfile[];
  const userBotIds = userBotProfiles.map((b) => b.id);

  const [{ data: taskLabelRows }, userBots] = await Promise.all([
    taskIds.length > 0
      ? supabase
          .from("board_task_labels")
          .select("task_id, label:board_labels!board_task_labels_label_id_fkey(*)")
          .in("task_id", taskIds)
      : Promise.resolve({ data: null }),
    userBotIds.length > 0
      ? supabase
          .from("users")
          .select("*")
          .in("id", userBotIds)
          .then(({ data }) => (data ?? []) as User[])
      : Promise.resolve([] as User[]),
  ]);

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

  // Build checklistItemsByTaskId
  const checklistItemsByTaskId: Record<string, BoardChecklistItem[]> = {};
  if (rawChecklistItems) {
    for (const item of rawChecklistItems) {
      if (!checklistItemsByTaskId[item.task_id]) {
        checklistItemsByTaskId[item.task_id] = [];
      }
      checklistItemsByTaskId[item.task_id].push(item as BoardChecklistItem);
    }
  }

  // Build team members list
  const teamMembers: User[] = [];
  if (author) teamMembers.push(author as User);
  if (collabs) {
    collabs.forEach((c) => {
      const u = c.user as unknown as User;
      if (u && !teamMembers.find((m) => m.id === u.id)) {
        teamMembers.push(u);
      }
    });
  }

  const userHasApiKey = !isReadOnly && !!userProfile?.encrypted_anthropic_key;

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

      {/* Header */}
      <div className="flex shrink-0 items-center gap-4 py-4">
        <Link href={`/ideas/${id}`}>
          <Button variant="ghost" size="sm" className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back to idea
          </Button>
        </Link>
        <h1 className="text-xl font-bold">{idea.title} — Board</h1>
      </div>

      {/* Guest banner */}
      {isReadOnly && (
        <div className="mb-4 shrink-0">
          <GuestBoardBanner ideaId={id} hasRequested={hasRequested} />
        </div>
      )}

      {/* Kanban Board */}
      <KanbanBoard
        columns={columns}
        ideaId={id}
        ideaDescription={idea.description}
        teamMembers={teamMembers}
        boardLabels={(boardLabels ?? []) as BoardLabel[]}
        checklistItemsByTaskId={checklistItemsByTaskId}
        currentUserId={user.id}
        initialTaskId={initialTaskId}
        userBots={userBots}
        hasApiKey={userHasApiKey}
        botProfiles={userBotProfiles}
        coverImageUrls={coverImageUrls}
        isReadOnly={isReadOnly}
      />
    </div>
  );
}
