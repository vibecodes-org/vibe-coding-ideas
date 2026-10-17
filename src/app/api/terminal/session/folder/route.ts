// Terminal session FOLDER — the bridge records the project folder it resolved
// on the Mac (card 6b2cb8ac).
//
// `POST { sid, token, machineNames, path, how }`, called by the bridge once it
// has found, downloaded or created the board's project folder and before the
// agent starts. It:
//   - re-checks the folder with the app's own rules (a Claude Code worktree
//     collapses to the main checkout; `/`, a home folder or a top-level folder
//     is refused with 400 `not-a-project-folder`);
//   - saves it for THIS Mac under every name the Mac reports (its fixed
//     LocalHostName and its current hostname), so one Mac with two network
//     names keeps one folder. An existing row's spelling of a name is reused,
//     so a case change never adds a duplicate row;
//   - sets the session's folder (terminal_sessions.cwd).
// `how` ("saved" | "found" | "cloned" | "created") is only logged.
//
// The agent's own record_project_path step in the launch prompt stays as a
// backup; this route is what makes a fresh Mac right without it.
//
// AUTH: the bridge's own session token — see
// src/lib/terminal/bridge-session-auth.ts. Service-role client; the owner
// and board always come from the session row, never from the request.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { sanitizeMachineLabel } from "../../../../../../terminal/shared/control-frames.mjs";
import { authorizeBridgeSession } from "@/lib/terminal/bridge-session-auth";
import { isPlausibleProjectPath, isValidAbsolutePath, stripClaudeWorktreeSuffix } from "@/lib/launch-claude-code";
import type { Database } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  sid: z.string().min(1).max(128),
  token: z.string().min(1).max(4096),
  machineNames: z.array(z.string().min(1).max(200)).min(1).max(5),
  path: z.string().min(1).max(1024),
  how: z.enum(["saved", "found", "cloned", "created"]),
});

export async function POST(req: Request) {
  try {
    const secret = process.env.TERMINAL_SESSION_SECRET;
    if (!secret) {
      logger.error("Terminal folder record failed: TERMINAL_SESSION_SECRET not configured");
      return NextResponse.json({ error: "Terminal sessions are not configured" }, { status: 503 });
    }

    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const { sid, token, how } = parsed.data;

    const supabase = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const auth = await authorizeBridgeSession(supabase, { sid, token, secret });
    if (!auth.ok) {
      if (auth.status === 500) {
        logger.error("Terminal folder record: registry read failed", { sid });
        return NextResponse.json({ error: "Couldn't read the session registry" }, { status: 500 });
      }
      logger.warn("Terminal folder record rejected (auth)", { sid, reason: auth.reason });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!auth.live || !auth.row) {
      return NextResponse.json({ error: "session-not-active" }, { status: 409 });
    }
    const { user_id: ownerId, idea_id: ideaId } = auth.row;

    const path = stripClaudeWorktreeSuffix(parsed.data.path);
    if (!isValidAbsolutePath(path) || !isPlausibleProjectPath(path)) {
      logger.warn("Terminal folder record refused: not a project folder", { sid, ideaId, how });
      return NextResponse.json({ error: "not-a-project-folder" }, { status: 400 });
    }

    // Every name the Mac reports, case preserved, de-duplicated case-insensitively.
    const names: string[] = [];
    for (const raw of parsed.data.machineNames) {
      const label = sanitizeMachineLabel(raw);
      if (label && !names.some((n) => n.toLowerCase() === label.toLowerCase())) names.push(label);
    }
    if (names.length === 0) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    // Reuse an existing row's spelling of each name: the unique key compares
    // hostnames exactly, so a different case would add a second row.
    const { data: existing, error: existingErr } = await supabase
      .from("idea_project_paths")
      .select("hostname")
      .eq("idea_id", ideaId)
      .eq("owner_user_id", ownerId);
    if (existingErr) {
      logger.warn("Terminal folder record: existing rows read failed", { sid, ideaId, error: existingErr.message });
    }
    const hostnames = names.map(
      (n) => (existing ?? []).find((r) => r.hostname.trim().toLowerCase() === n.toLowerCase())?.hostname ?? n,
    );

    const updatedAt = new Date().toISOString();
    const { error: upsertErr } = await supabase.from("idea_project_paths").upsert(
      hostnames.map((hostname) => ({
        idea_id: ideaId,
        owner_user_id: ownerId,
        hostname,
        absolute_path: path,
        updated_at: updatedAt,
      })),
      { onConflict: "idea_id,owner_user_id,hostname" },
    );
    if (upsertErr) {
      logger.error("Terminal folder record: upsert failed", { sid, ideaId, how, error: upsertErr.message });
      return NextResponse.json({ error: "Couldn't save the folder" }, { status: 500 });
    }

    const { error: cwdErr } = await supabase
      .from("terminal_sessions")
      .update({ cwd: path })
      .eq("sid", sid)
      .eq("status", "active");
    if (cwdErr) {
      // The folder record is what matters for the next launch; the session's
      // own folder is display only, and the page also gets it from the bridge.
      logger.warn("Terminal folder record: session folder update failed", { sid, error: cwdErr.message });
    }

    logger.info("Terminal folder recorded by bridge", { sid, ideaId, how, names: hostnames });
    return NextResponse.json({ ok: true, path });
  } catch (err) {
    logger.error("Terminal folder record error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "An unexpected error occurred" }, { status: 500 });
  }
}
