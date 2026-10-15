// In-app terminal — the board's agents as real Claude Code and Codex
// subagents (tasks 59889027, e16d69e8).
//
// Until now a workflow step's persona only ever reached the worker as text:
// claim_next_step told the orchestrator to "spawn a subagent whose system
// prompt IS the persona", but Claude Code's Agent tool has no system-prompt
// field, so the worker was a general-purpose subagent with the persona pasted
// into its message (and edited along the way in ~29% of runs). Claude Code's
// `--agents '<json>'` flag defines session-only subagents — nothing is saved
// to disk — whose `prompt` IS their system prompt and whose `model`/`effort`
// are part of the definition. The bridge fetches this payload from
// POST /api/terminal/session/agents and passes it at launch; claim_next_step
// then names the matching subagent (see sessionAgentClaimHint). Codex has no
// such flag, so for a Codex launch the bridge writes the same definitions out
// as temporary agent-role files (terminal/bridge/src/session-agents.js) —
// `prompt` becomes the role's developer instructions.
//
// Both sides derive the subagent's name and tag from the same inputs with the
// functions below, so a session whose definitions have gone stale (persona
// edited, tier remapped) simply doesn't match and falls back to the old path.

import { createHash } from "node:crypto";
import { buildSkillsSection, personaWithSkills } from "../skills-section";
import { SYNC_MARKER } from "./session-agent-files";
import { agentPersonaBody, disallowedToolsFor, type ToolAccess } from "../agent-tool-access";

export type SessionAgentTier = "frontier" | "standard" | "cheap";

/**
 * Upper bound on the serialized payload. It travels as a single argv element
 * (macOS allows ~1 MB of argv + env); the busiest board measured ~96 KB. The
 * bridge drops the WHOLE list past this, so buildSessionAgents packs to it
 * itself: waiting agents first (skill content is dropped before any agent is,
 * see namesOnlyTag), then template-only agents into the room left.
 */
export const SESSION_AGENTS_MAX_BYTES = 200_000;

/** First 8 hex chars of the persona's sha256 — enough to spot an edit. */
export function personaHash(systemPrompt: string): string {
  return createHash("sha256").update(systemPrompt, "utf8").digest("hex").slice(0, 8);
}

/**
 * `vc-<name>-<bot id prefix>[-<tier>]`. The bot id prefix keeps two agents
 * with the same name (e.g. the two "Sentinel" seeds) apart; Auto steps (no
 * tier) get the untiered variant.
 */
export function sessionAgentName(bot: { id: string; name: string }, tier: SessionAgentTier | null): string {
  const slug =
    bot.name
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "agent";
  const idPart = bot.id.replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase();
  return `vc-${slug}-${idPart}${tier ? `-${tier}` : ""}`;
}

/**
 * The tag that ends the subagent's description. The orchestrator matches it
 * against the claim, so any change to the persona, to the skills text the step
 * is sent, or to the tier's resolved model/effort since launch reads as "not
 * this agent". `skillsText` is the exact Skills section buildSkillsSection
 * produces ("" for an agent without skills, which leaves the hash as it was
 * before skills were fingerprinted).
 */
export function sessionAgentTag(
  systemPrompt: string,
  model: string | null,
  effort: string | null,
  skillsText: string = "",
): string {
  return `[vc ${personaHash(personaWithSkills(systemPrompt, skillsText))} ${model ?? "auto"} ${effort ?? "auto"}]`;
}

/**
 * Tag for a definition that couldn't carry the full skill text (payload over
 * budget). The hash slot isn't hex, so it can never equal a claim's tag: the
 * step runs on the general path, whose persona carries the skills in full.
 */
function namesOnlyTag(model: string | null, effort: string | null): string {
  return `[vc skills-names-only ${model ?? "auto"} ${effort ?? "auto"}]`;
}

export type SessionAgentInput = {
  bot: { id: string; name: string; role: string | null; system_prompt: string; tool_access?: ToolAccess | null };
  tier: SessionAgentTier | null;
  /** Resolved model for this tier, Claude's or Codex's (null on Auto steps — the subagent inherits). */
  model: string | null;
  effort: string | null;
  skills: { name: string; content: string }[];
};

