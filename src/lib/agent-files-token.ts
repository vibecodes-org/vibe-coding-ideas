// Short-lived download token for the board's agent files (card 7939ee17).
//
// sync_board_agents hands the session a URL carrying this token and the
// session fetches the files with curl, which has no Supabase login. The token
// is bound to one user and one idea, lasts five minutes, and is signed with a
// key derived from TERMINAL_SESSION_SECRET for this purpose only, so a terminal
// session token can't be replayed here and this one can't be replayed there.
// The endpoint still re-checks board membership on every download.

import { createHmac, timingSafeEqual } from "node:crypto";

export const AGENT_FILES_TTL_SECONDS = 300;
const PURPOSE = "agent-files";
const KEY_LABEL = "vibecodes-agent-files-v1";

export type AgentFilesClaims = { sub: string; idea: string };

export type AgentFilesVerdict =
  | { ok: true; sub: string; idea: string }
  | { ok: false; reason: "no-secret" | "malformed" | "bad-signature" | "wrong-purpose" | "expired" };

function deriveKey(secret: string): Buffer {
  return createHmac("sha256", secret).update(KEY_LABEL).digest();
}

function sign(payloadB64: string, secret: string): Buffer {
  return createHmac("sha256", deriveKey(secret)).update(payloadB64).digest();
}

/** `<payload>.<sig>`, both base64url. `now` is unix seconds. */
export function mintAgentFilesToken(
  claims: AgentFilesClaims,
  rawSecret: string | undefined,
  now: number = Math.floor(Date.now() / 1000),
): string {
  const secret = rawSecret?.trim();
  if (!secret) throw new Error("Agent file downloads are not configured (TERMINAL_SESSION_SECRET is blank)");
  const payload = Buffer.from(
    JSON.stringify({ sub: claims.sub, idea: claims.idea, purpose: PURPOSE, iat: now, exp: now + AGENT_FILES_TTL_SECONDS }),
  ).toString("base64url");
  return `${payload}.${sign(payload, secret).toString("base64url")}`;
}

export function verifyAgentFilesToken(
  token: string,
  rawSecret: string | undefined,
  now: number = Math.floor(Date.now() / 1000),
): AgentFilesVerdict {
  const secret = rawSecret?.trim();
  if (!secret) return { ok: false, reason: "no-secret" };
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: "malformed" };
  const [payload, sigB64] = parts;

  const given = Buffer.from(sigB64, "base64url");
  const expected = sign(payload, secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: "bad-signature" };
  }

  let claims: { sub?: unknown; idea?: unknown; purpose?: unknown; exp?: unknown };
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (claims.purpose !== PURPOSE) return { ok: false, reason: "wrong-purpose" };
  if (typeof claims.sub !== "string" || typeof claims.idea !== "string" || typeof claims.exp !== "number") {
    return { ok: false, reason: "malformed" };
  }
  if (claims.exp <= now) return { ok: false, reason: "expired" };
  return { ok: true, sub: claims.sub, idea: claims.idea };
}
