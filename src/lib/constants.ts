import type { IdeaStatus, CommentType, SortOption } from "@/types";
import type { AgentInstructions } from "@/lib/agent-instructions";
import { PLATFORM_AGENTS } from "@/lib/platform-agents";
import type { ToolAccess } from "@/lib/agent-tool-access";

export const VIBECODES_USER_ID = "a0000000-0000-4000-a000-000000000001";

// ─── Per-step model tiering (P2 / P2b) ───
// Mandatory hint on workflow steps naming which Claude model runs a step's
// subagent. Auto = null (absent) = orchestrator decides — never stored as a
// literal "auto". P2b (mcp-server/src/tools/workflows.ts) turns a set tier
// into a MANDATORY MODEL directive at claim time, resolved through the
// platform-default map plus a per-user override (users.model_tier_map).

export type ModelTierValue = "frontier" | "standard" | "cheap";

/** Task-tool `model` parameter aliases a tier can resolve to. */
export const MODEL_ALIASES = ["fable", "opus", "sonnet", "haiku"] as const;
export type ModelAlias = (typeof MODEL_ALIASES)[number];

/** Per-user override map (users.model_tier_map). Partial — unset tiers use the platform default. */
export type ModelTierMap = Partial<Record<ModelTierValue, string>>;

/** Selectable tiers with their labels (fixed order = cost gradient). */
export const MODEL_TIERS: { value: ModelTierValue; label: string }[] = [
  { value: "frontier", label: "Frontier" },
  { value: "standard", label: "Standard" },
  { value: "cheap", label: "Cheap" },
];

/** "When to use" tail of each tier's gloss (design §04). */
export const MODEL_TIER_WHEN_TO_USE: Record<ModelTierValue, string> = {
  frontier: "decisions & design",
  standard: "most build steps",
  cheap: "mechanical steps",
};

/**
 * Display name for the platform-default model of each tier. This is the
 * SEED / typed fallback ONLY — the live, admin-editable value lives in the
 * `platform_settings` table (key `model_tier_defaults`, see
 * src/lib/platform-model-defaults.ts + the admin "Platform" tab) and is read
 * per-request by getPlatformModelDefaults(). Every UI surface that displays a
 * tier's default model should thread the live value through
 * modelTierGloss/tierDefaultsToCopy/tierMismatchSentence's optional
 * `platformDefaultModel` argument (via usePlatformModelDefaults()) — this
 * constant is only the safe floor when that fetch hasn't resolved yet or the
 * platform_settings row is missing/invalid. Keep in sync with
 * SEED_PLATFORM_MODEL_DEFAULTS in platform-model-defaults.ts.
 */
export const MODEL_TIER_PLATFORM_DEFAULT_MODEL: Record<ModelTierValue, string> = {
  frontier: "Opus",
  standard: "Sonnet",
  cheap: "Haiku",
};

/** Gloss shown for the Auto (null) default option. */
export const MODEL_TIER_AUTO_GLOSS = "Orchestrator picks the best model";

/** Set of valid stored tier values (excludes Auto/null). */
export const MODEL_TIER_VALUES: ReadonlySet<string> = new Set(
  MODEL_TIERS.map((t) => t.value),
);

/** Always-visible helper text shown beneath the tier control (P2b — mandatory, not advisory). */
export const MODEL_TIER_RUNS_ON_HELPER =
  "Steps run on the tier's mapped model — change your mapping in Profile → Model Tiers.";

/** Human label for a stored tier value; falls back to the raw value if unknown. */
export function modelTierLabel(tier: string): string {
  return MODEL_TIERS.find((t) => t.value === tier)?.label ?? tier;
}

/** Display-cased model alias, e.g. "sonnet" -> "Sonnet". Exported for P2c adherence copy (executed model names, which arrive as raw aliases). */
export function capitalizeModelName(model: string): string {
  return model.charAt(0).toUpperCase() + model.slice(1);
}

