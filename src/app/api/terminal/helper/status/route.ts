// Terminal helper STATUS — the Helper row's status poll (card cc74a067).
//
// `GET` returns the caller's own helper leg's presence/version/machine-label/
// always-on/"stopped unexpectedly" state, exactly as the relay's Durable
// Object durably tracks it (see terminal/relay/src/helper-status.js →
// computeHelperStatus). Mirrors src/app/api/terminal/session/end/route.ts's
// auth shape: a short-lived, sid-bound CONTROL token
// (terminal/shared/session-token.mjs → mintControlToken/authorizeControl)
// minted server-side so the relay never has to trust a raw session id alone.
//
// The caller's helper session id is always `helperSessionId(user.id)` — one
// reserved, deterministic id per owner (never per-launch random, unlike a
// terminal session's sid) — so the request can only narrow WHICH of the
// caller's own helper legs (one per Mac) it asks about; a signed-in user can
// only ever ask about their OWN helper.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { mintControlToken, helperSessionId } from "../../../../../../terminal/shared/session-token.mjs";
import { sanitizeMachineList } from "../../../../../../terminal/shared/control-frames.mjs";
import { relayHttpBaseUrl } from "@/lib/terminal/relay-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Card 6b2cb8ac: `?machines=a,b` (this Mac's names, from the page's own
// launches) asks about THIS Mac's helper leg — the relay now keeps one per
// Mac. Absent → the relay's old answer (whichever helper leg is newest).
export async function GET(req: Request) {
  try {
    const secret = process.env.TERMINAL_SESSION_SECRET;
    if (!secret) {
      logger.error("Terminal helper status failed: TERMINAL_SESSION_SECRET not configured");
      return NextResponse.json({ error: "Terminal sessions are not configured" }, { status: 503 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const sid = helperSessionId(user.id);
    const control = await mintControlToken({ sub: user.id, sid, secret });
    const httpBase = relayHttpBaseUrl();
    const machines = sanitizeMachineList(new URL(req.url).searchParams.get("machines"));
    const machinesParam = machines.length > 0 ? `&machines=${encodeURIComponent(machines.join(","))}` : "";

    let res: Response;
    try {
      res = await fetch(`${httpBase}/helper/status?session=${encodeURIComponent(sid)}${machinesParam}`, {
        headers: { Authorization: `Bearer ${control}` },
      });
    } catch (err) {
      logger.warn("Terminal helper status: relay unreachable", {
        error: err instanceof Error ? err.message : String(err),
      });
      // Honest "we don't know" rather than a fabricated not-running — the
      // Helper row treats a fetch failure the same way (keeps its last known
      // state / shows a retry), never as a confirmed "not running".
      return NextResponse.json({ error: "Couldn't reach the relay" }, { status: 502 });
    }

    if (!res.ok) {
      logger.error("Terminal helper status: relay rejected the control call", { status: res.status });
      return NextResponse.json({ error: "Couldn't check the helper's status" }, { status: 502 });
    }

    const status = await res.json();
    return NextResponse.json(status);
  } catch (err) {
    logger.error("Terminal helper status error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "An unexpected error occurred" }, { status: 500 });
  }
}
