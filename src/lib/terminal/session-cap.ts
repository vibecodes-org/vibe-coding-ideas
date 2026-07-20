// In-app terminal — the per-user in-browser session cap (multi-session stage 2,
// OQ4: "Cap value display... Q3's env-tunable value must not be hardcoded in
// copy"). Stage 2 only READS the cap for honest UI copy (the "+" tooltip, the
// generic mint-failure toast) — the server-side ENFORCEMENT of this cap is stage
// 3's job (the mint route doesn't reject on it yet). Keeping this in one pure,
// unit-tested module now means stage 3 wires the *same* number into the actual
// refusal path instead of a second hardcoded constant drifting from this one.

/** The cap when NEXT_PUBLIC_TERMINAL_SESSION_CAP is unset or unusable. */
export const DEFAULT_TERMINAL_SESSION_CAP = 5;

/**
 * Resolve the configured in-browser session cap. Reads
 * `NEXT_PUBLIC_TERMINAL_SESSION_CAP` (so it's inlined client-side same as every
 * other NEXT_PUBLIC_* flag this feature uses); falls back to
 * DEFAULT_TERMINAL_SESSION_CAP for anything unset, non-numeric, non-integer, or
 * not positive — a misconfigured env var should never silently become "no cap"
 * (0/negative) or a NaN that breaks copy templates.
 */
export function getTerminalSessionCap(
  raw: string | undefined = process.env.NEXT_PUBLIC_TERMINAL_SESSION_CAP,
): number {
  if (raw === undefined) return DEFAULT_TERMINAL_SESSION_CAP;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return DEFAULT_TERMINAL_SESSION_CAP;
  const n = Number.parseInt(trimmed, 10);
  return n > 0 ? n : DEFAULT_TERMINAL_SESSION_CAP;
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