/**
 * "Runs on <model> · <when-to-use>" gloss for a tier option (design §04,
 * Design-Review CONDITION 3). `resolvedModel` MUST be the viewer's resolved
 * model for this tier (their model_tier_map override) — pass undefined/null
 * only while the viewer's map is loading/unknown, which falls back to the
 * platform default. Never hard-code a platform-wide constant here: a user
 * mapped frontier→opus must read "Runs on Opus", not the platform default.
 *
 * `platformDefaultModel` is the LIVE platform default's raw alias for this
 * tier (e.g. from usePlatformModelDefaults()) — pass it whenever available so
 * the "no override" case reflects the admin-configured setting, not the
 * seed constant. Omit only while that fetch hasn't resolved yet, which falls
 * back to MODEL_TIER_PLATFORM_DEFAULT_MODEL (the seed).
 */
export function modelTierGloss(
  tier: ModelTierValue,
  resolvedModel?: string | null,
  platformDefaultModel?: string
): string {
  const modelLabel = resolvedModel
    ? capitalizeModelName(resolvedModel)
    : platformDefaultModel
      ? capitalizeModelName(platformDefaultModel)
      : MODEL_TIER_PLATFORM_DEFAULT_MODEL[tier];
  return `Runs on ${modelLabel} · ${MODEL_TIER_WHEN_TO_USE[tier]}`;
}

// ─── P2c — tier adherence (self-reported telemetry) ───
// Records what model the orchestrator SAYS it ran a tiered step's subagent on
// (executed_model) and whether that honoured the step's directed tier
// (tier_honored) — never hard verification. Vocabulary is strictly
// reported / honored / not honored / not reported; never "verify(ied)" or
// "enforced" outside a negation. See docs/spikes/p2c-tier-adherence-design.html.

/**
 * The canonical disclosure sentence (design §01/§07) — reused verbatim on
 * every surface that shows adherence data: the step-detail dialog, the row
 * badge tooltip, the auto-posted mismatch comment, and the admin dashboard
 * card's caption.
 */
export const TIER_ADHERENCE_DISCLOSURE =
  "Self-reported by the orchestrator — VibeCodes records what the agent says it ran, and does not verify it.";

/**
 * "<Tier> defaults to <Model>" — the override-safe phrasing for tier→model
 * correspondence (Design-Review CONDITION 1). Never "maps to": a user's
 * model_tier_map override changes what a tier defaults to for them, and
 * adherence data is never re-resolved against that map after the fact — this
 * always names the stable platform default, which is what every surface
 * displays.
 *
 * `platformDefaultModel` is the LIVE platform default's raw alias for this
 * tier — pass it (via usePlatformModelDefaults()) so this reflects the
 * admin-configured setting rather than the seed constant. Omit only while
 * that fetch hasn't resolved, which falls back to the seed.
 *
 * Compliance-drift note (accepted MVP behaviour): adherence for an already
 * *completed* step is judged against whatever the platform default IS NOW,
 * not what it was at claim time — if a super-admin changes the default
 * between claim and complete, a step honored under the old default can read
 * as a mismatch (or vice versa) here. Documented, not fixed, in this pass.
 */
export function tierDefaultsToCopy(tier: string, platformDefaultModel?: string): string {
  const label = modelTierLabel(tier);
  const model = platformDefaultModel
    ? capitalizeModelName(platformDefaultModel)
    : MODEL_TIER_PLATFORM_DEFAULT_MODEL[tier as ModelTierValue] ?? tier;
  return `${label} defaults to ${model}`;
}

