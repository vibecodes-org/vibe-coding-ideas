import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { User, BotProfile, IdeaAgentUser, IdeaAgentWithDetails } from "@/types";

type TypedClient = SupabaseClient<Database>;

export interface IdeaTeamResult {
  /** Author + collaborators (human users, deduplicated) */
  teamMembers: User[];
  /** Bot User records from the idea_agents pool, enriched with ownerName */
  ideaAgents: IdeaAgentUser[];
  /** Combined humans + agent User records for @mention autocomplete */
  allMentionable: User[];
  /** Current user's bot IDs from the pool (for canModify checks on bot-authored content) */
  currentUserBotIds: string[];
  /** BotProfile records from the pool (for AI features) */
  botProfiles: BotProfile[];
  /** Full idea_agent rows with bot + owner details (for IdeaAgentsSection) */
  ideaAgentDetails: IdeaAgentWithDetails[];
}

/**
 * Fetches the full team for an idea: author, collaborators, and pooled agents.
 *
 * Consolidates the duplicated team-building logic from idea detail, board,
 * and discussion pages into a single reusable utility.
 */
export async function getIdeaTeam(
  supabase: TypedClient,
  ideaId: string,
  authorId: string,
  currentUserId?: string
): Promise<IdeaTeamResult> {
  // Parallel fetch: author, collaborators, idea agents pool
  const [{ data: author }, { data: collabs }, { data: rawIdeaAgents }] =
    await Promise.all([
      supabase.from("users").select("*").eq("id", authorId).maybeSingle(),
      supabase
        .from("collaborators")
        .select("user:users!collaborators_user_id_fkey(*)")
        .eq("idea_id", ideaId),
      supabase
        .from("idea_agents")
        .select(
          "*, bot:bot_profiles!idea_agents_bot_id_fkey(*, owner:users!bot_profiles_owner_id_fkey(id, full_name))"
        )
        .eq("idea_id", ideaId)
        .order("created_at", { ascending: true }),
    ]);

  // Build deduplicated human team members
  const teamMembersMap = new Map<string, User>();
  if (author) teamMembersMap.set(author.id, author as User);
  for (const c of collabs ?? []) {
    const u = c.user as unknown as User;
    if (u && !teamMembersMap.has(u.id)) teamMembersMap.set(u.id, u);
  }
  const teamMembers = Array.from(teamMembersMap.values());

  // Extract bot profiles + owner info from the pool
  const botProfiles: BotProfile[] = [];
  const botOwnerNameMap = new Map<string, string>();
  const botOwnerIdMap = new Map<string, string>();
  const botIds: string[] = [];

  if (rawIdeaAgents) {
    for (const row of rawIdeaAgents) {
      const bot = (row as Record<string, unknown>).bot as
        | (BotProfile & {
            owner?: { id: string; full_name: string | null };
          })
        | null;
      if (bot) {
        botProfiles.push(bot);
        botIds.push(bot.id);
        botOwnerNameMap.set(bot.id, bot.owner?.full_name ?? "Unknown");
        if (bot.owner?.id) botOwnerIdMap.set(bot.id, bot.owner.id);
      }
    }
  }

  // Fetch User records for bot IDs (bots have matching users rows)
  let ideaAgents: IdeaAgentUser[] = [];
  if (botIds.length > 0) {
    const { data: botUsers } = await supabase
      .from("users")
      .select("*")
      .in("id", botIds);

    ideaAgents = (botUsers ?? []).map((u) => ({
      ...u,
      ownerName: botOwnerNameMap.get(u.id) ?? "Unknown",
      ownerId: botOwnerIdMap.get(u.id) ?? "",
    })) as IdeaAgentUser[];
  }

  // Combined mentionable: humans + agents (deduplicated)
  const allMentionable: User[] = [...teamMembers];
  for (const agent of ideaAgents) {
    if (!teamMembersMap.has(agent.id)) {
      allMentionable.push(agent as User);
    }
  }

  // Current user's bot IDs from the pool (for canModify checks)
  const currentUserBotIds = currentUserId
    ? botIds.filter((id) => botOwnerIdMap.get(id) === currentUserId)
    : [];

  // Build typed idea_agent details for IdeaAgentsSection
  const ideaAgentDetails = (rawIdeaAgents ?? []).map((row) => {
    const r = row as unknown as IdeaAgentWithDetails;
    return r;
  });

  return {
    teamMembers,
    ideaAgents,
    allMentionable,
    currentUserBotIds,
    botProfiles,
    ideaAgentDetails,
  };
}
