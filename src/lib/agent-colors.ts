/**
 * Role-based color mapping for agent avatars and badges.
 * Matches the mockup design: each role category gets a distinct
 * glow color applied to the avatar fallback and role badge.
 */

export interface RoleColorScheme {
  /** Avatar fallback background, e.g. "bg-violet-500/15" */
  avatarBg: string;
  /** Avatar fallback text, e.g. "text-violet-400" */
  avatarText: string;
  /** Badge background + text, e.g. "bg-violet-500/15 text-violet-400" */
  badge: string;
}

const VIOLET: RoleColorScheme = {
  avatarBg: "bg-violet-500/15",
  avatarText: "text-violet-400",
  badge: "bg-violet-500/15 text-violet-400",
};

const PINK: RoleColorScheme = {
  avatarBg: "bg-pink-500/15",
  avatarText: "text-pink-500",
  badge: "bg-pink-500/15 text-pink-500",
};

const BLUE: RoleColorScheme = {
  avatarBg: "bg-blue-500/15",
  avatarText: "text-blue-500",
  badge: "bg-blue-500/15 text-blue-500",
};

const GREEN: RoleColorScheme = {
  avatarBg: "bg-emerald-500/15",
  avatarText: "text-emerald-500",
  badge: "bg-emerald-500/15 text-emerald-500",
};

const AMBER: RoleColorScheme = {
  avatarBg: "bg-amber-500/15",
  avatarText: "text-amber-500",
  badge: "bg-amber-500/15 text-amber-500",
};

const CYAN: RoleColorScheme = {
  avatarBg: "bg-cyan-500/15",
  avatarText: "text-cyan-500",
  badge: "bg-cyan-500/15 text-cyan-500",
};

const RED: RoleColorScheme = {
  avatarBg: "bg-red-500/15",
  avatarText: "text-red-400",
  badge: "bg-red-500/15 text-red-400",
};

/**
 * Maps an agent role string to a color scheme.
 * Uses keyword matching so custom user-created roles also get sensible colors.
 */
export function getRoleColor(role: string | null | undefined): RoleColorScheme {
  const r = (role ?? "").toLowerCase();

  // Frontend / UI / UX / Design
  if (/front|ui\b|ux\b|design|css/.test(r)) return PINK;

  // QA / Testing
  if (/qa\b|test|quality/.test(r)) return GREEN;

  // Security
  if (/secur|audit/.test(r)) return RED;

  // DevOps / Infrastructure
  if (/devops|infra|ops\b|pipeline|deploy|sre\b/.test(r)) return AMBER;

  // Data / Database
  if (/data|database|analyt/.test(r)) return CYAN;

  // Backend / API
  if (/back|api\b|server/.test(r)) return BLUE;

  // Product / Manager / Lead / Executive
  if (/product|manager|lead|owner|ceo|founder|director|strateg/.test(r)) return AMBER;

  // Writer / Docs / Content
  if (/writ|doc|content/.test(r)) return BLUE;

  // Marketing / Sales / Growth
  if (/market|sales|growth/.test(r)) return PINK;

  // Finance / Operations
  if (/financ|budget|revenue|operat/.test(r)) return CYAN;

  // Code Review
  if (/review/.test(r)) return VIOLET;

  // Support
  if (/support|triage/.test(r)) return GREEN;

  // Default: violet (developer / general)
  return VIOLET;
}
