/**
 * Shared "Enhance idea description with AI" prompt building.
 *
 * MUST stay dependency-free (pure string constants + pure builder functions,
 * zero imports) — this module is imported by both the Next app (server
 * actions, API routes, the enhance dialog's default prompt) AND by
 * mcp-server's `get_idea_enhancement_prompt` tool, which cannot resolve `@/`
 * aliases or app-only dependencies (ai, logger, unpdf, etc.). See
 * mcp-server/tsconfig.json's `include` for how it's pulled into that build.
 *
 * Single source of truth so the web dialog, the streaming API route, the
 * server actions, and the MCP tool can never drift from each other on the
 * next prompt tweak.
 */

/** Default enhancement brief shown/used when the caller doesn't supply one. */
export const DEFAULT_ENHANCE_PROMPT =
  "Improve this idea description. Add more detail, user stories, technical scope, and a clear product vision. Keep the original intent and key points, but make it more comprehensive and well-structured.";

/** Base system prompt (no persona, no kit context). */
export const ENHANCE_SYSTEM_PROMPT =
  "You are an expert product manager and technical writer helping to enhance idea descriptions on a project management platform.";

/**
 * Builds the system prompt: the base expert-PM framing plus an optional
 * kit-context suffix. Callers compute `kitContext` themselves (it's derived
 * from idea-specific/kit-specific data this module doesn't know about) —
 * this just performs the concatenation, matching the exact format the
 * kit-aware `/api/ai/enhance` route used before extraction.
 */
export function buildEnhanceSystemPrompt(opts?: { kitContext?: string }): string {
  const kitContext = opts?.kitContext ?? "";
  return `${ENHANCE_SYSTEM_PROMPT}${kitContext}`;
}

/**
 * Builds the user prompt: enhancement brief + idea title/description +
 * optional attachment block. Matches the exact assembly every enhance
 * call site used before extraction:
 * `${prompt}\n\n---\n\n**Idea Title:** ${title}\n\n**Current Description:**\n${description}`
 * followed by the attachment block (or nothing — byte parity when there's
 * no attachment context).
 */
export function buildEnhanceUserPrompt(args: {
  prompt: string;
  title: string;
  description: string;
  attachmentBlock?: string;
}): string {
  const { prompt, title, description, attachmentBlock } = args;
  return `${prompt}\n\n---\n\n**Idea Title:** ${title}\n\n**Current Description:**\n${description}${attachmentBlock ?? ""}`;
}

/**
 * Builds the kit-context suffix shared by every "enhance" system prompt.
 * Canonicalized on `/api/ai/enhance-create/route.ts`'s wording (the live
 * create-idea path) — matches byte-for-byte what
 * `/api/ai/enhance/route.ts` (existing-idea path) already produces via
 * `getIdeaEnhancementPrompt`.
 */
export function buildKitContext(kitType?: string): string {
  return kitType
    ? `\nThis is a **${kitType}** project — tailor the description to concerns specific to ${kitType.toLowerCase()} projects (e.g. architecture, deployment, tooling, and workflows).`
    : "";
}

/** Base system prompt for enhancing a brand-new (not-yet-created) idea description. */
export const NEW_IDEA_SYSTEM_PROMPT =
  "You are an expert product manager and technical writer helping to enhance a new project idea description on a project management platform.";

/**
 * Builds the system prompt for the "New Idea" enhance flow: persona (if any)
 * + the new-idea framing + optional kit-context suffix. Matches the exact
 * assembly `/api/ai/enhance-create/route.ts` used before extraction
 * (lines 48-50 there):
 * - No persona: `${NEW_IDEA_SYSTEM_PROMPT}${kitContext}`
 * - With persona: `${personaPrompt}\n\nYou are helping to enhance a new project idea description on a project management platform.${kitContext}`
 */
export function buildNewIdeaSystemPrompt(opts?: {
  kitContext?: string;
  personaPrompt?: string | null;
}): string {
  const kitContext = opts?.kitContext ?? "";
  const personaPrompt = opts?.personaPrompt;
  if (personaPrompt) {
    return `${personaPrompt}\n\nYou are helping to enhance a new project idea description on a project management platform.${kitContext}`;
  }
  return `${NEW_IDEA_SYSTEM_PROMPT}${kitContext}`;
}
