// Terminal helper COMMAND — the Helper row's Stop/Update actions, the
// "Keep helper ready" toggle (card cc74a067), and the isolated-worktree
// "Merge into main" action (task 6366bcb1).
//
// `POST { cmd: "stop"|"quiesce"|"set-always-on", value? }` forwards the
// command to the caller's own live helper leg via the relay's authenticated
// POST /helper/command (same control-token pattern as
// src/app/api/terminal/session/end/route.ts and the sibling status route).
// `delivered:false` is an HONEST outcome (no live helper leg right now), not
// an error — the Helper row's "may already be stopped" toast is exactly this.
//
// `POST { cmd: "merge-worktree", sid }` is the odd one out: unlike every other
// command here it's SESSION-scoped (not the standing per-owner helper
// identity) and it needs an actual RESULT back, not just `delivered`. This
// route resolves `sid` to that session's registered `cwd`/`claude_session_id`
// (RLS/ownership-scoped — never a raw sid trusted blind, same as
// session/end/route.ts), derives the MAIN repo root via
// `stripClaudeWorktreeSuffix` (never trusts a caller-supplied path), and
// forwards `{mainRepoRoot, branch}` to the SAME relay endpoint — the relay
// holds the HTTP call open until the helper's `merge-result` reply comes back
// (see terminal/relay/src/index.js's `handleMergeCommand`).

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { mintControlToken, helperSessionId } from "../../../../../../terminal/shared/session-token.mjs";
import { relayHttpBaseUrl } from "@/lib/terminal/relay-http";
import { stripClaudeWorktreeSuffix } from "@/lib/launch-claude-code";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.union([
  z.object({ cmd: z.literal("stop") }),
  z.object({ cmd: z.literal("quiesce") }),
  z.object({ cmd: z.literal("set-always-on"), value: z.boolean() }),
  z.object({ cmd: z.literal("merge-worktree"), sid: z.string().min(1).max(128) }),
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

    // The merge command is SESSION-scoped, not the standing helper identity —
    // resolve + validate the target session before forwarding anything. The
    // BRANCH to merge is never derived here — Claude Code checks out
    // `worktree-<id>` in that folder, not the bare conversation id (verified
    // live against a real repo, task 6366bcb1 QA pass) — so only the folder
    // itself (`worktreePath`) is forwarded; the helper discovers the real
    // branch from git at merge time (see worktree-merge.js's
    // `resolveWorktreeBranch`), which self-heals if that naming ever changes.
    let relayBody: { cmd: string; value?: unknown };
    if (parsed.data.cmd === "merge-worktree") {
      const { data: session, error: sessionErr } = await supabase
        .from("terminal_sessions")
        .select("cwd")
        .eq("sid", parsed.data.sid)
        .eq("user_id", user.id)
        .eq("status", "active")
        .maybeSingle();
      if (sessionErr) {
        logger.error("Terminal helper command: merge session lookup failed", { error: sessionErr.message });
        return NextResponse.json({ error: "Couldn't look up that session" }, { status: 500 });
      }
      if (!session?.cwd) {
        return NextResponse.json({ error: "Session not found" }, { status: 404 });
      }
      const worktreePath = session.cwd;
      const mainRepoRoot = stripClaudeWorktreeSuffix(worktreePath);
      if (mainRepoRoot === worktreePath) {
        // Never inside a `.claude/worktrees/` path — this session isn't isolated,
        // so there is nothing to merge back.
        return NextResponse.json({ error: "This session isn't isolated — nothing to merge" }, { status: 400 });
      }
      relayBody = { cmd: "merge-worktree", value: { mainRepoRoot, worktreePath } };
    } else {
      relayBody = parsed.data;
    }

    const sid = helperSessionId(user.id);
    const control = await mintControlToken({ sub: user.id, sid, secret });
    const httpBase = relayHttpBaseUrl();

    let res: Response;
    try {
      res = await fetch(`${httpBase}/helper/command?session=${encodeURIComponent(sid)}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${control}`, "content-type": "application/json" },
        body: JSON.stringify(relayBody),
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
