"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { validateComment } from "@/lib/validation";
import type { CommentType } from "@/types";

export async function createComment(
  ideaId: string,
  content: string,
  type: CommentType = "comment",
  parentCommentId?: string
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Not authenticated");
  }

  content = validateComment(content);

  const { error } = await supabase.from("comments").insert({
    idea_id: ideaId,
    author_id: user.id,
    content,
    type,
    parent_comment_id: parentCommentId || null,
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/ideas/${ideaId}`);
}

export async function incorporateComment(commentId: string, ideaId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Not authenticated");
  }

  // Verify the user is the idea author
  const { data: idea } = await supabase
    .from("ideas")
    .select("author_id")
    .eq("id", ideaId)
    .single();

  if (!idea || idea.author_id !== user.id) {
    throw new Error("Only the idea author can incorporate suggestions");
  }

  const { error } = await supabase
    .from("comments")
    .update({ is_incorporated: true })
    .eq("id", commentId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/ideas/${ideaId}`);
}

export async function updateComment(
  commentId: string,
  ideaId: string,
  content: string
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Not authenticated");
  }

  content = validateComment(content);

  const { error } = await supabase
    .from("comments")
    .update({ content })
    .eq("id", commentId)
    .eq("author_id", user.id);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/ideas/${ideaId}`);
}

export async function deleteComment(commentId: string, ideaId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Not authenticated");
  }

  // RLS enforces: author_id = auth.uid() OR is_bot_owner(author_id, auth.uid())
  const { error } = await supabase
    .from("comments")
    .delete()
    .eq("id", commentId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/ideas/${ideaId}`);
}
