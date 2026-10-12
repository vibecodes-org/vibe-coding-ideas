export interface StructuredPromptFields {
  goal: string;
  expertise?: string;
  constraints: string;
  approach: string;
}

const EXPERTISE_MARKER = "Domain expertise:";
const CONSTRAINTS_MARKER = "You must not:";
const APPROACH_MARKER = "Your approach:";

/**
 * How the converter reads old-layout text differently from the display parser
 * (task 472d5672): it keeps any text before the first `## Goal`-style heading
 * as the start of the goal, and strips a leading "You are a X." sentence only
 * when X is the agent's own role. Without these options the parser behaves as
 * it always has (the editor's old Builder tab relied on that).
 */
export interface LegacyParseOptions {
  /** Set to switch to converter behaviour. null = no role known: strip nothing. */
  role?: string | null;
}

/** Strip "You are a/an <role>." from the start of the text, only when it is exactly the agent's role. */
export function stripOwnRolePrefix(text: string, role: string | null | undefined): string {
  const r = role?.trim();
  if (!r) return text;
  const escaped = r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = text.match(new RegExp(`^You are (?:a |an )?${escaped}\\.\\s*`, "i"));
  return m ? text.slice(m[0].length).trim() : text;
}

export function parsePromptToFields(
  prompt: string,
  options?: LegacyParseOptions
): StructuredPromptFields | null {
  if (!prompt || !prompt.trim()) return null;

  const text = prompt.trim();
  const converter = options !== undefined;

  // Try markdown header format first: ## Goal / ## Constraints / ## Approach
  const mdResult = parseMarkdownHeaders(text, options);
  if (mdResult) return mdResult;

  // Fall back to inline marker format: "Domain expertise:" / "You must not:" / "Your approach:"
  const expertiseIdx = text.indexOf(EXPERTISE_MARKER);
  const constraintsIdx = text.indexOf(CONSTRAINTS_MARKER);
  const approachIdx = text.indexOf(APPROACH_MARKER);

  // Need at least one section marker to consider it structured
  if (constraintsIdx === -1 && approachIdx === -1 && expertiseIdx === -1) return null;

  let goal = "";
  let expertise: string | undefined;
  let constraints = "";
  let approach = "";

  // Build ordered marker positions for slicing
  const markers: { key: string; idx: number; len: number }[] = [];
  if (expertiseIdx !== -1) markers.push({ key: "expertise", idx: expertiseIdx, len: EXPERTISE_MARKER.length });
  if (constraintsIdx !== -1) markers.push({ key: "constraints", idx: constraintsIdx, len: CONSTRAINTS_MARKER.length });
  if (approachIdx !== -1) markers.push({ key: "approach", idx: approachIdx, len: APPROACH_MARKER.length });
  markers.sort((a, b) => a.idx - b.idx);

  // Extract each section's content
  for (let i = 0; i < markers.length; i++) {
    const start = markers[i].idx + markers[i].len;
    const end = i + 1 < markers.length ? markers[i + 1].idx : text.length;
    const content = text.slice(start, end).trim();
    if (markers[i].key === "expertise") expertise = content;
    else if (markers[i].key === "constraints") constraints = content;
    else if (markers[i].key === "approach") approach = content;
  }

  // Extract goal: everything before the first marker, minus the role prefix
  const firstMarkerIdx = markers[0]?.idx ?? text.length;
  let goalSection = text.slice(0, firstMarkerIdx).trim();

  if (converter) {
    goalSection = stripOwnRolePrefix(goalSection, options.role);
  } else {
    // Strip "You are a [role]." prefix from goal
    const rolePrefixMatch = goalSection.match(
      /^You are (?:a |an )?[^.]+\.\s*/i
    );
    if (rolePrefixMatch) {
      goalSection = goalSection.slice(rolePrefixMatch[0].length).trim();
    }
  }

  goal = goalSection;

  return { goal, expertise, constraints, approach };
}

function parseMarkdownHeaders(text: string, converter?: LegacyParseOptions): StructuredPromptFields | null {
  const goalMatch = text.match(/##\s*Goal\s*\n/i);
  const expertiseMatch = text.match(/##\s*Expertise\s*\n/i);
  const constraintsMatch = text.match(/##\s*Constraints\s*\n/i);
  const approachMatch = text.match(/##\s*Approach\s*\n/i);

  // Need at least two markdown section headers to consider it structured
  const matchCount = [goalMatch, expertiseMatch, constraintsMatch, approachMatch].filter(Boolean).length;
  if (matchCount < 2) return null;

  // Build ordered list of section boundaries
  const sections: { key: string; start: number; headerEnd: number }[] = [];
  if (goalMatch) {
    const idx = text.indexOf(goalMatch[0]);
    sections.push({ key: "goal", start: idx, headerEnd: idx + goalMatch[0].length });
  }
  if (expertiseMatch) {
    const idx = text.indexOf(expertiseMatch[0]);
    sections.push({ key: "expertise", start: idx, headerEnd: idx + expertiseMatch[0].length });
  }
  if (constraintsMatch) {
    const idx = text.indexOf(constraintsMatch[0]);
    sections.push({ key: "constraints", start: idx, headerEnd: idx + constraintsMatch[0].length });
  }
  if (approachMatch) {
    const idx = text.indexOf(approachMatch[0]);
    sections.push({ key: "approach", start: idx, headerEnd: idx + approachMatch[0].length });
  }

  sections.sort((a, b) => a.start - b.start);

  const fields: Record<string, string> = { goal: "", constraints: "", approach: "" };
  for (let i = 0; i < sections.length; i++) {
    const end = i + 1 < sections.length ? sections[i + 1].start : text.length;
    fields[sections[i].key] = text.slice(sections[i].headerEnd, end).trim();
  }

  // Text before the first heading is dropped by the display parser; the
  // converter keeps it, as the start of the goal.
  if (converter && sections[0].start > 0) {
    const preamble = stripOwnRolePrefix(text.slice(0, sections[0].start).trim(), converter.role);
    if (preamble) fields.goal = fields.goal ? `${preamble}\n\n${fields.goal}` : preamble;
  }

  return {
    goal: fields.goal,
    expertise: fields.expertise || undefined,
    constraints: fields.constraints,
    approach: fields.approach,
  };
}

export function isStructuredPrompt(prompt: string): boolean {
  return parsePromptToFields(prompt) !== null;
}
