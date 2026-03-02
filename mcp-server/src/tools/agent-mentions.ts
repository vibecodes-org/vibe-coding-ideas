import { z } from "zod";
import type { McpContext } from "../context";

export const getAgentMentionsSchema = z.object({
  idea_id: z
    .string()
    .uuid()
    .optional()
    .describe("Filter to a specific idea"),
  limit: z
    .number()
    .min(1)
    .max(50)
    .default(20)
    .describe("Max results (default 20)"),
});

export async function getAgentMentions(
  ctx: McpContext,
  params: z.infer<typeof getAgentMentionsSchema>
) {
  const ownerId = ctx.ownerUserId ?? ctx.userId;

  // 1. Look up all active bots owned by the user
  const { data: bots, error: botsError } = await ctx.supabase
    .from("bot_profiles")
    .select("id, name, role")
    .eq("owner_id", ownerId)
    .eq("is_active", true);

  if (botsError) throw new Error(`Failed to list bots: ${botsError.message}`);
  if (!bots || bots.length === 0) {
    return {
      mentions: [],
      total: 0,
      instructions:
        "No active agents found. Create an agent with create_agent first, then users can @mention it in discussions.",
    };
  }

  const botIds = bots.map((b) => b.id);
  const botMap = new Map(bots.map((b) => [b.id, b]));

  // 2. Query unread discussion_mention notifications for these bots
  // Use separate select strings to avoid Supabase generic type inference issues
  let query = ctx.supabase
    .from("notifications")
    .select(
      "id, user_id, type, read, created_at, reply_id, actor:users!notifications_actor_id_fkey(id, full_name), idea:ideas!notifications_idea_id_fkey(id, title), discussion:idea_discussions!notifications_discussion_id_fkey(id, title)"
    )
    .in("user_id", botIds)
    .eq("type", "discussion_mention" as const)
    .eq("read", false)
    .order("created_at", { ascending: false })
    .limit(params.limit);

  if (params.idea_id) {
    query = query.eq("idea_id", params.idea_id);
  }

  const { data: notifications, error: notifError } = await query;
  if (notifError)
    throw new Error(`Failed to fetch mentions: ${notifError.message}`);

  // 3. Enrich with agent info and mention location
  interface NotifRow {
    id: string;
    user_id: string;
    created_at: string;
    reply_id: string | null;
    actor: { id: string; full_name: string | null } | null;
    idea: { id: string; title: string } | null;
    discussion: { id: string; title: string } | null;
  }
  const rows: NotifRow[] = (notifications ?? []).map((n) => ({
    id: n.id,
    user_id: n.user_id,
    created_at: n.created_at,
    reply_id: n.reply_id,
    actor: n.actor as NotifRow["actor"],
    idea: n.idea as NotifRow["idea"],
    discussion: n.discussion as NotifRow["discussion"],
  }));
  const mentions = rows.map((n) => {
    const bot = botMap.get(n.user_id);
    return {
      notification_id: n.id,
      agent: bot
        ? { id: bot.id, name: bot.name, role: bot.role }
        : { id: n.user_id, name: "Unknown", role: null },
      actor: n.actor,
      idea: n.idea,
      discussion: n.discussion,
      reply_id: n.reply_id,
      mention_location: n.reply_id ? ("reply" as const) : ("discussion_body" as const),
      created_at: n.created_at,
    };
  });

  return {
    mentions,
    total: mentions.length,
    instructions:
      "To respond to a mention:\n" +
      "1. Call get_discussion to read the full thread context\n" +
      "2. Call set_agent_identity with the agent's ID to assume their persona\n" +
      "3. Call add_discussion_reply with parent_reply_id set to the mention's reply_id (so the response threads under the comment that @mentioned the agent)\n" +
      "4. Call set_agent_identity (no args) to reset to your default identity\n" +
      "Note: add_discussion_reply automatically marks the mention notification as read — no separate mark_notification_read call is needed.",
  };
}