/** One entry of Claude Code's `--agents` JSON. */
export type ClaudeCodeAgentDefinition = {
  description: string;
  prompt: string;
  model?: string;
  effort?: string;
  /** Claude Code tools switched off for this agent (a Read-only agent can't edit files). */
  disallowedTools?: string[];
};

/** "You are Atlas, the Full Stack Engineer on this VibeCodes board." */
export function agentNameLine(bot: { name: string; role: string | null }): string {
  const name = bot.name.trim();
  const role = bot.role?.trim();
  return role
    ? `You are ${name}, the ${role} on this VibeCodes board.`
    : `You are ${name}, an agent on this VibeCodes board.`;
}

function definitionFor(input: SessionAgentInput, withSkillContent: boolean): ClaudeCodeAgentDefinition {
  const { bot, tier, model, effort, skills } = input;
  const role = bot.role ? ` (${bot.role})` : "";
  const scope = tier ? `${tier}-tier` : "untiered";
  const skillsSection = buildSkillsSection(bot.id, skills);
  // The persona as delivered: a Read-only agent's stored prompt plus the Tools
  // note, exactly as claim_next_step sends it. Full access is the stored text
  // unchanged, so fingerprints made before tool access existed still match.
  const persona = agentPersonaBody(bot.system_prompt, bot.tool_access);

  // Personas describe the job but rarely the agent's own name, so in a live
  // test Atlas and Sentinel couldn't introduce themselves. The tag below
  // hashes the persona and skills text without this line, so it never desyncs
  // the claim's tag.
  let prompt = `${agentNameLine(bot)}\n\n${persona}`;
  let tag: string;
  if (skills.length === 0) {
    tag = sessionAgentTag(persona, model, effort);
  } else if (withSkillContent) {
    prompt = personaWithSkills(prompt, skillsSection.text);
    tag = sessionAgentTag(persona, model, effort, skillsSection.text);
  } else {
    prompt +=
      `\n\n## Skills\nLoad these with get_agent_skill_content (agent_id "${bot.id}") when one is relevant: ` +
      `${skills.map((s) => s.name).join(", ")}.`;
    tag = namesOnlyTag(model, effort);
  }

  const description =
    `VibeCodes agent ${bot.name}${role} for ${scope} workflow steps. ` +
    `Use only when a VibeCodes claim_next_step response names this subagent. ${tag}`;

  const disallowedTools = disallowedToolsFor(bot.tool_access);
  return {
    description,
    prompt,
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
    ...(disallowedTools ? { disallowedTools } : {}),
  };
}

function build(inputs: SessionAgentInput[], withSkillContent: boolean): Record<string, ClaudeCodeAgentDefinition> {
  const agents: Record<string, ClaudeCodeAgentDefinition> = {};
  for (const input of inputs) {
    if (!input.bot.system_prompt.trim()) continue;
    agents[sessionAgentName(input.bot, input.tier)] = definitionFor(input, withSkillContent);
  }
  return agents;
}

function sizeOf(agents: Record<string, ClaudeCodeAgentDefinition>): number {
  return Buffer.byteLength(JSON.stringify(agents), "utf8");
}

/**
 * Build the `--agents` payload. Returns null only when there's nothing to
 * define. `inputs` are the agents with a step waiting and always win; the
 * `optional` ones (agents the board's templates would use, task 3a579815) only
 * fill whatever room is left, in the order given, with their full skills: one
 * that doesn't fit is skipped, never shrunk. The result never exceeds
 * `maxBytes`, so the bridge's all-or-nothing size check can't trip.
 */
export function buildSessionAgents(
  inputs: SessionAgentInput[],
  maxBytes: number = SESSION_AGENTS_MAX_BYTES,
  options: { optional?: SessionAgentInput[] } = {},
): Record<string, ClaudeCodeAgentDefinition> | null {
  type Agents = Record<string, ClaudeCodeAgentDefinition>;
  let fitted: Agents | null = null;
  for (const withSkillContent of [true, false]) {
    const candidate = build(inputs, withSkillContent);
    if (Object.keys(candidate).length === 0) break;
    if (sizeOf(candidate) <= maxBytes) {
      fitted = candidate;
      break;
    }
  }

  let agents: Agents = fitted ?? {};
  if (!fitted && Object.keys(build(inputs, false)).length > 0) {
    // Even names-only is over: keep as many waiting agents as fit, in order.
    for (const input of inputs) {
      const next: Agents = { ...agents, ...build([input], true) };
      if (sizeOf(next) <= maxBytes) agents = next;
    }
  }

  for (const input of options.optional ?? []) {
    const one = build([input], true);
    const [name] = Object.keys(one);
    if (!name || name in agents) continue;
    const next: Agents = { ...agents, ...one };
    if (sizeOf(next) <= maxBytes) agents = next;
  }
  return Object.keys(agents).length > 0 ? agents : null;
}

