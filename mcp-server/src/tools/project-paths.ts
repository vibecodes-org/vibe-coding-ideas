import { z } from "zod";
import { logger } from "../../../src/lib/logger";
import { isValidAbsolutePath } from "../../../src/lib/launch-claude-code";
import type { McpContext } from "../context";

// --- Record Project Path ---
//
// No-repo launch folder: the launched local Claude Code session reports the
// absolute path of the idea's project directory (from an expanded `pwd`) so
// future launches can open straight in that folder. The browser can never read
// a folder path, so this self-report is the only source of truth.
//
// Ownership (Design Review change #4): the row is bound to the REAL human
// (ctx.ownerUserId ?? ctx.userId) — NEVER the active bot identity — matching the
// owner-only RLS policy on idea_project_paths.

export const recordProjectPathSchema = z.object({
  idea_id: z.string().uuid().describe("The idea this project folder belongs to"),
  hostname: z
    .string()
    .min(1)
    .max(255)
    .describe("This machine's hostname (output of `hostname` or `uname -n`)"),
  absolute_path: z
    .string()
    .min(1)
    .max(4096)
    .describe(
      "The EXPANDED absolute path of the project folder (the output of `pwd`). " +
        "Must be a real absolute path — NOT empty, relative, or starting with `~`."
    ),
});

export async function recordProjectPath(
  ctx: McpContext,
  params: z.infer<typeof recordProjectPathSchema>
) {
  const absolutePath = params.absolute_path.trim();
  const hostname = params.hostname.trim();

  // Reject anything that isn't an expanded absolute path. `~`, relative paths,
  // and unexpanded `$VAR` would all store a value the browser can't use as cwd.
  if (!isValidAbsolutePath(absolutePath)) {
    throw new Error(
      "absolute_path must be an expanded absolute path (e.g. /Users/you/projects/my-idea) — " +
        "not empty, relative, or starting with `~`. Run `pwd` and pass its exact output."
    );
  }

  if (!hostname) {
    throw new Error("hostname is required (run `hostname` or `uname -n`).");
  }

  // Bind to the real human, never the active bot identity (matches owner-only RLS).
  const ownerUserId = ctx.ownerUserId ?? ctx.userId;

  const { data, error } = await ctx.supabase
    .from("idea_project_paths")
    .upsert(
      {
        idea_id: params.idea_id,
        owner_user_id: ownerUserId,
        hostname,
        absolute_path: absolutePath,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "idea_id,owner_user_id,hostname" }
    )
    .select("id, idea_id, hostname, absolute_path, updated_at")
    .single();

  if (error) {
    logger.warn("record_project_path upsert failed", {
      ideaId: params.idea_id,
      hostname,
      error: error.message,
    });
    throw new Error(`Failed to record project path: ${error.message}`);
  }

  logger.debug("record_project_path stored", {
    ideaId: params.idea_id,
    hostname,
  });

  return {
    success: true,
    recorded: {
      idea_id: data.idea_id,
      hostname: data.hostname,
      absolute_path: data.absolute_path,
      updated_at: data.updated_at,
    },
  };
}
