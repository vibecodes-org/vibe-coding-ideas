// Terminal session EVENTS: the lasting record of what each in-app terminal
// session went through (card f4be2981, stage 2). Saved in
// terminal_session_events (migration 00210) so a "it broke when I switched
// Wi-Fi" report can be diagnosed afterwards from data, without asking Nick
// to reproduce it.
//
// `POST { events: [{ sid, event, at, detail }] }`, from three kinds of caller:
// - the browser: signed in as the user. Each event's sid must be one of the
//   user's own sessions, or "-" for something not tied to a session (the
//   browser going offline, the tab waking).
// - the bridge on the Mac: `{ sid, token, events }` with its bridge token for
//   that sid. An expired token is accepted for the session's own owner, the
//   same waiver the relay applies to a reattach, because a bridge that has
//   been holding a session for hours still needs to report.
// - the relay: `Authorization: Bearer <notify token>` for the sid in
//   `{ sid, events }`.
// For the bridge and the relay every event is filed under that one sid.
//
// Never blocks anything: callers fire and forget. Bad events are dropped one
// by one (session-events.ts), and rows older than 30 days are trimmed now
// and then.

import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { authorizeAttach, authorizeNotify } from "../../../../../../terminal/shared/session-token.mjs";
import { cleanSessionEvents, MAX_EVENT_AGE_MS, type SessionEventSource } from "@/lib/terminal/session-events";
import type { Database } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Placeholder sid for browser events not tied to one session. */
const NO_SESSION = "-";
const TRIM_CHANCE = 0.02;

function serviceClient() {
  return createServiceClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function POST(req: Request) {
  try {
    const secret = process.env.TERMINAL_SESSION_SECRET;
    if (!secret) {
      return NextResponse.json({ error: "Terminal sessions are not configured" }, { status: 503 });
    }
    // sendBeacon posts text/plain, so read the body as text and parse it here.
    let body: unknown;
    try {
      body = JSON.parse(await req.text());
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const b = body as { sid?: unknown; token?: unknown; events?: unknown };
    const nowMs = Date.now();
    const service = serviceClient();

    let userId: string;
    let source: SessionEventSource;
    let events = cleanSessionEvents(b.events, nowMs);

    const authHeader = req.headers.get("authorization") || "";
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;

    if (bearer || typeof b.token === "string") {
      // Relay or bridge: one sid, proven by a signed token.
      if (typeof b.sid !== "string") return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
      const sid = b.sid;
      const { data: row } = await service.from("terminal_sessions").select("user_id").eq("sid", sid).maybeSingle();
      if (!row) return NextResponse.json({ saved: 0 });
      if (bearer) {
        const auth = await authorizeNotify({ token: bearer, secret, session: sid });
        if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        source = "relay";
      } else {
        const auth = await authorizeAttach({
          token: b.token,
          secret,
          session: sid,
          role: "bridge",
          boundOwner: row.user_id,
          maxSessionMs: MAX_EVENT_AGE_MS,
        });
        if (!auth.ok || auth.sub !== row.user_id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        source = "bridge";
      }
      userId = row.user_id;
      events = events.map((e) => ({ ...e, sid }));
    } else {
      // Browser: the signed-in user, and only their own sessions.
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
      userId = user.id;
      source = "browser";
      const sids = [...new Set(events.map((e) => e.sid).filter((s) => s !== NO_SESSION))];
      if (sids.length > 0) {
        const { data: owned } = await supabase.from("terminal_sessions").select("sid").eq("user_id", user.id).in("sid", sids);
        const mine = new Set((owned ?? []).map((r) => r.sid));
        events = events.filter((e) => e.sid === NO_SESSION || mine.has(e.sid));
      }
    }

    if (events.length === 0) return NextResponse.json({ saved: 0 });

    const { error } = await service.from("terminal_session_events").insert(
      events.map((e) => ({ user_id: userId, sid: e.sid, source, event: e.event, detail: e.detail as Database["public"]["Tables"]["terminal_session_events"]["Insert"]["detail"], at: e.at })),
    );
    if (error) {
      logger.error("Terminal session events: save failed", { source, count: events.length, error: error.message });
      return NextResponse.json({ error: "Couldn't save events" }, { status: 500 });
    }

    // One line per batch in the server log too, so recent trouble shows up there.
    logger.info("Terminal session events saved", {
      source,
      count: events.length,
      events: events.slice(0, 20).map((e) => `${e.sid.slice(0, 8)} ${e.event}`),
    });

    if (Math.random() < TRIM_CHANCE) {
      const cutoff = new Date(nowMs - MAX_EVENT_AGE_MS).toISOString();
      const { error: trimError } = await service.from("terminal_session_events").delete().eq("user_id", userId).lt("at", cutoff);
      if (trimError) logger.warn("Terminal session events: trim failed", { error: trimError.message });
    }

    return NextResponse.json({ saved: events.length });
  } catch (err) {
    logger.error("Terminal session events error", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: "An unexpected error occurred" }, { status: 500 });
  }
}
