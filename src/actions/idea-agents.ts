"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { validateUuid } from "@/lib/validation";

export async function allocateAgent(ideaId: string, botId: string) {
  const validIdeaId = validateUuid(ideaId, "Idea ID");
  const validBotId = validateUuid(botId, "Bot ID");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Not authenticated");
  }

  const { error } = await supabase.from("idea_agents").insert({
    idea_id: validIdeaId,
    bot_id: validBotId,
    added_by: user.id,
  });

  // Ignore unique constraint violation (already allocated)
  if (error && error.code !== "23505") {
    throw new Error("Failed to allocate agent");
  }

  revalidatePath(`/ideas/${ideaId}`);
  revalidatePath(`/ideas/${ideaId}/board`);
}

export async function removeIdeaAgent(ideaId: string, botId: string) {
  const validIdeaId = validateUuid(ideaId, "Idea ID");
  const validBotId = validateUuid(botId, "Bot ID");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Not authenticated");
  }

  const { error } = await supabase
    .from("idea_agents")
    .delete()
    .eq("idea_id", validIdeaId)
    .eq("bot_id", validBotId);

  if (error) {
    throw new Error("Failed to remove agent");
  }

  revalidatePath(`/ideas/${ideaId}`);
  revalidatePath(`/ideas/${ideaId}/board`);
}
