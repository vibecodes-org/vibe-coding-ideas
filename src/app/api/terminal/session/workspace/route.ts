// Terminal session WORKSPACE — what the bridge needs to resolve the project
// folder on the Mac itself, before the agent starts (card 6b2cb8ac).
//
// `POST { sid, token, machineNames }`, called by the bridge (never the
// browser) right after it starts, alongside session/key and session/agents.
// Returns, for the session's board:
//   - repo: the board's GitHub repo (`owner`, `name`, and a clone URL built
//     HERE from the board's own github_url — never taken from the launch link)
//   - repoFolderName / newFolderName: the folder names the bridge would clone
//     into or create under ~/projects (newFolderName is the same slug the page
//     uses for a new project)
//   - savedFolders: the folders saved for THIS Mac only (a row counts when its
//     hostname is one of the names the Mac reports, case-insensitively). Never
//     another Mac's folder: that is what made a Mac with no folder of its own
//     open the MacBook's path and die at once.
//   - otherLiveSessionsOnThisMac: live sessions on this board that may be on
//     this Mac (a row with no machine label counts, to be safe), so the bridge
//     gives a second session its own worktree only when it would share a
//     folder with one.
// `{ workspace: null }` when the session has ended, expired, or isn't known.
//
// AUTH: the bridge's own session token, like session/key — see
// src/lib/terminal/bridge-session-auth.ts. Service-role client, since there
// is no logged-in user on this call; every read is scoped to the session
// row's own owner and board.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { sanitizeMachineList } from "../../../../../../terminal/shared/control-frames.mjs";
import { authorizeBridgeSession } from "@/lib/terminal/bridge-session-auth";
import { isSessionExpired } from "@/lib/terminal/session-registry";
import {
  isPlausibleProjectPath,
  parseRepoFromGithubUrl,
  slugifyIdeaTitle,
  stripClaudeWorktreeSuffix,
} from "@/lib/launch-claude-code";
import type { Database } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  sid: z.string().min(1).max(128),
  token: z.string().min(1).max(4096),
  machineNames: z.array(z.string().min(1).max(200)).min(1).max(5),
});

const REPO_PART = /^[A-Za-z0-9._-]+$/;

export interface WorkspaceRepo {
  owner: string;
  name: string;
  cloneUrl: string;
}

export interface Workspace {
  repo: WorkspaceRepo | null;
  repoFolderName: string | null;
  newFolderName: string;
  savedFolders: string[];
  otherLiveSessionsOnThisMac: number;
}

function repoFromUrl(url: string | null): WorkspaceRepo | null {
  const slug = parseRepoFromGithubUrl(url);
  if (!slug) return null;
  const [owner, name] = slug.split("/");
  if (!owner || !name || !REPO_PART.test(owner) || !REPO_PART.test(name)) return null;
  return { owner, name, cloneUrl: `https://github.com/${owner}/${name}.git` };
}

export async function POST(req: Request) {
  try {
    const secret = process.env.TERMINAL_SESSION_SECRET;
    if (!secret) {
      logger.error("Terminal workspace lookup failed: TERMINAL_SESSION_SECRET not configured");
      return NextResponse.json({ error: "Terminal sessions are not configured" }, { status: 503 });
    }

    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const { sid, token } = parsed.data;
    const names = new Set(sanitizeMachineList(parsed.data.machineNames));

    const supabase = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const auth = await authorizeBridgeSession(supabase, { sid, token, secret });
    if (!auth.ok) {
      if (auth.status === 500) {
        logger.error("Terminal workspace lookup: registry read failed", { sid });
        return NextResponse.json({ error: "Couldn't read the session registry" }, { status: 500 });
      }
      logger.warn("Terminal workspace lookup rejected (auth)", { sid, reason: auth.reason });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!auth.live || !auth.row) {
      return NextResponse.json({ workspace: null });
    }
    const { user_id: ownerId, idea_id: ideaId } = auth.row;

    const [ideaRes, pathsRes, liveRes] = await Promise.all([
      supabase.from("ideas").select("title, github_url").eq("id", ideaId).maybeSingle(),
      supabase
        .from("idea_project_paths")
        .select("hostname, absolute_path, updated_at")
        .eq("idea_id", ideaId)
        .eq("owner_user_id", ownerId)
        .order("updated_at", { ascending: false }),
      supabase
        .from("terminal_sessions")
        .select("sid, machine_label, expires_at")
        .eq("user_id", ownerId)
        .eq("idea_id", ideaId)
        .eq("status", "active")
        .neq("sid", sid),
    ]);

    if (ideaRes.error || !ideaRes.data) {
      logger.error("Terminal workspace lookup: board read failed", {
        sid,
        ideaId,
        error: ideaRes.error?.message ?? "no board",
      });
      return NextResponse.json({ error: "Couldn't read the board" }, { status: 500 });
    }

    // This Mac's saved folders only — never another Mac's.
    let savedFolders: string[] = [];
    if (pathsRes.error) {
      logger.warn("Terminal workspace lookup: saved folders read failed", { sid, ideaId, error: pathsRes.error.message });
    } else {
      const seen = new Set<string>();
      for (const row of pathsRes.data ?? []) {
        if (!names.has(row.hostname.trim().toLowerCase())) continue;
        const folder = stripClaudeWorktreeSuffix(row.absolute_path);
        if (!isPlausibleProjectPath(folder) || seen.has(folder)) continue;
        seen.add(folder);
        savedFolders.push(folder);
      }
    }
    savedFolders = savedFolders.slice(0, 5);

    // Unknown counts as "maybe this Mac"; a read failure counts as one (the
    // safe side — the bridge then keeps the mint's isolate flag as it was).
    let otherLiveSessionsOnThisMac = 1;
    if (liveRes.error) {
      logger.warn("Terminal workspace lookup: live sessions read failed", { sid, ideaId, error: liveRes.error.message });
    } else {
      otherLiveSessionsOnThisMac = (liveRes.data ?? []).filter(
        (r) =>
          !isSessionExpired(r.expires_at) &&
          (r.machine_label == null || names.has(r.machine_label.trim().toLowerCase())),
      ).length;
    }

    const repo = repoFromUrl(ideaRes.data.github_url);
    const workspace: Workspace = {
      repo,
      repoFolderName: repo?.name ?? null,
      newFolderName: slugifyIdeaTitle(ideaRes.data.title ?? ""),
      savedFolders,
      otherLiveSessionsOnThisMac,
    };

    // Metadata only — never a folder path.
    logger.info("Terminal workspace delivered to bridge", {
      sid,
      ideaId,
      hasRepo: !!repo,
      savedCount: savedFolders.length,
      liveOnThisMac: otherLiveSessionsOnThisMac,
    });
    return NextResponse.json({ workspace });
  } catch (err) {
    logger.error("Terminal workspace lookup error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "An unexpected error occurred" }, { status: 500 });
  }
}
