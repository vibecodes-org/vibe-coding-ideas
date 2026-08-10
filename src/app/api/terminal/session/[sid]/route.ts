// Terminal session PATCH — multi-session stage 3 (C4: the My-sessions identity
// line — "machine · cwd · short sid"), extended by Nick's sign-off change 2
// for the bridge-announced machine identity.
//
// Best-effort, client-known identity fields ONLY: `cwd` (the dock already
// resolves it client-side to build the launch prompt/deep link — see
// use-terminal-session.ts → resolveLaunchPromptParts) and, now, `machineLabel`
// (the bridge's own `os.hostname()`, forwarded via the relay's `bridge-version`
// control frame — see that same file's bridge-version handling). Both are
// called fire-and-forget; a failure here never surfaces to the user (the
// registry row simply keeps whichever field was already there — an honest
// omission, not a broken feature). `machineLabel` is re-sanitized here with
// the SAME rules the relay applies before ever forwarding it — never trust the
// client alone — and is ONLY EVER SET, never cleared: a request with no valid
// field to write is a silent no-op, not an error.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { sanitizeMachineLabel } from "../../../../../../terminal/shared/control-frames.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z
  .object({
    cwd: z.string().trim().min(1).max(1024).optional(),
    machineLabel: z.string().trim().min(1).max(200).optional(),
  })
  .refine((data) => data.cwd !== undefined || data.machineLabel !== undefined, {
    message: "At least one of cwd or machineLabel is required",
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

    const update: { cwd?: string; machine_label?: string } = {};
    if (parsed.data.cwd) update.cwd = parsed.data.cwd;
    if (parsed.data.machineLabel) {
      const sanitized = sanitizeMachineLabel(parsed.data.machineLabel);
      if (sanitized) update.machine_label = sanitized;
    }
    if (Object.keys(update).length === 0) {
      // Nothing valid survived sanitization (e.g. a machineLabel-only request
      // whose value failed the shared gate) — a no-op, not an error.
      return NextResponse.json({ ok: true });
    }

    const { error } = await supabase
      .from("terminal_sessions")
      .update(update)
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
