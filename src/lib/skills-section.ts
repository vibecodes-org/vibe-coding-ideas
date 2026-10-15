// The Skills section of an agent's instructions (task d04408b0).
//
// Skills used to be offered by name with "fetch it if relevant", and agents
// almost never did (about 1 step in 20). Now VibeCodes puts the full text of
// the step's agent's skills at the end of its persona, on every path: the
// claim_next_step response (mcp-server/src/tools/workflows.ts) and the in-app
// terminal's session agents (session-agents.ts) both build it with this one
// function, so the wording is identical wherever the step runs and the
// in-app match fingerprint can hash exactly what the claim sends.

/**
 * Most skills sent in full per agent. Any beyond this are named in the section
 * (with the fetch hint) rather than dropped, same as ones over the size budget.
 */
export const MAX_SKILLS_PER_AGENT = 50;

/**
 * Total skill-content budget per agent. Whole skills are sent in order up to
 * this; the rest are named with a fetch instruction. Today's largest agent
 * is ~9,500 characters, so this guards against a future runaway, not a case
 * that exists.
 */
export const SKILLS_SECTION_MAX_CHARS = 40_000;

export type SkillText = { name: string; content: string };

export type SkillsSection = {
  /** The section to append to a persona; "" when the agent has no skills. */
  text: string;
  /** Names of the skills whose full text is in `text`, in order. */
  sent: string[];
  /** Names that didn't fit the budget and are only named in `text`. */
  omitted: string[];
};

export function buildSkillsSection(
  botId: string,
  skills: SkillText[],
  maxChars: number = SKILLS_SECTION_MAX_CHARS,
  maxSkills: number = MAX_SKILLS_PER_AGENT,
): SkillsSection {
  if (skills.length === 0) return { text: "", sent: [], omitted: [] };

  const sent: SkillText[] = [];
  let used = 0;
  let fits = true;
  for (const skill of skills) {
    const body = skill.content.trim();
    // Stop at the first skill that doesn't fit so what's sent is always a
    // prefix of the creation order.
    if (!fits || sent.length >= maxSkills || used + body.length > maxChars) {
      fits = false;
      continue;
    }
    used += body.length;
    sent.push({ name: skill.name, content: body });
  }
  const omitted = skills.slice(sent.length).map((s) => s.name);

  let text = "## Skills\nThese are your reference skills. Apply the ones relevant to this step.";
  if (sent.length > 0) {
    text += `\n\n${sent.map((s) => `### ${s.name}\n${s.content}`).join("\n\n")}`;
  }
  if (omitted.length > 0) {
    text +=
      `\n\nNot included here (over the size limit): ${omitted.join(", ")}. ` +
      `Load them with get_agent_skill_content (agent_id "${botId}") when one is relevant.`;
  }
  return { text, sent: sent.map((s) => s.name), omitted };
}

/** The persona with the skills section appended; the persona alone when there are no skills. */
export function personaWithSkills(systemPrompt: string, skillsText: string): string {
  if (!skillsText) return systemPrompt;
  return systemPrompt.trim() ? `${systemPrompt}\n\n${skillsText}` : skillsText;
}
