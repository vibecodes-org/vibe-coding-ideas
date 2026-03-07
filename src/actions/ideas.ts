"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { validateTitle, validateDescription, validateGithubUrl, validateTags } from "@/lib/validation";
import type { IdeaStatus } from "@/types";

export async function createIdea(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const title = validateTitle(formData.get("title") as string);
  const description = validateDescription(formData.get("description") as string);
  const tags = validateTags(formData.get("tags") as string);
  const githubUrl = validateGithubUrl((formData.get("github_url") as string) || null);
  const visibility = formData.get("visibility") === "private" ? "private" as const : "public" as const;

  const { data, error } = await supabase
    .from("ideas")
    .insert({
      title,
      description,
      author_id: user.id,
      tags,
      github_url: githubUrl,
      visibility,
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  redirect(`/ideas/${data.id}`);
}

export async function updateIdea(ideaId: string, formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Not authenticated");
  }

  const title = validateTitle(formData.get("title") as string);
  const description = validateDescription(formData.get("description") as string);
  const tags = validateTags(formData.get("tags") as string);
  const githubUrl = validateGithubUrl((formData.get("github_url") as string) || null);
  const visibility = formData.get("visibility") === "private" ? "private" as const : "public" as const;

  const { error } = await supabase
    .from("ideas")
    .update({ title, description, tags, github_url: githubUrl, visibility })
    .eq("id", ideaId)
    .eq("author_id", user.id);

  if (error) {
    throw new Error(error.message);
  }

  redirect(`/ideas/${ideaId}`);
}

export async function updateIdeaStatus(ideaId: string, status: IdeaStatus) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Not authenticated");
  }

  const { error } = await supabase
    .from("ideas")
    .update({ status })
    .eq("id", ideaId)
    .eq("author_id", user.id);

  if (error) {
    throw new Error(error.message);
  }

  // Notify collaborators of the status change (respecting preferences)
  const { data: collaborators } = await supabase
    .from("collaborators")
    .select("user_id, user:users!collaborators_user_id_fkey(notification_preferences)")
    .eq("idea_id", ideaId)
    .neq("user_id", user.id);

  if (collaborators && collaborators.length > 0) {
    const notifications = collaborators
      .filter((c) => {
        const prefs = (c.user as any)?.notification_preferences;
        return prefs?.status_changes !== false;
      })
      .map((c) => ({
        user_id: c.user_id,
        actor_id: user.id,
        type: "status_change" as const,
        idea_id: ideaId,
      }));

    if (notifications.length > 0) {
      await supabase.from("notifications").insert(notifications);
    }
  }

  revalidatePath(`/ideas/${ideaId}`);
}

export async function updateIdeaFields(
  ideaId: string,
  updates: {
    title?: string;
    description?: string;
    tags?: string[];
    github_url?: string | null;
    visibility?: "public" | "private";
  }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Not authenticated");
  }

  // Validate each provided field
  const dbUpdates: Record<string, unknown> = {};
  if (updates.title !== undefined) {
    dbUpdates.title = validateTitle(updates.title);
  }
  if (updates.description !== undefined) {
    dbUpdates.description = validateDescription(updates.description);
  }
  if (updates.tags !== undefined) {
    dbUpdates.tags = updates.tags.map((t) => t.toLowerCase().trim()).filter(Boolean);
  }
  if (updates.github_url !== undefined) {
    dbUpdates.github_url = validateGithubUrl(updates.github_url);
  }
  if (updates.visibility !== undefined) {
    dbUpdates.visibility = updates.visibility;
  }

  if (Object.keys(dbUpdates).length === 0) return;

  const { error } = await supabase
    .from("ideas")
    .update(dbUpdates)
    .eq("id", ideaId)
    .eq("author_id", user.id);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/ideas/${ideaId}`);
}

export async function deleteIdea(ideaId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Not authenticated");
  }

  // Check if user is admin
  const { data: profile } = await supabase
    .from("users")
    .select("is_admin")
    .eq("id", user.id)
    .single();

  const isAdmin = profile?.is_admin ?? false;

  // Best-effort cleanup: delete physical files from storage before DB cascade
  try {
    const [{ data: taskAttachments }, { data: ideaAttachments }] = await Promise.all([
      supabase.from("board_task_attachments").select("storage_path").eq("idea_id", ideaId),
      supabase.from("idea_attachments").select("storage_path").eq("idea_id", ideaId),
    ]);

    const removals: Promise<unknown>[] = [];
    if (taskAttachments && taskAttachments.length > 0) {
      removals.push(supabase.storage.from("task-attachments").remove(taskAttachments.map((a) => a.storage_path)));
    }
    if (ideaAttachments && ideaAttachments.length > 0) {
      removals.push(supabase.storage.from("idea-attachments").remove(ideaAttachments.map((a) => a.storage_path)));
    }
    if (removals.length > 0) await Promise.all(removals);
  } catch {
    // Don't block deletion if storage cleanup fails
  }

  let query = supabase.from("ideas").delete().eq("id", ideaId);

  // Non-admins can only delete their own ideas
  if (!isAdmin) {
    query = query.eq("author_id", user.id);
  }

  const { error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  redirect("/ideas");
}
