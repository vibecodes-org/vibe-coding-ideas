import { createHash, randomBytes, timingSafeEqual } from "crypto";

/**
 * Claim-token protocol primitives (docs/claim-token-protocol-design.html, Rev 3).
 *
 * claim_next_step mints a one-time token and stores ONLY its hash on the step
 * (same hygiene as user_api_keys). complete_step/fail_step verify the token —
 * the capability layer proving the completer is the claimer — before the kept
 * persona-consistency check. Pure module, no Supabase, fully unit-testable.
 */

/** Mint a claim token. Returns the plaintext (shown once) and its sha256 hash (stored). */
export function mintClaimToken(): { token: string; hash: string } {
  const token = `ct_${randomBytes(24).toString("hex")}`;
  return { token, hash: hashClaimToken(token) };
}

export function hashClaimToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Constant-time comparison of a presented token against the stored hash. */
export function verifyClaimToken(
  storedHash: string | null | undefined,
  token: string | null | undefined
): boolean {
  if (!storedHash || !token) return false;
  const a = Buffer.from(storedHash, "hex");
  const b = Buffer.from(hashClaimToken(token), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Back-compat grace window (design §5, Design Review condition 2):
 * while enabled, complete_step/fail_step calls WITHOUT a token fall back to the
 * legacy persona-only check (logged). Cutover = set WORKFLOW_CLAIM_TOKEN_GRACE
 * to "false", then DELETE this flag and the legacy path within one release.
 */
export function isClaimTokenGraceEnabled(): boolean {
  return process.env.WORKFLOW_CLAIM_TOKEN_GRACE !== "false";
}
