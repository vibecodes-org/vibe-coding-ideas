import { createHash } from "node:crypto";
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

/**
 * Shared by every outcome that leaves the named agent unloaded (card db4c7f7b).
 * Codex has no board-native agents, so none of this applies to it.
 */
export const NO_LOAD_STEPS =
  "NO-LOAD steps: the board-named agent is never optional, and there is no silent general-purpose fallback. " +
  "(1) If your Agent tool offers the same agent under another tier or effort suffix (a name starting " +
  "vc-<role>-<same agent id>) AND its description ends with a tag starting with the same `[vc <hash> ` as this " +
  "step's claim (native_subagent.tag; an out-of-date copy or `[vc skills-names-only` does not count), spawn it and " +
  "pass the claim's model and effort explicitly on the Agent tool; it counts as the named agent, so report " +
  "persona_used \"verbatim\", subagent_type its name, and the model and effort you actually used. (2) Otherwise " +
  "STOP: tell the user plainly which agent could not be loaded and why, and wait. Only if they explicitly say yes " +
  "in this session may you spawn a general helper with get_agent_prompt (as_persona true), and then report " +
  "persona_used \"adapted\" and subagent_type \"general-purpose\".";

/** An agent that is too large or trimmed to names only is a VibeCodes fault, never normal (live: largest prompt ~5k chars, skills ~1.3k). */
const FAULT_STOP =
  "This is a VibeCodes fault, not something you did: tell the user plainly that the agent is too large to load " +
  "and to report it, then wait. ";

const INSTRUCTION =
  "INSTALL IN TWO SHORT STEPS (a long multi-line command is often refused by a session's command-safety check, " +
  "so the script goes in through your file-write tool instead). (1) With your file-write tool (Write), save the " +
  "SECOND block exactly as given, byte for byte, to `script_path` (a path under your home folder: expand ~ to the " +
  "absolute home directory; create the folder if needed). If `script_path` already exists it is this same script " +
  "(its name follows the files' fingerprints): don't overwrite or read it, just run `run_command`. If writing " +
  "under your home folder is refused, save it to `fallback_script_path` inside the project instead (a folder " +
  "Claude Code doesn't watch, so it can't be mistaken for an agent; it isn't git-ignored, so never commit it and " +
  "delete it once the run ends) and run `fallback_run_command`. (2) From the project folder (the repo root), run exactly " +
  "`run_command` (one short line) with " +
  "run_in_background, then end your turn. Only if you have no file-write tool, run the SECOND block itself as " +
  "one command instead, copied exactly. The script saves every agent listed in `agents` (this step's, then the rest of " +
  "this run's) and waits until Claude Code has loaded them, so its completion wakes you in a new turn with them " +
  "available; don't poll or wait in the meantime, and don't run it in the foreground (Claude Code loads new agent " +
  "files on a later turn). On the wake, read the last output line. READY: every agent in `agents` is " +
  "loaded for this session. Spawn each by name at its own step without syncing again, provided that step's claim " +
  "names the same tag as listed here, even if your Agent tool's listing still shows an older description or tag " +
  "for that name (the listing is not refreshed), but only when the name is not offered at all or its listed " +
  "description starts with \"Saved by sync_board_agents.\": a name offered without that marker is a copy the " +
  "session was launched with, which a sync can't replace: STOP and tell the user \"Agent <name> was changed after " +
  "this session started. Restart or Resume the session to load the current version.\", then wait. If " +
  "one is not offered with its tag after READY, run the same command once more (at most 2 syncs per step). NEW_FOLDER: no agents folder existed when this session started, so the " +
  "command created one (and the user-level one, so later sessions in any repo on this machine are covered), " +
  "which Claude Code won't load until the next session; use the NO-LOAD steps below, don't sync again this " +
  "session, and include the new .claude/agents/.gitignore in your next commit. MISMATCH: a file " +
  "did not match its fingerprint and none were saved; don't retry, use the NO-LOAD steps below. NOT_LOADED: " +
  "Claude Code had not read the files after about 75 seconds; use the NO-LOAD steps below and don't sync again " +
  "this session. If you can't run in the background (you are a subagent, or background tasks are disabled), run " +
  "it in the foreground and use the NO-LOAD steps below for this step: the agents are then loaded for the " +
  "claims after it. If the command fails or is refused for any other reason (including your command-safety check declining it), use the NO-LOAD steps below and don't sync " +
  "again this session. Never print, show, edit or commit the files: they hold agent instructions and are kept " +
  "out of git. " +
  NO_LOAD_STEPS;

/** Same folder as the step-usage scripts; the name follows the files' fingerprints, so a re-sync reuses it. */
export function agentSyncScriptPath(sha256s: string[]): string {
  const id = createHash("sha256").update(sha256s.join(",")).digest("hex").slice(0, 8);
  return `~/.claude/vibecodes/agent-sync-${id}.sh`;
}

type AgentSummary = { name: string; tag: string; sha256: string; bytes: number };

export type SyncBoardAgentsResult =
  | {
      status: "ok";
      /** The claimed step's agent first, then the rest of the run's, in step order. */
      agents: AgentSummary[];
      /** Agents of later steps left out to stay within the size budget; each is synced at its own claim. */
      omitted_agents: number;
      instruction: string;
      /** Where the session saves `command` (the installer script) before running `run_command`. */
      script_path: string;
      /** The one short line to run once the script is saved. */
      run_command: string;
      /** Used only when writing under the home folder is refused. */
      fallback_script_path: string;
      fallback_run_command: string;
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
        NO_LOAD_STEPS,
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
        `Agent ${claimed.name}'s file is too large to hand over in one command. ${FAULT_STOP}` +
        "Don't sync again this session. " +
        NO_LOAD_STEPS,
    };
  }
  if ((claimed.tag ?? "").includes("skills-names-only")) {
    logger.warn("sync_board_agents: agent skills trimmed to names only (VibeCodes fault)", { idea: params.idea_id, agent: claimed.name });
    return {
      status: "too_large",
      agent: { name: claimed.name, tag: claimed.tag ?? "", bytes: claimed.bytes },
      instruction:
        `Agent ${claimed.name} could not carry its full skills text. ${FAULT_STOP}` +
        "Don't sync again this session. " +
        NO_LOAD_STEPS,
    };
  }

  logger.info("sync_board_agents built agent files", {
    idea: params.idea_id,
    agents: files.length,
    omitted: built.omitted,
    bytes: files.reduce((n, f) => n + f.bytes, 0),
  });
  const command = agentFilesSyncCommand({ files });
  const scriptPath = agentSyncScriptPath(files.map((f) => f.sha256));
  const fallbackScriptPath = scriptPath.replace("~/.claude/vibecodes/", ".claude/vibecodes/");
  return {
    status: "ok",
    script_path: scriptPath,
    run_command: `sh ${scriptPath}`,
    fallback_script_path: fallbackScriptPath,
    fallback_run_command: `sh ${fallbackScriptPath}`,
    agents: files.map((f) => ({ name: f.name, tag: f.tag ?? "", sha256: f.sha256, bytes: f.bytes })),
    omitted_agents: built.omitted,
    instruction: INSTRUCTION,
    command,
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
      ? { status: result.status, script_path: result.script_path, run_command: result.run_command, fallback_script_path: result.fallback_script_path, fallback_run_command: result.fallback_run_command, agents: result.agents, omitted_agents: result.omitted_agents, instruction: result.instruction }
      : { status: result.status, agent: result.agent, instruction: result.instruction };
  const content = [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }];
  if (result.status === "ok") content.push({ type: "text" as const, text: result.command });
  return { content };
}
