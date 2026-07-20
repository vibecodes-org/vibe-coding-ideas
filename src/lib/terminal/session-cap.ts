// In-app terminal — the per-user in-browser session cap (multi-session stage 2,
// OQ4: "Cap value display... Q3's env-tunable value must not be hardcoded in
// copy"). Stage 2 only READ the cap for honest UI copy (the "+" tooltip, the
// generic mint-failure toast). Stage 3 wires the SAME default (5) into the
// mint route's actual server-side refusal (see getServerTerminalSessionCap
// below) instead of a second hardcoded constant drifting from this one.

/** The cap when neither env var (client or server) is set or usable. */
export const DEFAULT_TERMINAL_SESSION_CAP = 5;

/** The mint rate limit when TERMINAL_MINT_RATE_LIMIT is unset or unusable (E2). */
export const DEFAULT_TERMINAL_MINT_RATE_LIMIT = 10;

/**
 * Parse an env var into a positive integer, falling back for anything unset,
 * non-numeric, non-integer, or not positive — a misconfigured env var should
 * never silently become "no cap" (0/negative) or a NaN that breaks copy
 * templates. Shared by every env-tunable number this feature reads.
 */
function parsePositiveIntEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return fallback;
  const n = Number.parseInt(trimmed, 10);
  return n > 0 ? n : fallback;
}

/**
 * Resolve the configured in-browser session cap for CLIENT-SIDE copy. Reads
 * `NEXT_PUBLIC_TERMINAL_SESSION_CAP` (so it's inlined client-side same as every
 * other NEXT_PUBLIC_* flag this feature uses).
 */
export function getTerminalSessionCap(
  raw: string | undefined = process.env.NEXT_PUBLIC_TERMINAL_SESSION_CAP,
): number {
  return parsePositiveIntEnv(raw, DEFAULT_TERMINAL_SESSION_CAP);
}

/**
 * The SERVER-SIDE enforcement cap (stage 3, mint route, requirement E1). A
 * deliberately SEPARATE env var (`TERMINAL_SESSION_CAP`, no `NEXT_PUBLIC_`
 * prefix) from the client's copy-only `NEXT_PUBLIC_TERMINAL_SESSION_CAP` — the
 * client var is inlined into the JS bundle at build time (world-readable); the
 * enforcement value is read at request time server-side and never shipped to
 * the browser. Both fall back to the SAME `DEFAULT_TERMINAL_SESSION_CAP` (5,
 * Nick's binding decision) so an unconfigured deployment stays internally
 * consistent between the "+" tooltip's promise and the real limit.
 */
export function getServerTerminalSessionCap(
  raw: string | undefined = process.env.TERMINAL_SESSION_CAP,
): number {
  return parsePositiveIntEnv(raw, DEFAULT_TERMINAL_SESSION_CAP);
}

/**
 * The SERVER-SIDE mint rate limit (stage 3, mint route, requirement E2): max
 * sessions a user may mint within a trailing 5-minute window. Reads
 * `TERMINAL_MINT_RATE_LIMIT`, server-only (never shipped to the browser).
 */
export function getTerminalMintRateLimit(
  raw: string | undefined = process.env.TERMINAL_MINT_RATE_LIMIT,
): number {
  return parsePositiveIntEnv(raw, DEFAULT_TERMINAL_MINT_RATE_LIMIT);
}

/**
 * The "+" affordance's honesty tooltip (design §2 callout 4, requirement R4),
 * extended with the configured cap so the number is never a separate hardcoded
 * string anywhere it's surfaced. The "+" is NEVER disabled at this cap — stage 3
 * enforces it server-side; this copy just sets expectations up front.
 */
export function newSessionTooltip(cap: number = getTerminalSessionCap()): string {
  return `New terminal — runs on your computer. Each session uses real resources. Up to ${cap} at once.`;
}

/**
 * Best-effort client-side guess at whether a mint failure's message was the cap
 * refusal (stage 3 will give this a distinct error code; until then we match the
 * shape of the server's plain-English refusal so the toast reads the same either
 * way). Returns false — never throws — for anything that doesn't look cap-shaped,
 * so an unrelated mint failure keeps its own honest message.
 */
export function isCapRefusalMessage(message: string | undefined | null): boolean {
  if (!message) return false;
  return /already have\s+\d+\s+terminals? running|terminal session cap|too many (active )?terminal sessions/i.test(
    message,
  );
}

/** Toast copy for a cap refusal, templated from config (never a hardcoded number). */
export function capReachedToastCopy(cap: number = getTerminalSessionCap()): {
  title: string;
  description: string;
} {
  return {
    title: `You already have ${cap} terminals running`,
    description: "That's the limit for now. End one to start another.",
  };
}

// ── stage 3: server-side refusal bodies (mint route) ────────────────────────
//
// The mint route returns a distinct `code` per refusal reason so the client
// never has to string-match a message to decide what UI to show (E1/E2) —
// `isCapRefusalMessage` above stays only as a best-effort fallback for a
// response that somehow lost its `code`. The two refusals are deliberately
// DIFFERENT copy: the cap refusal names the fix (end a session) and is one
// click from "My sessions"; the rate limit is a transient throttle with NO
// mention of ending anything (a user hitting it hasn't necessarily hit the
// cap — ending a session would not even be the right advice).

export const CAP_REFUSAL_CODE = "cap_exceeded" as const;
export const RATE_LIMIT_CODE = "rate_limited" as const;

/** The mint route's 409 refusal copy (design §7b, cap number always templated). */
export function capRefusalMessage(cap: number = getServerTerminalSessionCap()): string {
  return `You already have ${cap} terminal${cap === 1 ? "" : "s"} running — end one to start another.`;
}

/** The mint route's 429 refusal copy — distinct state, never suggests ending a session. */
export const RATE_LIMIT_MESSAGE =
  "You're starting terminals too fast — wait a moment and try again.";
