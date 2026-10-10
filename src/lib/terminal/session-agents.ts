// In-app terminal — the board's agents as real Claude Code subagents (task
// 59889027).
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
// then names the matching subagent (see sessionAgentClaimHint).
//
// Both sides derive the subagent's name and tag from the same inputs with the
// functions below, so a session whose definitions have gone stale (persona
// edited, tier remapped) simply doesn't match and falls back to the old path.

import { createHash } from "node:crypto";

export type SessionAgentTier = "frontier" | "standard" | "cheap";

/**
 * Upper bound on the serialized payload. It travels as a single argv element
 * (macOS allows ~1 MB of argv + env); a busy board measured ~46 KB. Past this
 * the skill content is dropped first, then the whole payload.
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
 * against the claim, so any change to the persona or to the tier's resolved
 * model/effort since launch reads as "not this agent".
 */
export function sessionAgentTag(systemPrompt: string, model: string | null, effort: string | null): string {
  return `[vc ${personaHash(systemPrompt)} ${model ?? "auto"} ${effort ?? "auto"}]`;
}

export type SessionAgentInput = {
  bot: { id: string; name: string; role: string | null; system_prompt: string };
  tier: SessionAgentTier | null;
  /** Resolved Claude model alias for this tier (null on Auto steps — the subagent inherits). */
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
  const description =
    `VibeCodes agent ${bot.name}${role} for ${scope} workflow steps. ` +
    `Use only when a VibeCodes claim_next_step response names this subagent. ` +
    sessionAgentTag(bot.system_prompt, model, effort);

  // Personas describe the job but rarely the agent's own name, so in a live
  // test Atlas and Sentinel couldn't introduce themselves. The tag above still
  // hashes system_prompt alone, so this line never desyncs the claim's tag.
  let prompt = `${agentNameLine(bot)}\n\n${bot.system_prompt}`;
  if (skills.length > 0) {
    prompt += withSkillContent
      ? `\n\n## Skills\n${skills.map((s) => `### ${s.name}\n${s.content.trim()}`).join("\n\n")}`
      : `\n\n## Skills\nLoad these with get_agent_skill_content (agent_id "${bot.id}") when one is relevant: ` +
        `${skills.map((s) => s.name).join(", ")}.`;
  }

  return { description, prompt, ...(model ? { model } : {}), ...(effort ? { effort } : {}) };
}

function build(inputs: SessionAgentInput[], withSkillContent: boolean): Record<string, ClaudeCodeAgentDefinition> {
  const agents: Record<string, ClaudeCodeAgentDefinition> = {};
  for (const input of inputs) {
    if (!input.bot.system_prompt.trim()) continue;
    agents[sessionAgentName(input.bot, input.tier)] = definitionFor(input, withSkillContent);
  }
  return agents;
}

/**
 * Build the `--agents` payload. Returns null when there's nothing to define
 * or it can't be made to fit — the session then runs exactly as before.
 */
export function buildSessionAgents(
  inputs: SessionAgentInput[],
  maxBytes: number = SESSION_AGENTS_MAX_BYTES,
): Record<string, ClaudeCodeAgentDefinition> | null {
  for (const withSkillContent of [true, false]) {
    const agents = build(inputs, withSkillContent);
    if (Object.keys(agents).length === 0) return null;
    if (Buffer.byteLength(JSON.stringify(agents), "utf8") <= maxBytes) return agents;
  }
  return null;
}

/**
 * The claim-side hint: which subagent to look for, and what to report when it
 * was used. Only for a Claude claim of a step whose assigned bot has a persona.
 */
export function sessionAgentClaimHint(input: {
  bot: { id: string; name: string; system_prompt: string };
  tier: SessionAgentTier | null;
  model: string | null;
  effort: string | null;
}): { name: string; tag: string; instruction: string } {
  const name = sessionAgentName(input.bot, input.tier);
  const tag = sessionAgentTag(input.bot.system_prompt, input.model, input.effort);
  const reportTier = input.model
    ? ` and model_used "${input.model}"${input.effort ? `, reasoning_effort_used "${input.effort}"` : ""}`
    : "";
  const instruction =
    `NATIVE SUBAGENT: If your Agent tool offers a subagent type named "${name}" whose description ends with ` +
    `${tag}, spawn that subagent type for this step instead of a general-purpose one. Its system prompt already ` +
    `is this step's persona and its definition already sets this step's model and effort, so don't paste ` +
    `persona_prompt into its message or pass a model parameter: give it the step brief (description, context, ` +
    `expected deliverables, work_token). When completing, report persona_used "verbatim"${reportTier}. If no ` +
    `subagent with that exact name and tag is available, ignore this note and follow the steps above.`;
  return { name, tag, instruction };
}
