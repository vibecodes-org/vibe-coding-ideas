"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { POSITION_GAP } from "@/lib/constants";
import {
  validateDiscussionTitle,
  validateDiscussionBody,
  validateDiscussionReply,
  validateTitle,
} from "@/lib/validation";
import type { DiscussionStatus } from "@/types";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Check if user is the discussion author, idea owner, or admin */
async function checkDiscussionPermission(
  supabase: SupabaseClient,
  userId: string,
  discussionId: string,
  ideaId: string
): Promise<{ isAuthorOrOwner: boolean; isAdmin: boolean }> {
  const [{ data: discussion }, { data: idea }, { data: profile }] =
    await Promise.all([
      supabase
        .from("idea_discussions")
        .select("author_id")
        .eq("id", discussionId)
        .single(),
      supabase
        .from("ideas")
        .select("author_id")
        .eq("id", ideaId)
        .single(),
      supabase
        .from("users")
        .select("is_admin")
        .eq("id", userId)
        .single(),
    ]);

  if (!discussion) throw new Error("Discussion not found");

  const isAuthorOrOwner =
    userId === discussion.author_id || userId === idea?.author_id;
  const isAdmin = profile?.is_admin ?? false;

  return { isAuthorOrOwner, isAdmin };
}

export async function createDiscussion(
  ideaId: string,
  title: string,
  body: string
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  title = validateDiscussionTitle(title);
  body = validateDiscussionBody(body);

  const { data, error } = await supabase
    .from("idea_discussions")
    .insert({
      idea_id: ideaId,
      author_id: user.id,
      title,
      body,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  revalidatePath(`/ideas/${ideaId}/discussions`);
  revalidatePath(`/ideas/${ideaId}`);

  return data.id;
}

export async function updateDiscussion(
  discussionId: string,
  ideaId: string,
  updates: {
    title?: string;
    body?: string;
    status?: DiscussionStatus;
    pinned?: boolean;
  }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { isAuthorOrOwner, isAdmin } = await checkDiscussionPermission(
    supabase, user.id, discussionId, ideaId
  );
  if (!isAuthorOrOwner && !isAdmin) {
    throw new Error("You don't have permission to update this discussion");
  }

  const updateData: Record<string, unknown> = {};

  if (updates.title !== undefined) {
    updateData.title = validateDiscussionTitle(updates.title);
  }
  if (updates.body !== undefined) {
    updateData.body = validateDiscussionBody(updates.body);
  }
  if (updates.status !== undefined) {
    updateData.status = updates.status;
    // Clear target columns when reverting to open
    if (updates.status === "open") {
      updateData.target_column_id = null;
      updateData.target_assignee_id = null;
    }
  }
  if (updates.pinned !== undefined) {
    updateData.pinned = updates.pinned;
  }

  if (Object.keys(updateData).length === 0) return;

  const { error } = await supabase
    .from("idea_discussions")
    .update(updateData)
    .eq("id", discussionId);

  if (error) throw new Error(error.message);

  revalidatePath(`/ideas/${ideaId}/discussions`);
  revalidatePath(`/ideas/${ideaId}/discussions/${discussionId}`);
}

export async function deleteDiscussion(discussionId: string, ideaId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { isAuthorOrOwner, isAdmin } = await checkDiscussionPermission(
    supabase, user.id, discussionId, ideaId
  );
  if (!isAuthorOrOwner && !isAdmin) {
    throw new Error("You don't have permission to delete this discussion");
  }

  const { error } = await supabase
    .from("idea_discussions")
    .delete()
    .eq("id", discussionId);

  if (error) throw new Error(error.message);

  revalidatePath(`/ideas/${ideaId}/discussions`);
  revalidatePath(`/ideas/${ideaId}`);
}

export async function createDiscussionReply(
  discussionId: string,
  ideaId: string,
  content: string,
  parentReplyId?: string | null
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  content = validateDiscussionReply(content);

  // If replying to a nested reply, flatten to single level by using its parent
  let resolvedParentId = parentReplyId ?? null;
  if (resolvedParentId) {
    const { data: parent } = await supabase
      .from("idea_discussion_replies")
      .select("parent_reply_id")
      .eq("id", resolvedParentId)
      .single();
    if (parent?.parent_reply_id) {
      resolvedParentId = parent.parent_reply_id;
    }
  }

  const { data, error } = await supabase
    .from("idea_discussion_replies")
    .insert({
      discussion_id: discussionId,
      author_id: user.id,
      content,
      parent_reply_id: resolvedParentId,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  revalidatePath(`/ideas/${ideaId}/discussions/${discussionId}`);

  return data.id;
}

export async function updateDiscussionReply(
  replyId: string,
  ideaId: string,
  discussionId: string,
  content: string
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  // Verify user is the reply author
  const { data: reply } = await supabase
    .from("idea_discussion_replies")
    .select("author_id")
    .eq("id", replyId)
    .single();

  if (!reply) throw new Error("Reply not found");

  if (user.id !== reply.author_id) {
    throw new Error("You don't have permission to edit this reply");
  }

  content = validateDiscussionReply(content);

  const { error } = await supabase
    .from("idea_discussion_replies")
    .update({ content })
    .eq("id", replyId);

  if (error) throw new Error(error.message);

  revalidatePath(`/ideas/${ideaId}/discussions/${discussionId}`);
}

export async function deleteDiscussionReply(
  replyId: string,
  ideaId: string,
  discussionId: string
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  // Verify user is reply author, discussion author, idea owner, or admin
  const { data: reply } = await supabase
    .from("idea_discussion_replies")
    .select("author_id")
    .eq("id", replyId)
    .single();

  if (!reply) throw new Error("Reply not found");

  const isReplyAuthor = user.id === reply.author_id;

  if (!isReplyAuthor) {
    const { isAuthorOrOwner, isAdmin } = await checkDiscussionPermission(
      supabase, user.id, discussionId, ideaId
    );
    if (!isAuthorOrOwner && !isAdmin) {
      throw new Error("You don't have permission to delete this reply");
    }
  }

  const { error } = await supabase
    .from("idea_discussion_replies")
    .delete()
    .eq("id", replyId);

  if (error) throw new Error(error.message);

  revalidatePath(`/ideas/${ideaId}/discussions/${discussionId}`);
}

export async function toggleDiscussionVote(discussionId: string, ideaId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  // Try to delete first — if a row was removed, we toggled off
  const { data: deleted } = await supabase
    .from("discussion_votes")
    .delete()
    .eq("discussion_id", discussionId)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();

  if (!deleted) {
    // No existing vote — insert one (unique constraint prevents duplicates)
    const { error } = await supabase
      .from("discussion_votes")
      .insert({ discussion_id: discussionId, user_id: user.id });
    if (error) throw new Error(error.message);
  }

  revalidatePath(`/ideas/${ideaId}/discussions`);
  revalidatePath(`/ideas/${ideaId}/discussions/${discussionId}`);
}

export async function markReadyToConvert(
  discussionId: string,
  ideaId: string,
  targetColumnId: string,
  targetAssigneeId?: string | null
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { isAuthorOrOwner, isAdmin } = await checkDiscussionPermission(
    supabase, user.id, discussionId, ideaId
  );
  if (!isAuthorOrOwner && !isAdmin) {
    throw new Error("You don't have permission to update this discussion");
  }

  const { error } = await supabase
    .from("idea_discussions")
    .update({
      status: "ready_to_convert",
      target_column_id: targetColumnId,
      target_assignee_id: targetAssigneeId ?? null,
    })
    .eq("id", discussionId);

  if (error) throw new Error(error.message);

  revalidatePath(`/ideas/${ideaId}/discussions`);
  revalidatePath(`/ideas/${ideaId}/discussions/${discussionId}`);
}

export async function convertDiscussionToTask(
  discussionId: string,
  ideaId: string,
  columnId: string,
  taskTitle?: string
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  // Verify user is discussion author, idea owner, or admin
  const { isAuthorOrOwner, isAdmin } = await checkDiscussionPermission(
    supabase, user.id, discussionId, ideaId
  );
  if (!isAuthorOrOwner && !isAdmin) {
    throw new Error("You don't have permission to convert this discussion");
  }

  // Get the discussion
  const { data: discussion, error: fetchError } = await supabase
    .from("idea_discussions")
    .select("id, title, body, status")
    .eq("id", discussionId)
    .single();

  if (fetchError || !discussion) throw new Error("Discussion not found");
  if (discussion.status === "converted") {
    throw new Error("Discussion has already been converted to a task");
  }

  // Validate task title (use discussion title if not provided)
  const title = validateTitle(taskTitle || discussion.title);

  // Get max position in the target column
  const { data: tasks } = await supabase
    .from("board_tasks")
    .select("position")
    .eq("column_id", columnId)
    .order("position", { ascending: false })
    .limit(1);

  const maxPos = tasks && tasks.length > 0 ? tasks[0].position : -POSITION_GAP;

  // Create the board task with discussion backlink
  const { data: task, error: taskError } = await supabase
    .from("board_tasks")
    .insert({
      idea_id: ideaId,
      column_id: columnId,
      title,
      description: `From discussion: ${discussion.title}\n\n${discussion.body}`,
      discussion_id: discussionId,
      position: maxPos + POSITION_GAP,
    })
    .select("id")
    .single();

  if (taskError) throw new Error(taskError.message);

  // Mark discussion as converted — guard with status check to prevent concurrent conversion
  const { data: updated, error: updateError } = await supabase
    .from("idea_discussions")
    .update({ status: "converted" })
    .eq("id", discussionId)
    .in("status", ["open", "resolved", "ready_to_convert"])
    .select("id")
    .maybeSingle();

  if (updateError) {
    // Cleanup orphaned task
    await supabase.from("board_tasks").delete().eq("id", task.id);
    throw new Error(updateError.message);
  }

  if (!updated) {
    // Another concurrent conversion won — cleanup our task
    await supabase.from("board_tasks").delete().eq("id", task.id);
    throw new Error("Discussion was already converted by another user");
  }

  revalidatePath(`/ideas/${ideaId}/discussions`);
  revalidatePath(`/ideas/${ideaId}/discussions/${discussionId}`);
  revalidatePath(`/ideas/${ideaId}/board`);

  return task.id;
}