/**
 * Full mismatch sentence (tier not honored) + disclosure — shared verbatim by
 * the row badge's tooltip (model-tier-select.tsx) and the MCP auto-posted
 * step comment (mcp-server/src/tools/workflows.ts), so the wording never
 * drifts between the two surfaces (design §04/§07).
 *
 * `platformDefaultModel` is the LIVE platform default's raw alias for this
 * tier at the time of the call — the client passes usePlatformModelDefaults(),
 * the server (workflows.ts) passes the same platformDefaults it already
 * fetched to resolve the directive, so a mismatch comment never names a stale
 * default (see tierDefaultsToCopy's compliance-drift note above — this
 * sentence is generated at complete/fail time, always against the
 * then-current default).
 *
 * `agent` (Codex model-tier task, reviewer build condition) gates
 * capitalization: Claude aliases are family names ("Opus", "Sonnet") and
 * read naturally capitalized, but Codex model ids ("gpt-5.1-codex") are NOT
 * capitalized — title-casing a Codex model id would misrepresent it as a
 * proper-noun alias it isn't. Defaults to "claude" so every pre-existing
 * call site (all Claude-only today) is byte-identical.
 */
export function tierMismatchSentence(
  tier: string,
  executedModel: string,
  platformDefaultModel?: string,
  agent: "claude" | "codex" = "claude"
): string {
  const label = modelTierLabel(tier);
  const cased = agent === "codex" ? (s: string) => s : capitalizeModelName;
  const defaultModel = platformDefaultModel
    ? cased(platformDefaultModel)
    : agent === "codex"
      ? tier
      : (MODEL_TIER_PLATFORM_DEFAULT_MODEL[tier as ModelTierValue] ?? tier);
  return `Tier not honored — this ${label} step defaults to ${defaultModel}, but the orchestrator reported running on ${cased(executedModel)}. ${TIER_ADHERENCE_DISCLOSURE}`;
}

/**
 * One agent's resolved model + effort, for the resolution-line helpers below.
 * Deliberately structural (not imported from platform-model-defaults.ts) so
 * this module stays framework-agnostic and has no dependency on that file.
 */
export interface AgentResolvedEntry {
  model: string;
  effort: string;
}

/**
 * "<Tier> → <Claude model> (<effort>) on Claude · <codex model> (<effort>) on
 * Codex" — the recurring resolution line (Codex model-tier task FR-7 design,
 * docs/codex-model-tiers-ux-design.html §overview): shown under each tier row
 * in Profile → Model Tiers and the admin Platform card, and in the step tier
 * picker's helper text. Claude models keep their capitalised family-alias
 * casing (capitalizeModelName); Codex model ids are shown exactly as
 * configured — lowercase, as typed — same rule as tierMismatchSentence's
 * `agent` parameter.
 */
export function tierResolutionLine(
  tier: string,
  claude: AgentResolvedEntry,
  codex: AgentResolvedEntry
): string {
  const label = modelTierLabel(tier);
  return `${label} → ${capitalizeModelName(claude.model)} (${claude.effort}) on Claude · ${codex.model} (${codex.effort}) on Codex`;
}

/**
 * Default tier suggestion for a step's role (design §06). Tolerant of role-name
 * variants and case. Returns null for unknown/custom roles — never guess, let the
 * orchestrator decide. Shared by the library-seeding reference and any UI reuse.
 */
export function defaultTierForRole(role: string): ModelTierValue | null {
  const r = role?.trim().toLowerCase() ?? "";
  if (!r) return null;

  // QA / verification → standard (checked first: "QA Engineer" must not fall to build).
  // Deliberately NOT cheap. A QA step's output is a trusted verdict ("9/9 PASS,
  // verdict SHIP"), and the cheap tier was measured fabricating findings — in 4 of 4
  // runs on an identical audit it asserted an index was missing that demonstrably
  // exists, with invented timings attached, while the frontier tier got it right.
  // A fabricated PASS is worse than no QA step, because it removes the prompt for
  // anyone else to look. See task 890f5c57 / spike b471a2bd.
  if (/\bqa\b|quality assurance|\btest\b|tester|testing/.test(r)) return "standard";

  // Design / UX → frontier (before build, so "UX Designer" wins over "engineer")
  if (/\bux\b|\bui\b|designer|\bdesign\b/.test(r)) return "frontier";

  // Product / analysis / decision / review → frontier
  if (/\bproduct\b|\bowner\b|analyst|founder|\bceo\b|\bpm\b|\bba\b|review|approv|decision/.test(r))
    return "frontier";

  // Build engineers → standard
  if (/engineer|developer|\bdev\b|programmer|architect|full[\s-]?stack|front|back|coder/.test(r))
    return "standard";

  return null;
}

