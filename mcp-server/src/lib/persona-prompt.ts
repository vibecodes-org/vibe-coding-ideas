// One place that composes the text of an agent's persona (card 5e654dd1).
//
// claim_next_step used to embed this as `persona_prompt` on every claim, and
// get_agent_prompt(as_persona: true) now returns it for a session whose named
// native helper isn't available. Both call this function, so the text is
// byte-identical wherever it comes from, and so is the skills section the
// in-app helper definitions fingerprint.

import { buildSkillsSection, personaWithSkills, type SkillsSection, type SkillText } from "../../../src/lib/skills-section";
import { agentPersonaBody, type ToolAccess } from "../../../src/lib/agent-tool-access";

export function composePersonaPrompt(
  botId: string,
  bot: { system_prompt: string | null; tool_access: ToolAccess | null },
  skillRows: SkillText[],
  agent: "claude" | "codex" = "claude",
): { prompt: string; skills: SkillsSection } {
  const skills = buildSkillsSection(botId, skillRows);
  // The persona ends with the Tools note (Read-only agents) and the Waiting
  // note (Claude only), ahead of the Skills section. A bot with no persona
  // text gets no note.
  const body = bot.system_prompt ? agentPersonaBody(bot.system_prompt, bot.tool_access, agent) : (bot.system_prompt ?? "");
  return { prompt: personaWithSkills(body, skills.text), skills };
}
