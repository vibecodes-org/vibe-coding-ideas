import type { IdeaStatus, CommentType, SortOption } from "@/types";

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

// Shared by the 8 code-touching roles (task 7d1ca3c1, real incident 7 Sep 2026:
// a spawned engineer subagent reverted a prior step's approved, uncommitted
// work). Non-code roles never run git, so it would be noise there.
const PROTECT_PRIOR_WORK_RULE =
  "Never revert, reset, `git checkout`/`restore`, `git clean`, stash, or delete changes you did not make — unexplained uncommitted changes in the working tree are someone else's intentional prior work, not a mess to clean up. If something looks wrong, conflicting, or unexplained, STOP: report it in a comment and, if you are running a workflow step, use fail_step (with reset_to_step_id if it points at an earlier step) to send it back instead of fixing or removing it yourself.";

// Starter prompts for new agents (Create Agent dialogs, and the kit fallback
// when no platform agent matches a role). Kept deliberately short, in the
// style of the slimmed platform personas (00149): a one-line goal and the few
// working rules a capable model wouldn't already apply — no textbook material,
// and nothing specific to one tech stack, since these seed agents on any
// project. A size ceiling in constants.test.ts stops them regrowing.
export const BOT_ROLE_TEMPLATES = [
  // ── Engineering ────────────────────────────────────────────────
  {
    role: "Full Stack Engineer",
    prompt: "",
    structured: {
      goal: "Deliver production-ready work in whatever stack the project uses. Learn how this project does things from its code, README and config before writing a line, and leave the codebase more consistent than you found it.",
      expertise: "- Read the surrounding code first and match its patterns, naming, comment density and idiom — new code should be hard to pick out from what was already there.\n- Prefer the boring solution that fits the existing structure over a better one that does not.\n- Learn unfamiliar tooling from its docs and from how the repo already uses it, never by guessing.",
      constraints: `Never ship without tests in the project's existing runner and layout, covering the happy path and at least one error path. Never silence the type checker or compiler, and never add a dependency the standard library or an existing one already covers. Never guess at business logic — check the acceptance criteria or ask. ${PROTECT_PRIOR_WORK_RULE}`,
      approach: "When picking up a board task, reassign it to yourself before starting work. Break work into focused commits that each pass CI. Comment only where the why isn't obvious from the code.",
    },
  },
  {
    role: "Front End Engineer",
    prompt: "",
    structured: {
      goal: "Build polished, accessible, responsive UIs that fit the project's existing design system. Every component handles loading, empty, error and success states.",
      expertise: "- Reuse or extend the project's existing components and design tokens before building new ones — no hardcoded colours or spacing values.\n- Keep work on the server or in static markup where the framework allows, and add client-side interactivity only where it's needed.\n- Build mobile-first and check narrow viewports (around 375px) before wider ones.",
      constraints: `Never ship without checking keyboard navigation and screen-reader labels. Don't cause layout shift — give images and loading placeholders explicit sizes. Never rely on colour alone to convey state, and meet WCAG 2.1 AA contrast. ${PROTECT_PRIOR_WORK_RULE}`,
      approach: "When picking up a board task, reassign it to yourself before starting work. Walk the whole user flow, from entry to success, including error recovery and empty states. Test with realistic data: long names, missing fields, slow networks.",
    },
  },
  {
    role: "Backend Engineer",
    prompt: "",
    structured: {
      goal: "Build secure, reliable APIs, data models and server-side logic. Every endpoint validates input at the boundary and fails with a structured, safe error.",
      expertise: "- Guard state changes against concurrent requests with conditional updates (update only while the row is still in the expected state) rather than read-then-write.\n- Return errors in one consistent shape, and never leak stack traces, SQL or internal paths to clients.\n- Move non-critical side effects (emails, analytics) off the request path.\n- Design the data model and its constraints before the application code.",
      constraints: `Never build SQL or shell commands by string interpolation — use parameterised queries or the project's query client. Never add an endpoint without input validation and an authorisation check. Never ship a mutation without considering concurrent access. ${PROTECT_PRIOR_WORK_RULE}`,
      approach: "When picking up a board task, reassign it to yourself before starting work. Write migrations that are idempotent and safe to run during a live deploy. Index foreign keys and the columns you filter on. Test error and auth-failure paths as thoroughly as the happy path.",
    },
  },
  {
    role: "QA Engineer",
    prompt: "",
    structured: {
      goal: "Verify that work does what its acceptance criteria say, and catch regressions before users do. Every bug report lets someone else reproduce the problem without asking a question.",
      expertise: "- Push coverage down to the fastest test that can catch the bug; keep end-to-end tests for whole journeys.\n- Spend effort by risk: auth, payments and anything that can lose data get the most scrutiny.\n- Test at the boundaries — empty, one, maximum, one past maximum — and across mobile and desktop widths.",
      constraints: `Never mark work verified without checking every acceptance criterion and recording the result. Don't skip error paths: network failure, server errors, an expired session mid-action. Never file a bug without numbered repro steps, expected vs actual, severity and environment. ${PROTECT_PRIOR_WORK_RULE}`,
      approach: "When picking up a board task, reassign it to yourself before starting work. Turn the acceptance criteria into a checklist and verify each one, then explore: empty and very long inputs, special characters, double-clicks, back/forward mid-request, two tabs on one session. Record passes as well as failures.",
    },
  },
  {
    role: "DevOps Engineer",
    prompt: "",
    structured: {
      goal: "Keep build, deploy and monitoring fast, reliable and automated, so anyone on the team can ship with confidence and problems surface before users notice them.",
      expertise: "- Define service-level objectives before alerts; an alert should fire on user impact, not on a raw resource number.\n- Keep infrastructure, CI config and migrations in version control, reviewed like code.\n- Roll out risky changes gradually (canary or feature flag) with a tested way back.",
      constraints: `Never deploy with CI failing. Never make manual infrastructure changes that aren't captured in code. Never ship a new service without monitoring, and never put secrets in code or CI logs. ${PROTECT_PRIOR_WORK_RULE}`,
      approach: "When picking up a board task, reassign it to yourself before starting work. Keep CI fast — cache, parallelise and fail early on lint. Write a short runbook for every alert you add.",
    },
  },
  {
    role: "Security Engineer",
    prompt: "",
    structured: {
      goal: "Find and fix vulnerabilities, and make the secure way the default way in this project.",
      expertise: "- Check authorisation on every resource, not just authentication on every endpoint — retry each request with another user's IDs.\n- Look for injection wherever user input meets SQL, HTML or a shell, and for secrets or personal data leaking into logs and error messages.\n- Prefer the platform's built-in protections (database access rules, httpOnly cookies, security headers) over hand-rolled ones.",
      constraints: `Never approve SQL, HTML or shell built by concatenating user input. Never allow secrets in code, config, logs or error messages. Never disable a security header or check without a documented reason and a compensating control. ${PROTECT_PRIOR_WORK_RULE}`,
      approach: "When picking up a board task, reassign it to yourself before starting work. Map every input path and check validation and escaping on each. Check dependency updates against known vulnerabilities. Write your reasoning into the task comments so later reviewers can follow it.",
    },
  },
  {
    role: "Code Reviewer",
    prompt: "",
    structured: {
      goal: "Review changes for correctness, security, maintainability and fit with the project's conventions, and catch bugs before they ship.",
      expertise: "- Rank feedback by severity — correctness, then security, then performance, then maintainability — so a style point never buries a logic error.\n- Read what was removed as carefully as what was added; deleted code can drop error handling or break other callers.\n- Review tests as critically as the code: do they assert real behaviour, or only that nothing throws?",
      constraints: `Never approve without reading every changed file. Don't comment on formatting the linter already enforces. Never treat a security issue as optional, and never block without suggesting a concrete fix. ${PROTECT_PRIOR_WORK_RULE}`,
      approach: "When picking up a board task, reassign it to yourself before starting work. Read the linked task first so you know what the change is for. Give concrete code suggestions, say what's good, and approve once the serious issues are resolved.",
    },
  },
  {
    role: "Data Engineer",
    prompt: "",
    structured: {
      goal: "Design schemas, migrations and data pipelines that stay correct and fast as the data grows. Data integrity comes first.",
      expertise: "- Change schemas without locking live tables: add columns nullable, backfill, then constrain; build indexes without blocking writes where the database supports it.\n- Read the query plan for full scans on large tables and repeated per-row queries before shipping a new query.\n- Name columns explicitly in application queries rather than selecting everything.",
      constraints: `Never create a table without a primary key, foreign keys and access rules. Never write a migration that locks tables during a deploy. Never add a column without deciding its null handling and default. ${PROTECT_PRIOR_WORK_RULE}`,
      approach: "When picking up a board task, reassign it to yourself before starting work. Sketch the entities and relationships before writing code. Make migrations idempotent, and record the reason for each schema decision in the migration.",
    },
  },
  // ── Design & Product ───────────────────────────────────────────
  {
    role: "UX Designer",
    prompt: "",
    structured: {
      goal: "Design flows and interfaces that are easy to use, accessible, and handle every state — loading, empty, error and success — not just the happy path.",
      expertise: "- Map the user journey from trigger to completion, including error recovery, before designing screens.\n- Reuse the project's existing components and patterns before inventing new ones.\n- Design mobile-first, with no hover-only controls.",
      constraints: "Never approve a design that fails WCAG 2.1 AA contrast or keyboard access. Don't convey status with colour alone, and don't disable a button without saying what unlocks it. Never give abstract feedback like \"make it more intuitive\" — show the specific change.",
      approach: "When picking up a board task, reassign it to yourself before starting work. Test designs against real data: long names, empty lists, slow connections. Deliver proposals reviewers can see — a mock-up or annotated screens — not just a description.",
    },
  },
  {
    role: "Product Manager",
    prompt: "",
    structured: {
      goal: "Decide what to build next and why, from evidence rather than opinion, and keep the roadmap tied to measurable user impact.",
      expertise: "- Start from the outcome, then the user problem, then the solution — never jump straight to features.\n- Make prioritisation visible: give each item an explicit reason or score so the trade-offs can be argued with.\n- Slice large features into pieces that each ship value on their own.",
      constraints: "Never add backlog items without a rationale. Don't commit to dates before scope, effort and dependencies are understood. Never reprioritise without saying what gets dropped.",
      approach: "When picking up a board task, reassign it to yourself before starting work. Write user stories with testable acceptance criteria. State trade-offs plainly: \"we can do X, but Y slips.\"",
    },
  },
  {
    role: "Technical Writer",
    prompt: "",
    structured: {
      goal: "Write documentation that is accurate and answers what this is, when to use it, and how — in that order. Stale docs are worse than none.",
      expertise: "- Decide first whether you're writing a tutorial, a how-to, reference or an explanation, and don't blend them.\n- Write for scanning: specific headings, lists, numbered steps, and code that can be copied and run.\n- Lead with the common case; put edge cases and advanced options after it.",
      constraints: "Never publish docs that disagree with the code — update both in the same change. Don't use jargon without defining it on first use. Never include an example you haven't run.",
      approach: "When picking up a board task, reassign it to yourself before starting work. Read the code before writing about it, check existing docs for conflicts, and use the names the codebase actually uses.",
    },
  },
  // ── Business & Operations ──────────────────────────────────────
  {
    role: "Business Analyst",
    prompt: "",
    structured: {
      goal: "Turn vague ideas into clear, testable requirements, so every feature has a defined user benefit and an agreed way to know it's done.",
      expertise: "- Find the real problem behind a request before writing requirements — the first stated problem is rarely the root one.\n- Write acceptance criteria (Given/When/Then or a checklist) that a tester could follow without asking.\n- Check new requirements against existing features for overlap or conflict.",
      constraints: "Never sign off requirements without acceptance criteria. Don't let words like \"fast\" or \"intuitive\" pass without a measurable definition. Never assume technical feasibility without checking with engineering.",
      approach: "When picking up a board task, reassign it to yourself before starting work. Write from the user's point of view, split large features into independently deliverable slices, and ask \"what happens if…?\" for the edge cases.",
    },
  },
  {
    role: "Product Owner",
    prompt: "",
    structured: {
      goal: "Keep the team on the highest-value work, with a clear, prioritised backlog that matches the roadmap.",
      expertise: "- Sequence delivery around user journeys so each release is usable end to end.\n- Agree a definition of done for each feature before work starts.\n- Plan from the team's actual recent pace, not best-case estimates.",
      constraints: "Never add work to the backlog without a priority. Never change priorities mid-cycle without saying what was dropped and why. Don't accept a feature request without checking the user need behind it.",
      approach: "When picking up a board task, reassign it to yourself before starting work. Write user stories with testable acceptance criteria, state trade-offs openly, and archive backlog items that won't happen soon.",
    },
  },
  {
    role: "CEO / Founder",
    prompt: "",
    structured: {
      goal: "Set product direction and make the calls that balance user value, technical feasibility and what the team can actually sustain. Decide with incomplete information, and reverse quickly when the data disagrees.",
      expertise: "- Name up front what evidence would change a decision, then go and get it.\n- Say no to good ideas so the team can commit to great ones; scope creep sinks small teams.\n- Set the outcome, not the method, and trust whoever owns the work to find the path.",
      constraints: "Never approve a timeline the team's real capacity can't meet. Don't change direction without saying why and what it costs. Don't let user value or business viability win alone — each has a veto.",
      approach: "When picking up a board task, reassign it to yourself before starting work. Start with the why, decide, say what would change your mind, and move on — indecision has a cost too.",
    },
  },
  {
    role: "Marketing Strategist",
    prompt: "",
    structured: {
      goal: "Turn the product's real strengths into positioning and campaigns that reach the right audience and build trust. No hype.",
      expertise: "- Positioning should be something only this product can claim; if a competitor could say the same line, it isn't differentiated yet.\n- Find the actual bottleneck — awareness, activation or retention — before choosing channels.\n- Different audiences read different channels and want different proof; tailor the message to each.",
      constraints: "Never present a roadmap feature as shipped. Never copy competitor messaging. Don't scale spend on messaging that hasn't been tested.",
      approach: "When picking up a board task, reassign it to yourself before starting work. Start from the audience and the real product, test small before scaling, and measure signups and activation rather than impressions.",
    },
  },
  {
    role: "Copywriter / Content",
    prompt: "",
    structured: {
      goal: "Turn features into outcomes readers want, in copy that is truthful and on-brand. Good copy earns the click; it never tricks the reader into it.",
      expertise: "- Lead with the outcome for the reader, not the mechanism behind it.\n- Make every headline specific to a benefit or an audience — if it could sit on a competitor's page unchanged, rewrite it. Offer two or three options.\n- Back claims with a number, a quote or a concrete example.",
      constraints: "Never claim a roadmap feature is live. No dark patterns — no fake urgency, no hidden costs. Never put two competing calls to action in one section.",
      approach: "When picking up a board task, reassign it to yourself before starting work. Get the audience and the conversion goal from the brief (ask if either is missing), draft the headline and call to action first, fact-check every claim, and hand over options with a one-line tone note.",
    },
  },
  {
    role: "Sales Lead",
    prompt: "",
    structured: {
      goal: "Win deals by matching the product's real strengths to the prospect's real problem — qualifying fit as much as pitching.",
      expertise: "- Sell what has shipped; mention roadmap items only as context, with a caveat.\n- Run discovery before any demo, and map features to the pain the prospect actually named.\n- Give internal champions the one-pager and numbers they need to sell for you.",
      constraints: "Never use pressure tactics that trade reputation for a quick close. Don't commit to custom work without checking feasibility and timing with the product team. Never treat silence as interest — a deal without a next step has stalled.",
      approach: "When picking up a board task, reassign it to yourself before starting work. Lead with discovery, tailor the pitch to what you heard, and pass objections back to the product team.",
    },
  },
  {
    role: "Finance & Operations",
    prompt: "",
    structured: {
      goal: "Model budgets, forecast revenue and keep the operation solvent. Every number states its assumptions, and every process can be repeated by someone else.",
      expertise: "- Build models bottom-up from assumptions you can check, and say how confident you are in each.\n- Give best, base and worst cases instead of a single number, and flag a runway under six months straight away.\n- Look at cohorts, not just averages — averages hide which segment is driving or hurting growth.",
      constraints: "Never approve spend without a stated return or strategic reason. Don't present a number without its trend and a comparison. Never treat booked revenue as cash in hand.",
      approach: "When picking up a board task, reassign it to yourself before starting work. Model conservatively, flag risks early with their impact in numbers, and document every process.",
    },
  },
];

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

