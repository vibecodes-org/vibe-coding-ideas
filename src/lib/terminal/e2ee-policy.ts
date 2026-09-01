// Terminal P2 (end-to-end encryption of the PTY stream) — the PURE
// negotiation-outcome policy (FR-5). Decoupled from the WebSocket/xterm
// wiring in use-terminal-session.ts (same split as helper-version.ts) so the
// "what does this combination of signals MEAN" decision is fully unit
// testable without a socket.
//
// Phase A / Phase B (FR-5): today `TERMINAL_E2EE_REQUIRED` always resolves to
// `false` in production (the flag exists but is never flipped on by this
// task — that's a later, deliberate rollout step) — so `required: false`
// keeps this a no-op negotiation: encrypt whenever both legs are capable,
// otherwise run exactly as today (plaintext). Wiring the flag in now means
// flipping it on later needs no client code changes, only the env var.
export type E2eePolicy = "active" | "plaintext" | "fail-closed";

/** How long a Phase B (`required: true`) attach waits for negotiation
 *  (the bridge's own bridge-version announce/relay-forward round trip)
 *  before deciding fail-closed. Generous relative to a normal LAN/relay
 *  round trip so a legitimately-capable pair is never punished for being
 *  slow — this only ever fires when negotiation genuinely never lands. */
export const E2EE_NEGOTIATION_GRACE_MS = 8000;

/**
 * Decide what a session's E2EE state should be from what's known so far.
 *
 * @param required     `TERMINAL_E2EE_REQUIRED` — Phase B enforcement is on.
 * @param browserHasKey This browser tab holds a session key (from the mint
 *                      response) and WebCrypto is available.
 * @param bridgeE2ee    The bridge announced `e2ee:true` on its bridge-version
 *                      frame — it collected a key and is ready to encrypt.
 */
export function decideE2eePolicy({
  required,
  browserHasKey,
  bridgeE2ee,
}: {
  required: boolean;
  browserHasKey: boolean;
  bridgeE2ee: boolean;
}): E2eePolicy {
  if (browserHasKey && bridgeE2ee) return "active";
  // Negotiation didn't land: either side is missing a key/capability. FR-5 —
  // Phase A (required=false) degrades to plaintext exactly like today;
  // Phase B (required=true) must fail closed instead of silently downgrading.
  return required ? "fail-closed" : "plaintext";
}

/** `TERMINAL_E2EE_REQUIRED` env parsing — mirrors CLAUDE.md's blank-env-var
 *  hazard fix (`.trim() || default`, never a bare `??`) so an accidentally
 *  blank Vercel env var can never silently flip Phase B on OR off. Default
 *  OFF: this task implements the flag but does not turn it on anywhere. */
export function isE2eeRequired(raw: string | undefined): boolean {
  return (raw ?? "").trim() === "1";
}
