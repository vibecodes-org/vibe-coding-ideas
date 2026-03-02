export interface StructuredPromptFields {
  goal: string;
  constraints: string;
  approach: string;
}

const CONSTRAINTS_MARKER = "You must not:";
const APPROACH_MARKER = "Your approach:";
const ROLE_PREFIX = "You are a";

export function generatePromptFromFields(
  role: string,
  fields: StructuredPromptFields
): string {
  const { goal, constraints, approach } = fields;
  const parts: string[] = [];

  // Role + goal paragraph
  const rolePart = role.trim() ? `${ROLE_PREFIX} ${role.trim()}.` : "";
  const goalPart = goal.trim();
  if (rolePart && goalPart) {
    parts.push(`${rolePart} ${goalPart}`);
  } else if (rolePart) {
    parts.push(rolePart);
  } else if (goalPart) {
    parts.push(goalPart);
  }

  if (constraints.trim()) {
    parts.push(`${CONSTRAINTS_MARKER} ${constraints.trim()}`);
  }

  if (approach.trim()) {
    parts.push(`${APPROACH_MARKER} ${approach.trim()}`);
  }

  return parts.join("\n\n");
}

export function parsePromptToFields(
  prompt: string
): StructuredPromptFields | null {
  if (!prompt || !prompt.trim()) return null;

  const text = prompt.trim();

  // Try markdown header format first: ## Goal / ## Constraints / ## Approach
  const mdResult = parseMarkdownHeaders(text);
  if (mdResult) return mdResult;

  // Fall back to inline marker format: "You must not:" / "Your approach:"
  const constraintsIdx = text.indexOf(CONSTRAINTS_MARKER);
  const approachIdx = text.indexOf(APPROACH_MARKER);

  // Need at least one section marker to consider it structured
  if (constraintsIdx === -1 && approachIdx === -1) return null;

  let goal = "";
  let constraints = "";
  let approach = "";

  // Extract constraints
  if (constraintsIdx !== -1) {
    const start = constraintsIdx + CONSTRAINTS_MARKER.length;
    const end = approachIdx > constraintsIdx ? approachIdx : text.length;
    constraints = text.slice(start, end).trim();
  }

  // Extract approach
  if (approachIdx !== -1) {
    approach = text.slice(approachIdx + APPROACH_MARKER.length).trim();
  }

  // Extract goal: everything before the first section marker, minus the role prefix
  const firstMarkerIdx =
    constraintsIdx !== -1 && approachIdx !== -1
      ? Math.min(constraintsIdx, approachIdx)
      : constraintsIdx !== -1
        ? constraintsIdx
        : approachIdx;

  let goalSection = text.slice(0, firstMarkerIdx).trim();

  // Strip "You are a [role]." prefix from goal
  const rolePrefixMatch = goalSection.match(
    /^You are (?:a |an )?[^.]+\.\s*/i
  );
  if (rolePrefixMatch) {
    goalSection = goalSection.slice(rolePrefixMatch[0].length).trim();
  }

  goal = goalSection;

  return { goal, constraints, approach };
}

function parseMarkdownHeaders(text: string): StructuredPromptFields | null {
  const goalMatch = text.match(/##\s*Goal\s*\n/i);
  const constraintsMatch = text.match(/##\s*Constraints\s*\n/i);
  const approachMatch = text.match(/##\s*Approach\s*\n/i);

  // Need at least two markdown section headers to consider it structured
  const matchCount = [goalMatch, constraintsMatch, approachMatch].filter(Boolean).length;
  if (matchCount < 2) return null;

  // Build ordered list of section boundaries
  const sections: { key: string; start: number; headerEnd: number }[] = [];
  if (goalMatch) {
    const idx = text.indexOf(goalMatch[0]);
    sections.push({ key: "goal", start: idx, headerEnd: idx + goalMatch[0].length });
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

  return { goal: fields.goal, constraints: fields.constraints, approach: fields.approach };
}

export function isStructuredPrompt(prompt: string): boolean {
  return parsePromptToFields(prompt) !== null;
}
