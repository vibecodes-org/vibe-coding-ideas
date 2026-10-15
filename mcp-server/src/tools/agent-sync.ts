import { z } from "zod";
import { logger } from "../../../src/lib/logger";
import {
  AGENT_FILE_MAX_BYTES,
  agentFileFingerprint,
  agentFileSyncCommand,
  renderAgentFile,
} from "../../../src/lib/terminal/session-agent-files";
import { isBoardMember, loadStepSessionAgent } from "../../../src/lib/terminal/board-session-agents";
import type { McpContext } from "../context";

// --- Sync Board Agents (cards 7939ee17, b9205d04) ---
//
// A VibeCodes-launched session gets the board's agents as real subagents via
// `claude --agents`. Any other session (a terminal started by hand, a Claude
// Code cloud session) has no such flag, so claim_next_step points it here when
// the subagent it names isn't offered. The tool builds that ONE step's agent
// and returns a self-checking shell command with the file inside it. Nothing is
// downloaded, so it works on any cloud network level and on the local stdio
// server alike; the command's fingerprint check means a retyped-and-edited
// persona is deleted rather than run.

/** Declared on the tool so Claude Code doesn't save a ~50 KB result to a file. */
export const SYNC_MAX_RESULT_SIZE_CHARS = 150_000;

export const syncBoardAgentsSchema = z.object({
  idea_id: z.string().uuid().describe("The idea (board) the claimed step belongs to"),
  step_id: z.string().uuid().describe("The workflow step you just claimed: its agent is the one saved"),
});

const INSTRUCTION =
  "Run the command in the SECOND block, copied exactly as given, from the project folder (the repo root), with " +
  "run_in_background, then end your turn. Its completion wakes you in a new turn with the subagent loaded; " +
  "don't poll or wait in the meantime, and don't run it in the foreground (Claude Code loads new agent files " +
  "on a later turn). On the wake, read the command's last output line. READY: spawn `agent.name` if your Agent " +
  "tool now offers it with a description ending `agent.tag`; if it still isn't offered, run one more " +
  "background `sleep 5` and end the turn again, and after that use the general-purpose steps from " +
  "claim_next_step. NEW_FOLDER: the agents folder didn't exist when this session started, so Claude Code won't " +
  "load it until the next session; use the general-purpose steps for this step, don't sync again this session, " +
  "include the new .claude/agents/.gitignore in your next commit, and tell the user. MISMATCH: the file did not " +
  "match its fingerprint and was deleted; don't retry, use the general-purpose steps. If you can't run in the " +
  "background (you are a subagent, or background tasks are disabled), run it in the foreground and use the " +
  "general-purpose steps for this step: the file is then ready for the next claim. If the command fails for " +
  "any other reason, use the general-purpose steps and don't sync again this session. Never print, show, edit " +
  "or commit the file: it holds agent instructions and is kept out of git. Sync each agent at most once per " +
  "session, and never sync again after a failure or NEW_FOLDER.";

export type SyncBoardAgentsResult =
  | {
      status: "ok";
      agent: { name: string; tag: string; sha256: string; bytes: number };
      instruction: string;
      command: string;
    }
  | { status: "too_large"; agent: { name: string; tag: string; bytes: number }; instruction: string };

export async function syncBoardAgents(
  ctx: McpContext,
  params: z.infer<typeof syncBoardAgentsSchema>,
): Promise<SyncBoardAgentsResult> {
  // The real human, never the bot identity.
  const userId = ctx.ownerUserId ?? ctx.userId;
  if (!(await isBoardMember(ctx.supabase, params.idea_id, userId))) {
    throw new Error("You're not on this idea's team, so its agents can't be synced.");
  }

  const built = await loadStepSessionAgent(ctx.supabase, {
    stepId: params.step_id,
    ideaId: params.idea_id,
    userId,
  });
  if (!built) {
    throw new Error(
      "That step has no agent with a persona on this board, so there is nothing to sync. " +
        "Carry on with the general-purpose steps from claim_next_step.",
    );
  }

  const content = renderAgentFile(built.name, built.def, { synced: true });
  const bytes = Buffer.byteLength(content, "utf8");
  const tag = /\[vc [^\]]+\]$/.exec(built.def.description)?.[0] ?? "";

  if (bytes > AGENT_FILE_MAX_BYTES) {
    logger.warn("sync_board_agents: agent too large to sync", { idea: params.idea_id, bytes });
    return {
      status: "too_large",
      agent: { name: built.name, tag, bytes },
      instruction:
        "This agent's file is too large to hand over in one command. Use the general-purpose steps from " +
        "claim_next_step for this step and don't sync again this session.",
    };
  }

  const sha256 = agentFileFingerprint(content);
  logger.info("sync_board_agents built an agent file", { idea: params.idea_id, bytes });
  return {
    status: "ok",
    agent: { name: built.name, tag, sha256, bytes },
    instruction: INSTRUCTION,
    command: agentFileSyncCommand({ name: built.name, content, sha256 }),
  };
}

/**
 * The MCP reply: the summary as JSON in the first text block, the command raw
 * in the second. The command is not inside JSON on purpose: a model copying
 * JSON-escaped newlines (`\n`) is exactly where a persona gets damaged.
 */
export function syncBoardAgentsContent(result: SyncBoardAgentsResult) {
  const { status, agent, instruction } = result;
  const content = [
    { type: "text" as const, text: JSON.stringify({ status, agent, instruction }, null, 2) },
  ];
  if (result.status === "ok") content.push({ type: "text" as const, text: result.command });
  return { content };
}
