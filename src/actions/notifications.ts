"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { NotificationPreferences } from "@/types";

export async function markNotificationsRead(notificationIds: string[]) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Not authenticated");
  }

  await supabase
    .from("notifications")
    .update({ read: true })
    .in("id", notificationIds)
    .eq("user_id", user.id);

  revalidatePath("/ideas");
}

export async function markAllNotificationsRead() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Not authenticated");
  }

  await supabase
    .from("notifications")
    .update({ read: true })
    .eq("user_id", user.id)
    .eq("read", false);

  revalidatePath("/ideas");
}

export async function markAllAgentNotificationsRead() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Not authenticated");
  }

  // Get all bot IDs owned by this user
  const { data: bots } = await supabase
    .from("bot_profiles")
    .select("id")
    .eq("owner_id", user.id);

  const botIds = (bots ?? []).map((b) => b.id);
  if (botIds.length === 0) return;

  await supabase
    .from("notifications")
    .update({ read: true })
    .in("user_id", botIds)
    .eq("read", false);

  revalidatePath("/ideas");
}

export async function updateNotificationPreferences(
  preferences: NotificationPreferences
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Not authenticated");
  }

  const { error } = await supabase
    .from("users")
    .update({ notification_preferences: preferences })
    .eq("id", user.id);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/profile/${user.id}`);
}
