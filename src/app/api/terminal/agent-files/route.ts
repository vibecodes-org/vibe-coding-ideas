// The board's agents as `.claude/agents/vc-*.md` files, for sessions VibeCodes
// didn't launch (card 7939ee17). The sync_board_agents MCP tool mints a
// five-minute token and hands the session a curl command for this URL; the
// session unpacks the tar into its agents folder. See
// src/lib/terminal/session-agent-files.ts.
//
// AUTH: the token (src/lib/agent-files-token.ts) is the only credential, since
// curl has no login. It binds one user to one idea; board membership is
// re-checked here on every download. Excluded from middleware with the rest of
// /api/terminal. The response carries agent prompts: never cached, never logged.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";
import { verifyAgentFilesToken } from "@/lib/agent-files-token";
import { isBoardMember, loadBoardSessionAgents } from "@/lib/terminal/board-session-agents";
import { buildAgentFilesTar } from "@/lib/terminal/session-agent-files";
import type { Database } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const secret = process.env.TERMINAL_SESSION_SECRET?.trim();
    if (!secret) {
      logger.error("Agent files download failed: TERMINAL_SESSION_SECRET not configured");
      return NextResponse.json({ error: "Agent file downloads are not configured" }, { status: 503 });
    }

    const token = new URL(req.url).searchParams.get("t") ?? "";
    const verdict = verifyAgentFilesToken(token, secret);
    if (!verdict.ok) {
      logger.warn("Agent files download rejected (auth)", { reason: verdict.reason });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    if (!(await isBoardMember(supabase, verdict.idea, verdict.sub))) {
      logger.warn("Agent files download rejected (not a board member)", { idea: verdict.idea });
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const agents = await loadBoardSessionAgents(supabase, {
      ideaId: verdict.idea,
      userId: verdict.sub,
      agent: "claude",
      logContext: { idea: verdict.idea },
    });
    if (!agents) return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });

    const tar = buildAgentFilesTar(agents);
    logger.info("Agent files delivered", { idea: verdict.idea, agents: Object.keys(agents).length });
    return new NextResponse(new Uint8Array(tar), {
      status: 200,
      headers: {
        "Content-Type": "application/x-tar",
        "Cache-Control": "no-store",
        "Content-Length": String(tar.length),
      },
    });
  } catch (err) {
    logger.error("Agent files download error", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: "An unexpected error occurred" }, { status: 500 });
  }
}
