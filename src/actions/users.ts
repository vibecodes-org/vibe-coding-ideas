"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function deleteUser(userId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Not authenticated");
  }

  // Verify caller is super admin
  const { data: callerProfile } = await supabase
    .from("users")
    .select("is_super_admin")
    .eq("id", user.id)
    .single();

  if (!callerProfile?.is_super_admin) {
    throw new Error("Not authorized: only super admins can delete users");
  }

  // Prevent deleting self
  if (user.id === userId) {
    throw new Error("Cannot delete yourself");
  }

  // Check if target is admin
  const { data: targetProfile } = await supabase
    .from("users")
    .select("is_admin")
    .eq("id", userId)
    .single();

  if (!targetProfile) {
    throw new Error("User not found");
  }

  if (targetProfile.is_admin) {
    throw new Error("Cannot delete another admin");
  }

  // Find all ideas by the target user
  const { data: ideas } = await supabase
    .from("ideas")
    .select("id, title")
    .eq("author_id", userId);

  // Find all unique collaborators on those ideas and create notifications
  if (ideas && ideas.length > 0) {
    const ideaIds = ideas.map((i) => i.id);

    const { data: collaborators } = await supabase
      .from("collaborators")
      .select("user_id, idea_id")
      .in("idea_id", ideaIds)
      .neq("user_id", userId);

    if (collaborators && collaborators.length > 0) {
      const notifications = collaborators.map((c) => ({
        user_id: c.user_id,
        actor_id: user.id,
        type: "user_deleted" as const,
        idea_id: c.idea_id,
      }));

      await supabase.from("notifications").insert(notifications);
    }
  }

  // Call the RPC to delete the user (cascades everything)
  const { error } = await supabase.rpc("admin_delete_user", {
    target_user_id: userId,
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/members");
  revalidatePath("/ideas");
}
