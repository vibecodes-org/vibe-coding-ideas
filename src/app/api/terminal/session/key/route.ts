// Terminal P2 (end-to-end encryption of the PTY stream) — the BRIDGE's
// off-relay key-delivery channel (FR-1).
//
// The browser leg gets its copy of the session's E2EE key directly in the
// mint AND reattach routes' JSON responses (POST /api/terminal/session,
// POST /api/terminal/session/reattach) — ANY of the owner's authenticated
// tabs/devices, not just the one that minted the session. The bridge leg has
// no equivalent authenticated app→bridge channel today — the only thing it's
// ever handed is the vibecodes:// launch deep link (relay + tokens), and
// that link's params live in a length budget that's already within ~5 chars
// of its cap for a repo-backed launch (see CLAUDE.md's In-App Terminal
// section and deep-link.test.ts) — a 256-bit key would blow it. So instead
// the bridge makes a DIRECT HTTPS call here (never through the relay, per
// FR-1) using the SAME bridgeToken it already carries, the instant it starts
// up (terminal/bridge/src/index.js).
//
// AUTH: no Supabase user session exists for this call (the bridge is a local
// Node process, not a logged-in browser) — authorized instead by verifying
// the bridge's own session token (terminal/shared/session-token.mjs →
// authorizeAttach, role "bridge"), the exact same signature/expiry/sid/role
// check the relay itself performs. A service-role Supabase client is
// required for the same reason as session/closed/route.ts — RLS has no
// authenticated user to scope to here.
//
// REPEATABLE DELIVERY: the key is NEVER cleared here — a bridge process that
// relaunches for the same session id (e.g. the helper was quit and the user
// reconnects) must be able to fetch the SAME key again. Delivery is gated
// only on the row being active and unexpired (mirrors decideReattach's own
// check), never on "already read once". The row is cleared to null only when
// the session itself ends (session/end, session/closed, session-reap.ts),
// with the registry TTL (~24h, REGISTRY_SESSION_TTL_MS) as the backstop even
// if an explicit clear is missed.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { authorizeAttach } from "../../../../../../terminal/shared/session-token.mjs";
import { isSessionExpired } from "@/lib/terminal/session-registry";
import type { Database } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  sid: z.string().min(1).max(128),
  token: z.string().min(1).max(4096),
});

export async function POST(req: Request) {
  try {
    const secret = process.env.TERMINAL_SESSION_SECRET;
    if (!secret) {
      logger.error("Terminal session key fetch failed: TERMINAL_SESSION_SECRET not configured");
      return NextResponse.json({ error: "Terminal sessions are not configured" }, { status: 503 });
    }

    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const { sid, token } = parsed.data;

    // Same check the relay itself runs on a bridge leg's attach — no bound
    // owner is threaded through here (this route doesn't need one: it isn't
    // deciding single-attach/ownership, only "is this a genuine, unexpired
    // bridge token for this exact session").
    const auth = await authorizeAttach({ token, secret, session: sid, role: "bridge" });
    if (!auth.ok) {
      logger.warn("Terminal session key fetch rejected (auth)", { sid, reason: auth.reason });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    // Read-only: no clearing here (see the module doc above) — a relaunched
    // bridge for the same sid must be able to fetch the same key again.
    const { data: row, error: readError } = await supabase
      .from("terminal_sessions")
      .select("e2ee_session_key, status, expires_at")
      .eq("sid", sid)
      .maybeSingle();
    if (readError) {
      logger.error("Terminal session key fetch: registry read failed", { sid, error: readError.message });
      return NextResponse.json({ error: "Couldn't read the session registry" }, { status: 500 });
    }

    // Honest outcomes, not errors: the row is gone, has already ended, has
    // expired, or predates this feature (no key ever stored). The bridge
    // falls back to an unencrypted session (Phase A negotiation, FR-5)
    // exactly as it would for an old relay/app that never had this route.
    if (!row || row.status !== "active" || isSessionExpired(row.expires_at)) {
      return NextResponse.json({ delivered: false });
    }

    const sessionKey = row.e2ee_session_key ?? null;
    if (!sessionKey) {
      return NextResponse.json({ delivered: false });
    }

    logger.info("Terminal session key delivered to bridge", { sid });
    return NextResponse.json({ delivered: true, sessionKey });
  } catch (err) {
    logger.error("Terminal session key fetch error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "An unexpected error occurred" }, { status: 500 });
  }
}