/**
 * The claim-side hint: which subagent to look for, and what to report when it
 * was used. Only for a claim of a step whose assigned bot has a persona; the
 * model and effort are the claiming agent's own resolution of the tier.
 */
export function sessionAgentClaimHint(input: {
  bot: { id: string; name: string; system_prompt: string; tool_access?: ToolAccess | null };
  tier: SessionAgentTier | null;
  model: string | null;
  effort: string | null;
  /** The Skills section the claim sends (buildSkillsSection(...).text); "" for an agent without skills. */
  skillsText?: string;
  agent?: "claude" | "codex";
  /**
   * The board's idea id and the claimed step's id. When both are given, a
   * Claude claim also says how to fetch the agent if the session wasn't
   * launched by VibeCodes (sync_board_agents).
   */
  ideaId?: string;
  stepId?: string;
}): { name: string; tag: string; instruction: string } {
  const name = sessionAgentName(input.bot, input.tier);
  const tag = sessionAgentTag(
    agentPersonaBody(input.bot.system_prompt, input.bot.tool_access),
    input.model,
    input.effort,
    input.skillsText ?? "",
  );
  const reportTier = input.model
    ? ` and model_used "${input.model}"${input.effort ? `, reasoning_effort_used "${input.effort}"` : ""}`
    : "";
  if (input.agent === "codex") {
    // Codex's spawn tool has no instructions field; a custom agent type's
    // role file is the only way the persona becomes the child's own
    // instructions. A role's model/effort override the spawn call's.
    const instruction =
      `NATIVE SUBAGENT: If your spawn_agent tool offers an agent_type named "${name}" whose description ends with ` +
      `${tag}, spawn this step's child with agent_type "${name}". Its developer instructions already are this ` +
      `step's persona and its definition already sets this step's model and reasoning effort, which meets the ` +
      `capability check above: don't put persona_prompt in its message. Give it everything else listed above ` +
      `(task requirements, step details, context, expected_deliverables, work_token, working directory, and where ` +
      `to find its board tools). When ` +
      `completing, report agent "codex", persona_used "verbatim"${reportTier}. If no agent type with that exact ` +
      `name and tag is available, ignore this note and follow the steps above.`;
    return { name, tag, instruction };
  }
  const syncStep =
    input.ideaId && input.stepId
      ? `If your Agent tool doesn't offer that exact name and tag: when it offers a subagent with this name whose ` +
        `description starts with "${SYNC_MARKER}", an earlier sync left a stale copy, so sync again; when it ` +
        `offers one without that marker, VibeCodes launched this session with its own copy, which a sync can't ` +
        `replace, so skip the sync. When it isn't offered at all, call sync_board_agents (idea_id ` +
        `"${input.ideaId}", step_id "${input.stepId}"), run the command it returns exactly as its instruction says ` +
        `(in the background, then end your turn), and spawn the subagent when you wake, only if its description ` +
        `ends with ${tag}. Sync each agent at most once per session, and never sync again after a failure or NEW_FOLDER. If the sync is skipped or ` +
        `fails, or it still isn't offered with that tag, `
      : `If no subagent with that exact name and tag is available, `;
  const instruction =
    `NATIVE SUBAGENT: If your Agent tool offers a subagent type named "${name}" whose description ends with ` +
    `${tag}, spawn that subagent type for this step instead of a general-purpose one. Its system prompt already ` +
    `is this step's persona and its definition already sets this step's model and effort, so don't paste ` +
    `persona_prompt into its message or pass a model parameter: give it the step brief (description, context, ` +
    `expected deliverables, work_token). When completing, report persona_used "verbatim"${reportTier}. ` +
    `${syncStep}ignore this note and follow the steps above.`;
  return { name, tag, instruction };
}
