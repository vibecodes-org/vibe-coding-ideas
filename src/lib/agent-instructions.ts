// The agent instructions layout (task 472d5672, stage 1).
//
// Anthropic's guidance defines an agent by its job: one line of role, the
// specific work, what it returns, what it must not touch. The editor used to
// ask for Goal / Expertise / Constraints / Approach; it now asks for the four
// boxes below, and the stored text (bot_profiles.system_prompt) is one block
// with plain headings:
//
//   <one line>
//
//   ## Your job
//   ## What to hand back
//   ## What not to do
//   ## Notes from the old format      (only where old Expertise was kept)
//
// This module is the single place that writes, reads and converts that text.
// The editor, the agent pages, the starting templates and the one-off
// conversion script all go through it, so they cannot disagree.

import { parsePromptToFields, type StructuredPromptFields } from "./prompt-builder";

export interface AgentInstructions {
  oneLine: string;
  job: string;
  handBack: string;
  mustNot: string;
  /** Old "Expertise" text, kept until the owner clears it. */
  leftover: string;
}

export const EMPTY_INSTRUCTIONS: AgentInstructions = {
  oneLine: "",
  job: "",
  handBack: "",
  mustNot: "",
  leftover: "",
};

export const INSTRUCTION_LIMITS = {
  oneLine: 300,
  job: 6000,
  handBack: 1500,
  mustNot: 2000,
  raw: 10000,
} as const;

export const HEADINGS = {
  job: "Your job",
  handBack: "What to hand back",
  mustNot: "What not to do",
  leftover: "Notes from the old format",
} as const;

type SectionKey = keyof typeof HEADINGS;

const SECTION_ORDER: SectionKey[] = ["job", "handBack", "mustNot", "leftover"];

/** A new-layout heading line: `#` to `###`, any case, optional trailing colon. */
const HEADING_LINE = /^#{1,3}[ \t]*(your job|what to hand back|what not to do|notes from the old format)[ \t]*:?[ \t]*$/gim;

function keyForHeading(label: string): SectionKey {
  const l = label.toLowerCase();
  return SECTION_ORDER.find((k) => HEADINGS[k].toLowerCase() === l) ?? "job";
}

/** Write the canonical text. Empty sections leave no heading. */
export function generateInstructions(f: AgentInstructions): string {
  const parts: string[] = [];
  if (f.oneLine.trim()) parts.push(f.oneLine.trim());
  for (const key of SECTION_ORDER) {
    const body = f[key].trim();
    if (body) parts.push(`## ${HEADINGS[key]}\n${body}`);
  }
  return parts.join("\n\n");
}

export type InstructionsSource = "new" | "legacy";

export interface ParsedInstructions {
  fields: AgentInstructions;
  source: InstructionsSource;
}

function parseNewLayout(text: string): AgentInstructions | null {
  const matches = [...text.matchAll(HEADING_LINE)];
  if (matches.length === 0) return null;

  const fields: AgentInstructions = { ...EMPTY_INSTRUCTIONS };
  fields.oneLine = text.slice(0, matches[0].index).trim();
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const start = (m.index ?? 0) + m[0].length;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? text.length) : text.length;
    const key = keyForHeading(m[1]);
    const body = text.slice(start, end).trim();
    // A repeated heading appends rather than overwrites, so no text is lost.
    fields[key] = fields[key] ? `${fields[key]}\n\n${body}` : body;
  }
  return fields;
}

