/**
 * The one-line "what skills does this agent carry" summary shown on agent
 * cards, the profile pop-up and (with a different lead-in) step details.
 * Pure label logic, kept out of the component so it can be tested.
 */

export interface SkillLineLabel {
  /** "1 skill:" or "3 skills:" */
  lead: string;
  /** "a, b, c" */
  names: string;
}

/** null when there are no skills (callers show a muted "No skills"). */
export function skillLineLabel(names: readonly string[]): SkillLineLabel | null {
  if (names.length === 0) return null;
  return {
    lead: `${names.length} ${names.length === 1 ? "skill" : "skills"}:`,
    names: names.join(", "),
  };
}

/** "Gets 1 skill with this step:" / "Gets 2 skills with this step:" */
export function stepSkillsLead(count: number): string {
  return `Gets ${count} ${count === 1 ? "skill" : "skills"} with this step:`;
}