export const STATUS_CONFIG: Record<
  IdeaStatus,
  { label: string; color: string; bgColor: string }
> = {
  open: {
    label: "Open",
    color: "text-emerald-400",
    bgColor: "bg-emerald-400/10 border-emerald-400/20",
  },
  in_progress: {
    label: "In Progress",
    color: "text-blue-400",
    bgColor: "bg-blue-400/10 border-blue-400/20",
  },
  completed: {
    label: "Completed",
    color: "text-purple-400",
    bgColor: "bg-purple-400/10 border-purple-400/20",
  },
  archived: {
    label: "Archived",
    color: "text-zinc-400",
    bgColor: "bg-zinc-400/10 border-zinc-400/20",
  },
};

export const COMMENT_TYPE_CONFIG: Record<
  CommentType,
  { label: string; color: string; bgColor: string }
> = {
  comment: {
    label: "Comment",
    color: "text-zinc-400",
    bgColor: "bg-zinc-400/10 border-zinc-400/20",
  },
  suggestion: {
    label: "Suggestion",
    color: "text-amber-400",
    bgColor: "bg-amber-400/10 border-amber-400/20",
  },
  question: {
    label: "Question",
    color: "text-sky-400",
    bgColor: "bg-sky-400/10 border-sky-400/20",
  },
};

export const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "popular", label: "Most Popular" },
  { value: "discussed", label: "Most Discussed" },
];

export const DEFAULT_BOARD_COLUMNS = [
  { title: "Backlog", position: 0, is_done_column: false },
  { title: "To Do", position: 1000, is_done_column: false },
  { title: "Blocked/Requires User Input", position: 2000, is_done_column: false },
  { title: "In Progress", position: 3000, is_done_column: false },
  { title: "Verify", position: 4000, is_done_column: false },
  { title: "Done", position: 5000, is_done_column: true },
];

export const POSITION_GAP = 1000;

export const TEMPLATE_LABEL_SUGGESTIONS: { keywords: RegExp; label: string; color: string }[] = [
  { keywords: /\b(bug|fix|hotfix|patch)\b/i, label: "Bug", color: "red" },
  { keywords: /\b(feature|feat)\b/i, label: "Feature", color: "violet" },
  { keywords: /\b(spike|research|investigation|explore)\b/i, label: "Research", color: "cyan" },
  { keywords: /\b(design|ux|ui)\b/i, label: "Design", color: "pink" },
  { keywords: /\b(launch|release|deploy)\b/i, label: "Launch", color: "orange" },
  { keywords: /\b(infra|infrastructure|devops|ci|cd)\b/i, label: "Infrastructure", color: "amber" },
  { keywords: /\b(client|customer)\b/i, label: "Client", color: "blue" },
];

export const LABEL_COLORS = [
  { value: "red", label: "Red", badgeClass: "bg-red-500/90 text-white", swatchColor: "bg-red-500" },
  { value: "orange", label: "Orange", badgeClass: "bg-orange-500/90 text-white", swatchColor: "bg-orange-500" },
  { value: "amber", label: "Amber", badgeClass: "bg-amber-500/90 text-white", swatchColor: "bg-amber-500" },
  { value: "lime", label: "Lime", badgeClass: "bg-lime-500/90 text-white", swatchColor: "bg-lime-500" },
  { value: "emerald", label: "Emerald", badgeClass: "bg-emerald-500/90 text-white", swatchColor: "bg-emerald-500" },
  { value: "cyan", label: "Cyan", badgeClass: "bg-cyan-500/90 text-white", swatchColor: "bg-cyan-500" },
  { value: "blue", label: "Blue", badgeClass: "bg-blue-500/90 text-white", swatchColor: "bg-blue-500" },
  { value: "violet", label: "Violet", badgeClass: "bg-violet-500/90 text-white", swatchColor: "bg-violet-500" },
  { value: "pink", label: "Pink", badgeClass: "bg-pink-500/90 text-white", swatchColor: "bg-pink-500" },
  { value: "zinc", label: "Gray", badgeClass: "bg-zinc-500/90 text-white", swatchColor: "bg-zinc-500" },
];

