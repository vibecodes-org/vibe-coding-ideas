import { z } from "zod";
import { logger } from "../../../src/lib/logger";
import {
  AGENT_FILE_MAX_BYTES,
  agentFileFingerprint,
  agentFilesSyncCommand,
  renderAgentFile,
  type AgentSyncFile,
} from "../../../src/lib/terminal/session-agent-files";
import { isBoardMember, loadRunSessionAgents } from "../../../src/lib/terminal/board-session-agents";
import type { McpContext } from "../context";

// --- Sync Board Agents (cards 7939ee17, b9205d04, 0b5656a5) ---
//
// A VibeCodes-launched session gets the board's agents as real subagents via
// `claude --agents`. Any other session (a terminal started by hand, a Claude
// Code cloud session) has no such flag, so claim_next_step points it here when
// the subagent it names isn't offered. The tool builds the claimed step's agent
// AND the agents of the rest of its run, and returns a self-checking shell
// command with the files inside it. Nothing is downloaded, so it works on any
// cloud network level and on the local stdio server alike; the command's
// fingerprint check means a retyped-and-edited persona is deleted rather than
// run. Claude Code's folder watcher polls (every 30 s once the session is
// idle), so the command waits until Claude Code has READ every file instead of
// sleeping, and syncing the whole run at once means later steps are already
// loaded when they are claimed.

/** Declared on the tool so Claude Code doesn't save a ~50 KB result to a file. */
export const SYNC_MAX_RESULT_SIZE_CHARS = 150_000;

export const syncBoardAgentsSchema = z.object({
  idea_id: z.string().uuid().describe("The idea (board) the claimed step belongs to"),
  step_id: z.string().uuid().describe("The workflow step you just claimed: its agent, and the agents of the rest of its run, are saved"),
});

const INSTRUCTION =
  "Run the command in the SECOND block, copied exactly as given, from the project folder (the repo root), with " +
  "run_in_background, then end your turn. It saves every agent listed in `agents` (this step's, then the rest of " +
  "this run's) and waits until Claude Code has loaded them, so its completion wakes you in a new turn with them " +
  "available; don't poll or wait in the meantime, and don't run it in the foreground (Claude Code loads new agent " +
  "files on a later turn). On the wake, read the command's last output line. READY: every agent in `agents` is " +
  "loaded for this session. Spawn each by name at its own step without syncing again, provided that step's claim " +
  "names the same tag as listed here, even if your Agent tool's listing still shows an older description or tag " +
  "for that name (the listing is not refreshed), but only when the name is not offered at all or its listed " +
  "description starts with \"Saved by sync_board_agents.\": a name offered without that marker is a copy the " +
  "session was launched with, which a sync can't replace, so use the general-purpose steps for it instead. If " +
  "one is not offered at all after READY, run the same command once more (at most 2 syncs per step). NEW_FOLDER: the agents folder didn't exist when this session started, so " +
  "Claude Code won't load it until the next session; use the general-purpose steps, don't sync again this " +
  "session, include the new .claude/agents/.gitignore in your next commit, and tell the user. MISMATCH: a file " +
  "did not match its fingerprint and none were saved; don't retry, use the general-purpose steps. NOT_LOADED: " +
  "Claude Code had not read the files after about 75 seconds; use the general-purpose steps and don't sync again " +
  "this session. If you can't run in the background (you are a subagent, or background tasks are disabled), run " +
  "it in the foreground and use the general-purpose steps for this step: the agents are then loaded for the " +
  "claims after it. If the command fails for any other reason, use the general-purpose steps and don't sync " +
  "again this session. Never print, show, edit or commit the files: they hold agent instructions and are kept " +
  "out of git.";

type AgentSummary = { name: string; tag: string; sha256: string; bytes: number };

export type SyncBoardAgentsResult =
  | {
      status: "ok";
      /** The claimed step's agent first, then the rest of the run's, in step order. */
      agents: AgentSummary[];
      /** Agents of later steps left out to stay within the size budget; each is synced at its own claim. */
      omitted_agents: number;
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

  const built = await loadRunSessionAgents(ctx.supabase, {
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

  const files: (AgentSyncFile & { bytes: number })[] = built.agents.map(({ name, def }) => {
    const content = renderAgentFile(name, def, { synced: true });
    return {
      name,
      content,
      sha256: agentFileFingerprint(content),
      tag: /\[vc [^\]]+\]$/.exec(def.description)?.[0] ?? "",
      bytes: Buffer.byteLength(content, "utf8"),
    };
  });

  const claimed = files[0];
  if (claimed.bytes > AGENT_FILE_MAX_BYTES) {
    logger.warn("sync_board_agents: agent too large to sync", { idea: params.idea_id, bytes: claimed.bytes });
    return {
      status: "too_large",
      agent: { name: claimed.name, tag: claimed.tag ?? "", bytes: claimed.bytes },
      instruction:
        "This agent's file is too large to hand over in one command. Use the general-purpose steps from " +
        "claim_next_step for this step and don't sync again this session.",
    };
  }

  logger.info("sync_board_agents built agent files", {
    idea: params.idea_id,
    agents: files.length,
    omitted: built.omitted,
    bytes: files.reduce((n, f) => n + f.bytes, 0),
  });
  return {
    status: "ok",
    agents: files.map((f) => ({ name: f.name, tag: f.tag ?? "", sha256: f.sha256, bytes: f.bytes })),
    omitted_agents: built.omitted,
    instruction: INSTRUCTION,
    command: agentFilesSyncCommand({ files }),
  };
}

/**
 * The MCP reply: the summary as JSON in the first text block, the command raw
 * in the second. The command is not inside JSON on purpose: a model copying
 * JSON-escaped newlines (`\n`) is exactly where a persona gets damaged.
 */
export function syncBoardAgentsContent(result: SyncBoardAgentsResult) {
  const summary =
    result.status === "ok"
      ? { status: result.status, agents: result.agents, omitted_agents: result.omitted_agents, instruction: result.instruction }
      : { status: result.status, agent: result.agent, instruction: result.instruction };
  const content = [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }];
  if (result.status === "ok") content.push({ type: "text" as const, text: result.command });
  return { content };
}
