import { z } from "zod";
import { logger } from "../../../src/lib/logger";
import { mintAgentFilesToken, AGENT_FILES_TTL_SECONDS } from "../../../src/lib/agent-files-token";
import { syncCommand } from "../../../src/lib/terminal/session-agent-files";
import { isBoardMember } from "../../../src/lib/terminal/board-session-agents";
import type { McpContext } from "../context";

// --- Sync Board Agents (card 7939ee17) ---
//
// A VibeCodes-launched session gets the board's agents as real subagents via
// `claude --agents`. Any other session (a terminal started by hand, a Claude
// Code cloud session) has no such flag, so claim_next_step points it here when
// the subagent it names isn't offered. The tool returns a short-lived download
// command; running it writes untracked `.claude/agents/vc-*.md` files, which
// Claude Code loads without a restart. Only available on the remote server: the
// signing secret is the app's, and a local stdio install does not hold it.

export const syncBoardAgentsSchema = z.object({
  idea_id: z.string().uuid().describe("The idea (board) whose agents to sync"),
});

const INSTRUCTION =
  "Run `command` once, from the project folder (the repo root), with your shell tool, then spawn the subagent " +
  "claim_next_step named. It saves this board's agents as .claude/agents/vc-*.md files, which Claude Code " +
  "loads within seconds. Never print, show, edit or commit those files: they hold agent instructions and are " +
  "kept out of git. Do not sync again for the same claim. If the command fails (for example a cloud " +
  "environment that blocks vibecodes.co.uk), or Claude Code still doesn't offer the subagent, carry on with " +
  "the general-purpose steps from claim_next_step: nothing else is lost.";

export async function syncBoardAgents(ctx: McpContext, params: z.infer<typeof syncBoardAgentsSchema>) {
  const secret = process.env.TERMINAL_SESSION_SECRET?.trim();
  if (!secret) {
    throw new Error(
      "sync_board_agents is only available through the remote VibeCodes connector. A local stdio install " +
        "doesn't hold the signing secret. Carry on with the general-purpose steps from claim_next_step.",
    );
  }

  // The real human, never the bot identity: the download re-checks this user's membership.
  const userId = ctx.ownerUserId ?? ctx.userId;
  if (!(await isBoardMember(ctx.supabase, params.idea_id, userId))) {
    throw new Error("You're not on this idea's team, so its agents can't be synced.");
  }

  const now = Math.floor(Date.now() / 1000);
  const token = mintAgentFilesToken({ sub: userId, idea: params.idea_id }, secret, now);
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://vibecodes.co.uk").replace(/\/+$/, "");
  const url = `${appUrl}/api/terminal/agent-files?t=${token}`;
  logger.info("sync_board_agents issued a download link", { idea: params.idea_id });

  return {
    command: syncCommand(url),
    expires_at: new Date((now + AGENT_FILES_TTL_SECONDS) * 1000).toISOString(),
    instruction: INSTRUCTION,
  };
}