export const ACTIVITY_ACTIONS: Record<string, { label: string; icon: string }> = {
  created: { label: "created this task", icon: "Plus" },
  moved: { label: "moved this task", icon: "ArrowRight" },
  assigned: { label: "assigned", icon: "UserPlus" },
  unassigned: { label: "unassigned", icon: "UserMinus" },
  due_date_set: { label: "set the due date", icon: "CalendarDays" },
  due_date_removed: { label: "removed the due date", icon: "CalendarX" },
  label_added: { label: "added a label", icon: "Tag" },
  label_removed: { label: "removed a label", icon: "TagX" },
  archived: { label: "archived this task", icon: "Archive" },
  unarchived: { label: "unarchived this task", icon: "ArchiveRestore" },
  converted_to_discussion: { label: "converted this task to a conversation", icon: "MessagesSquare" },
  title_changed: { label: "changed the title", icon: "Pencil" },
  description_changed: { label: "updated the description", icon: "FileText" },
  checklist_item_added: { label: "added a workflow step", icon: "ListPlus" },
  checklist_item_completed: { label: "completed a workflow step", icon: "CheckSquare" },
  comment_added: { label: "added a comment", icon: "MessageSquare" },
  attachment_added: { label: "added an attachment", icon: "Paperclip" },
  attachment_removed: { label: "removed an attachment", icon: "Trash2" },
  bulk_imported: { label: "imported this task", icon: "Upload" },
  ai_generated: { label: "generated this task with AI", icon: "Sparkles" },
};

export type BotRoleTemplate = {
  role: string;
  fields: AgentInstructions;
  toolAccess: ToolAccess;
};

/**
 * Starting templates for new agents (Create Agent dialogs, and the kit
 * fallback when no platform agent matches a role): the five platform agents,
 * word for word (task 472d5672, stage 3). One text per agent, so a copy made
 * from the platform row, the chip or a kit reads the same. Code Reviewer is the
 * only Read-only one: checkers can't edit.
 */
export const BOT_ROLE_TEMPLATES: BotRoleTemplate[] = PLATFORM_AGENTS.map(
  (a): BotRoleTemplate => ({ role: a.role, fields: { ...a.instructions }, toolAccess: a.toolAccess })
);

/** The chips on the create-agent screens: one row, one chip per template. */
export const ROLE_TEMPLATE_CHIPS: { role: string; icon: string; group: "primary" | "more" }[] =
  PLATFORM_AGENTS.map((a) => ({ role: a.role, icon: a.chipIcon, group: "primary" }));

export const SUGGESTED_SKILLS = [
  "code-review",
  "testing",
  "debugging",
  "architecture",
  "ui-design",
  "api-design",
  "documentation",
  "security",
  "performance",
  "accessibility",
  "database",
  "devops",
  "refactoring",
  "planning",
  "requirements",
];

export const MCP_COMMAND = "claude mcp add -s user --transport http vibecodes https://vibecodes.co.uk/api/mcp";

export const CLAUDE_CODE_INSTALL_COMMAND = "npm install -g @anthropic-ai/claude-code";

export const MCP_SUGGESTED_PROMPT = "Check my VibeCodes board and start working on the top priority task";

export const MCP_GUIDE_URL = "/guide/mcp-integration";

export const SUGGESTED_TAGS = [
  "ai",
  "web",
  "mobile",
  "cli",
  "api",
  "game",
  "devtools",
  "saas",
  "open-source",
  "automation",
  "blockchain",
  "data",
  "design",
  "education",
  "social",
];

