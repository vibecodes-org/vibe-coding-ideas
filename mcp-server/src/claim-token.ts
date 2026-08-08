import { createHash, randomBytes, timingSafeEqual } from "crypto";

/**
 * Claim-token protocol primitives (docs/claim-token-protocol-design.html, Rev 3;
 * work_token added in docs/agent-voice-comments-design.html, Rev 2).
 *
 * claim_next_step mints a one-time claim_token (ct_) and stores ONLY its hash
 * on the step (same hygiene as user_api_keys). complete_step/fail_step verify
 * it — the capability layer proving the completer is the claimer — before the
 * kept persona-consistency check.
 *
 * claim_next_step also mints a work_token (wt_) alongside it, for the same
 * step. Unlike the claim_token, the work_token is handed to the executing
 * subagent and is MULTI-use: any add_task_comment/add_step_comment call that
 * presents it posts in the step's assigned agent's voice for as long as the
 * step stays in_progress. Hashing/verification reuse hashClaimToken/
 * verifyClaimToken as-is — both are pure sha256-over-the-string operations
 * that don't care about the prefix, so there is nothing prefix-specific to
 * duplicate.
 *
 * Bearer-capability residual (design review Note 1): a work_token is a bearer
 * credential, not bound to a specific holder — anyone who obtains a valid
 * wt_ (e.g. from a log line) can post as the persona until the claim ends.
 * This is accepted risk, bounded on three sides: the capability is
 * comment-only (never completion — see err-6 in the design doc), it is
 * scoped to a single step, and it dies the moment that step completes,
 * fails, or is reset (§1.2). The claim_token carries the same residual today
 * for the single completion call it authorises.
 *
 * Pure module, no Supabase, fully unit-testable.
 */

/** Mint a claim token. Returns the plaintext (shown once) and its sha256 hash (stored). */
export function mintClaimToken(): { token: string; hash: string } {
  const token = `ct_${randomBytes(24).toString("hex")}`;
  return { token, hash: hashClaimToken(token) };
}

/** Mint a work token. Returns the plaintext (shown once) and its sha256 hash (stored). */
export function mintWorkToken(): { token: string; hash: string } {
  const token = `wt_${randomBytes(24).toString("hex")}`;
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