/** First sentence of a goal: ends at . ! or ? followed by a capital, a digit, a quote or the end. */
function splitFirstSentence(goal: string): { first: string; rest: string } {
  const text = goal.trim();
  const m = text.match(/^[\s\S]*?[.!?](?=\s+[A-Z0-9"'(`\-*]|\s*$)/);
  if (!m) return { first: text, rest: "" };
  return { first: m[0].trim(), rest: text.slice(m[0].length).trim() };
}

/**
 * Old layout to new: Goal's first sentence is the one line; the rest of Goal,
 * then Approach, is the job; Constraints is what not to do; Expertise is kept
 * as the leftover. Wording is unchanged. A first sentence too long for the one
 * line box stays whole in the job instead.
 */
export function convertLegacy(legacy: StructuredPromptFields): AgentInstructions {
  const { first, rest } = splitFirstSentence(legacy.goal);
  const fitsOneLine = first.length > 0 && first.length <= INSTRUCTION_LIMITS.oneLine;
  const oneLine = fitsOneLine ? first.replace(/\s+/g, " ") : "";
  const goalForJob = fitsOneLine ? rest : legacy.goal.trim();
  return {
    oneLine,
    job: [goalForJob, legacy.approach.trim()].filter(Boolean).join("\n\n"),
    handBack: "",
    mustNot: legacy.constraints.trim(),
    leftover: (legacy.expertise ?? "").trim(),
  };
}

/** A single short line with no line breaks counts as a one-line-only agent. */
function isOneLineOnly(text: string): boolean {
  return text.length <= INSTRUCTION_LIMITS.oneLine && !/\n/.test(text);
}

/**
 * Read stored text into the four boxes. `role` is the agent's own role: an old
 * "You are a <role>." opening is dropped only when it matches it exactly.
 * Returns null for text that fits neither layout (the editor then opens in
 * "Write it yourself" and leaves the text alone).
 */
export function parseInstructions(text: string, role?: string | null): ParsedInstructions | null {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return null;

  const fresh = parseNewLayout(trimmed);
  if (fresh) return { fields: fresh, source: "new" };

  const legacy = parsePromptToFields(trimmed, { role: role ?? null });
  if (legacy) return { fields: convertLegacy(legacy), source: "legacy" };

  if (isOneLineOnly(trimmed)) {
    return { fields: { ...EMPTY_INSTRUCTIONS, oneLine: trimmed }, source: "new" };
  }
  return null;
}

/** Text that fits neither layout, moved into Guided: all of it goes into "Its job". */
export function toGuidedFallback(text: string): AgentInstructions {
  return { ...EMPTY_INSTRUCTIONS, job: text.trim() };
}

export type InstructionsLayout = "empty" | "new" | "legacy" | "neither";

export function layoutOf(text: string | null | undefined, role?: string | null): InstructionsLayout {
  if (!text || !text.trim()) return "empty";
  const parsed = parseInstructions(text, role);
  return parsed ? parsed.source : "neither";
}

export interface ConversionResult {
  fields: AgentInstructions;
  text: string;
}

/** Convert one old-layout text. Null when the text is not old-layout (already new, neither, or empty). */
export function convertLegacyText(text: string, role?: string | null): ConversionResult | null {
  const parsed = parseInstructions(text, role);
  if (!parsed || parsed.source !== "legacy") return null;
  return { fields: parsed.fields, text: generateInstructions(parsed.fields) };
}

const OLD_MARKERS = ["Domain expertise:", "You must not:", "Your approach:"];

function words(text: string): string[] {
  return text.toLowerCase().split(/\s+/).filter(Boolean);
}

/** Remove what a conversion is allowed to change: old markers/headings and an exact own-role opening. */
function stripAllowedOld(text: string, role: string | null | undefined): string {
  let out = text.replace(/^##[ \t]*(goal|expertise|constraints|approach)[ \t]*$/gim, " ");
  for (const marker of OLD_MARKERS) out = out.replace(marker, " ");
  // The prefix is removed wherever it sits at the start of a paragraph.
  const r = role?.trim();
  if (r) {
    const escaped = r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`(^|\\n)[ \\t]*You are (?:a |an )?${escaped}\\.`, "i"), "$1 ");
  }
  return out;
}

function stripNewHeadings(text: string): string {
  return text.replace(HEADING_LINE, " ");
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

/**
 * The three checks every converted row must pass (Nick's change 1):
 *  1. the new text parses as the new layout;
 *  2. the parsed fields equal the converted fields (generate/parse round trip);
 *  3. no words are lost.
 * A failing row is reported and left untouched, never written.
 */
export function verifyConversion(
  oldText: string,
  conversion: ConversionResult,
  role?: string | null,
): VerifyResult {
  const reparsed = parseInstructions(conversion.text, role);
  if (!reparsed || reparsed.source !== "new") {
    return { ok: false, reason: "new text does not parse as the new layout" };
  }
  const a = reparsed.fields;
  const b = conversion.fields;
  const same = (Object.keys(EMPTY_INSTRUCTIONS) as (keyof AgentInstructions)[]).every(
    (k) => a[k].trim().replace(/\s+/g, " ") === b[k].trim().replace(/\s+/g, " "),
  );
  if (!same) return { ok: false, reason: "parsed fields differ from converted fields" };

  const kept = new Map<string, number>();
  for (const w of words(stripNewHeadings(conversion.text))) kept.set(w, (kept.get(w) ?? 0) + 1);
  let lost = 0;
  for (const w of words(stripAllowedOld(oldText, role))) {
    const n = kept.get(w) ?? 0;
    if (n === 0) lost += 1;
    else kept.set(w, n - 1);
  }
  if (lost > 0) return { ok: false, reason: `${lost} word(s) lost in conversion` };
  return { ok: true };
}
