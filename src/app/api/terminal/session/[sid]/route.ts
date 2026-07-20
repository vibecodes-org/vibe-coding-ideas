// Terminal session PATCH — multi-session stage 3 (C4: the My-sessions identity
// line — "machine · cwd · short sid").
//
// Best-effort, client-known identity fields ONLY. The browser has no real
// signal for a machine's display name (no JS API exposes it), so
// `machine_label` is never set here — only `cwd`, which the dock already
// resolves client-side to build the launch prompt/deep link (see
// use-terminal-session.ts → resolveLaunchPromptParts). Called fire-and-forget
// right after a session mints; a failure here never surfaces to the user (the
// registry row still exists with cwd left null — an honest omission, not a
// broken feature).

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  cwd: z.string().trim().min(1).max(1024),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ sid: string }> }) {
  try {
    const { sid } = await params;
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

    const { error } = await supabase
      .from("terminal_sessions")
      .update({ cwd: parsed.data.cwd })
      .eq("sid", sid)
      .eq("user_id", user.id)
      .eq("status", "active");
    if (error) {
      logger.error("Terminal session identity PATCH failed", { sid, error: error.message });
      return NextResponse.json({ error: "Couldn't update session identity" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error("Terminal session identity PATCH error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "An unexpected error occurred" }, { status: 500 });
  }
}
