// Terminal helper COMMAND — the Helper row's Stop/Update actions and the
// "Keep helper ready" toggle (card cc74a067).
//
// `POST { cmd: "stop"|"quiesce"|"set-always-on", value? }` forwards the
// command to the caller's own live helper leg via the relay's authenticated
// POST /helper/command (same control-token pattern as
// src/app/api/terminal/session/end/route.ts and the sibling status route).
// `delivered:false` is an HONEST outcome (no live helper leg right now), not
// an error — the Helper row's "may already be stopped" toast is exactly this.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { mintControlToken, helperSessionId } from "../../../../../../terminal/shared/session-token.mjs";
import { relayHttpBaseUrl } from "@/lib/terminal/relay-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.union([
  z.object({ cmd: z.literal("stop") }),
  z.object({ cmd: z.literal("quiesce") }),
  z.object({ cmd: z.literal("set-always-on"), value: z.boolean() }),
]);

export async function POST(req: Request) {
  try {
    const secret = process.env.TERMINAL_SESSION_SECRET;
    if (!secret) {
      logger.error("Terminal helper command failed: TERMINAL_SESSION_SECRET not configured");
      return NextResponse.json({ error: "Terminal sessions are not configured" }, { status: 503 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const sid = helperSessionId(user.id);
    const control = await mintControlToken({ sub: user.id, sid, secret });
    const httpBase = relayHttpBaseUrl();

    let res: Response;
    try {
      res = await fetch(`${httpBase}/helper/command?session=${encodeURIComponent(sid)}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${control}`, "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
    } catch (err) {
      logger.warn("Terminal helper command: relay unreachable", {
        cmd: parsed.data.cmd,
        error: err instanceof Error ? err.message : String(err),
      });
      return NextResponse.json({ error: "Couldn't reach the relay" }, { status: 502 });
    }

    if (!res.ok) {
      logger.error("Terminal helper command: relay rejected the control call", {
        cmd: parsed.data.cmd,
        status: res.status,
      });
      return NextResponse.json({ error: "Couldn't reach the helper" }, { status: 502 });
    }

    const body = await res.json();
    logger.info("Sent terminal helper command", { userId: user.id, cmd: parsed.data.cmd, delivered: body?.delivered });
    return NextResponse.json(body);
  } catch (err) {
    logger.error("Terminal helper command error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "An unexpected error occurred" }, { status: 500 });
  }
}
