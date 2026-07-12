import { z } from "zod";
import type { McpContext } from "../context";

export const listIdeasSchema = z.object({
  status: z
    .enum(["open", "in_progress", "completed", "archived"])
    .optional()
    .describe("Filter by idea status"),
  search: z.string().optional().describe("Search in title and description"),
  limit: z
    .number()
    .min(1)
    .max(50)
    .default(20)
    .describe("Max results (default 20)"),
});

export async function listIdeas(ctx: McpContext, params: z.infer<typeof listIdeasSchema>) {
  let query = ctx.supabase
    .from("ideas")
    .select("id, title, status, tags, upvotes, comment_count, collaborator_count, created_at, users!ideas_author_id_fkey(full_name)")
    .order("created_at", { ascending: false })
    .limit(params.limit);

  if (params.status) {
    query = query.eq("status", params.status);
  }

  if (params.search) {
    query = query.or(
      `title.ilike.%${params.search}%,description.ilike.%${params.search}%`
    );
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to list ideas: ${error.message}`);

  return data.map((idea) => ({
    ...idea,
    author: (idea as Record<string, unknown>).users,
    users: undefined,
  }));
}

export const getIdeaSchema = z.object({
  idea_id: z.string().uuid().describe("The idea ID"),
});

export async function getIdea(ctx: McpContext, params: z.infer<typeof getIdeaSchema>) {
  // Fetch idea with author
  const { data: idea, error } = await ctx.supabase
    .from("ideas")
    .select("*, users!ideas_author_id_fkey(id, full_name, email)")
    .eq("id", params.idea_id)
    .maybeSingle();

  if (error) throw new Error(`Failed to get idea: ${error.message}`);
  if (!idea) throw new Error(`Idea not found: ${params.idea_id}`);

  // Fetch comments count by type
  const { data: comments } = await ctx.supabase
    .from("comments")
    .select("id, type, content, created_at, users!comments_author_id_fkey(full_name)")
    .eq("idea_id", params.idea_id)
    .order("created_at", { ascending: false })
    .limit(10);

  // Fetch collaborators
  const { data: collaborators } = await ctx.supabase
    .from("collaborators")
    .select("users!collaborators_user_id_fkey(id, full_name, email)")
    .eq("idea_id", params.idea_id);

  // Fetch board summary (column counts)
  const { data: columns } = await ctx.supabase
    .from("board_columns")
    .select("id, title, is_done_column")
    .eq("idea_id", params.idea_id);

  let boardSummary = null;
  if (columns && columns.length > 0) {
    const { data: tasks } = await ctx.supabase
      .from("board_tasks")
      .select("id, column_id, archived")
      .eq("idea_id", params.idea_id)
      .eq("archived", false);

    boardSummary = columns.map((col) => ({
      column: col.title,
      is_done: col.is_done_column,
      task_count: tasks?.filter((t) => t.column_id === col.id).length ?? 0,
    }));
  }

  return {
    ...idea,
    author: (idea as Record<string, unknown>).users,
    users: undefined,
    recent_comments: comments ?? [],
    collaborators:
      collaborators?.map((c) => (c as Record<string, unknown>).users) ?? [],
    board_summary: boardSummary,
  };
}

export const updateIdeaDescriptionSchema = z.object({
  idea_id: z.string().uuid().describe("The idea ID"),
  description: z
    .string()
    .min(1)
    .max(50000)
    .describe("New description (markdown supported)"),
});

export async function updateIdeaDescription(
  ctx: McpContext,
  params: z.infer<typeof updateIdeaDescriptionSchema>
) {
  // Author check (closes the stdio service-role gap — remote already enforces
  // this via RLS, so this is behaviour-preserving there; see deleteIdea's
  // identical author-check pattern below).
  const { data: existing, error: fetchError } = await ctx.supabase
    .from("ideas")
    .select("id, author_id")
    .eq("id", params.idea_id)
    .maybeSingle();

  if (fetchError) throw new Error(`Failed to look up idea: ${fetchError.message}`);
  if (!existing) throw new Error(`Idea not found: ${params.idea_id}`);

  const callerId = ctx.ownerUserId ?? ctx.userId;
  if (callerId !== existing.author_id) {
    throw new Error("Only the idea author can update the description");
  }

  const { data, error } = await ctx.supabase
    .from("ideas")
    .update({ description: params.description })
    .eq("id", params.idea_id)
    .select("id, title")
    .single();

  if (error) throw new Error(`Failed to update idea: ${error.message}`);
  return { success: true, idea: data };
}

// --- Create Idea ---

export const createIdeaSchema = z.object({
  title: z.string().min(1).max(200).describe("Idea title"),
  description: z.string().min(1).max(50000).describe("Idea description (markdown supported)"),
  tags: z
    .array(z.string().max(50))
    .max(10)
    .default([])
    .describe("Tags for the idea (max 10)"),
  visibility: z
    .enum(["public", "private"])
    .default("public")
    .describe("Idea visibility (default public)"),
});

export async function createIdea(
  ctx: McpContext,
  params: z.infer<typeof createIdeaSchema>
) {
  const { data, error } = await ctx.supabase
    .from("ideas")
    .insert({
      title: params.title,
      description: params.description,
      author_id: ctx.ownerUserId ?? ctx.userId,
      tags: params.tags,
      visibility: params.visibility,
    })
    .select("id, title, status")
    .single();

  if (error) throw new Error(`Failed to create idea: ${error.message}`);
  return { success: true, idea: data };
}

// --- Delete Idea ---

export const deleteIdeaSchema = z.object({
  idea_id: z.string().uuid().describe("The idea ID"),
});

export async function deleteIdea(
  ctx: McpContext,
  params: z.infer<typeof deleteIdeaSchema>
) {
  // Check if user is author or admin
  const { data: idea } = await ctx.supabase
    .from("ideas")
    .select("id, title, author_id")
    .eq("id", params.idea_id)
    .maybeSingle();

  if (!idea) throw new Error(`Idea not found: ${params.idea_id}`);

  const humanId = ctx.ownerUserId ?? ctx.userId;
  const isAuthor = idea.author_id === humanId;

  if (!isAuthor) {
    // Check if admin
    const { data: profile } = await ctx.supabase
      .from("users")
      .select("is_admin")
      .eq("id", humanId)
      .single();

    if (!profile?.is_admin) {
      throw new Error("Only the idea author or an admin can delete an idea");
    }
  }

  const { error } = await ctx.supabase
    .from("ideas")
    .delete()
    .eq("id", params.idea_id);

  if (error) throw new Error(`Failed to delete idea: ${error.message}`);
  return { success: true, deleted_idea: { id: idea.id, title: idea.title } };
}

// --- Update Idea Status ---

export const updateIdeaStatusSchema = z.object({
  idea_id: z.string().uuid().describe("The idea ID"),
  status: z
    .enum(["open", "in_progress", "completed", "archived"])
    .describe("New status"),
});

export async function updateIdeaStatus(
  ctx: McpContext,
  params: z.infer<typeof updateIdeaStatusSchema>
) {
  const { data, error } = await ctx.supabase
    .from("ideas")
    .update({ status: params.status })
    .eq("id", params.idea_id)
    .select("id, title, status")
    .single();

  if (error) throw new Error(`Failed to update idea status: ${error.message}`);
  return { success: true, idea: data };
}

// --- Update Idea Tags ---

export const updateIdeaTagsSchema = z.object({
  idea_id: z.string().uuid().describe("The idea ID"),
  tags: z
    .array(z.string().max(50))
    .max(10)
    .describe("New tags array (replaces existing tags)"),
});

export async function updateIdeaTags(
  ctx: McpContext,
  params: z.infer<typeof updateIdeaTagsSchema>
) {
  const { data, error } = await ctx.supabase
    .from("ideas")
    .update({ tags: params.tags })
    .eq("id", params.idea_id)
    .select("id, title, tags")
    .single();

  if (error) throw new Error(`Failed to update idea tags: ${error.message}`);
  return { success: true, idea: data };
}
