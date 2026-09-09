// Terminal helper TOKEN mint — Codex support (docs/codex-terminal-requirements.md
// FR-11, US-10): the desktop `vibecodes://open-terminal` launch (a real
// Terminal.app window, NOT a relay/bridge session) needs a fresh HELPER-role
// token to (re)establish the helper's standing control connection, but must
// NOT go through `POST /api/terminal/session` — that route mints a full
// bridge+browser+helper token TRIPLE, writes a `terminal_sessions` row, and
// spends the session cap/daily-budget bookkeeping, none of which apply here
// (the requirements are explicit: "No session record" for this path). This
// route mints ONLY the helper-role token, mirroring the status route's own
// minimal auth shape (an authenticated VibeCodes user, nothing else to name —
// a signed-in user can only ever mint a token for their OWN helper).

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { mintHelperToken } from "../../../../../../terminal/shared/session-token.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const secret = process.env.TERMINAL_SESSION_SECRET;
    if (!secret) {
      logger.error("Terminal helper token mint failed: TERMINAL_SESSION_SECRET not configured");
      return NextResponse.json({ error: "Terminal sessions are not configured" }, { status: 503 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const helperToken = await mintHelperToken({ sub: user.id, secret });
    return NextResponse.json({ helperToken });
  } catch (err) {
    logger.error("Terminal helper token mint error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "An unexpected error occurred" }, { status: 500 });
  }
}
