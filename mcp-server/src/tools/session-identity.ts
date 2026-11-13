import { logger } from "../../../src/lib/logger";
import { reapExpiredSessions } from "../../../src/lib/terminal/session-reap";
import { splitSessionEnvValue, verifySenderProof } from "../../../terminal/shared/peer-message.mjs";
import type { McpContext } from "../context";

// --- Which in-browser session is calling ---
//
// A session started from VibeCodes' in-browser terminal carries a value
// (VIBECODES_SESSION) made from its id plus a proof only that session's own
// Mac helper can make. Tools that act on "this session's own tab"
// (offer_next_card) check it here against the person's live session rows.

export const WRONG_FROM =
  "Couldn't confirm which session you are (the from_session value is wrong, or your session has ended). Re-run `printenv VIBECODES_SESSION` and try again.";

export const MISSING_FROM =
  "Can't tell which session you are. Run `printenv VIBECODES_SESSION` in your terminal and pass that value as from_session. " +
  "If it is empty, this session was not started from VibeCodes' in-browser terminal (or was started before this feature).";

export interface CallingSessionRow {
  sid: string;
  display_name: string | null;
  task_title: string | null;
  agent: "claude" | "codex";
  idea_id: string;
  task_id: string | null;
  machine_label: string | null;
  e2ee_session_key: string | null;
  expires_at: string;
}

const SELECT = "sid, display_name, task_title, agent, idea_id, task_id, machine_label, e2ee_session_key, expires_at, user_id";

async function activeRows(ctx: McpContext, owner: string): Promise<CallingSessionRow[]> {
  await reapExpiredSessions(ctx.supabase, owner, Date.now(), "Session identity");
  const { data, error } = await ctx.supabase
    .from("terminal_sessions")
    .select(SELECT)
    .eq("user_id", owner)
    .eq("status", "active")
    .range(0, 199);
  if (error) {
    logger.error("Session identity: session lookup failed", { error: error.message });
    throw new Error("Couldn't look up your sessions.");
  }
  return (data ?? []) as unknown as CallingSessionRow[];
}

/**
 * The database stores a session's key as base64 text, but the helper decodes it to a
 * 32-byte Buffer and signs with that. Use the same form here or no proof ever matches.
 */
function helperKey(stored: string): Buffer {
  return Buffer.from(stored, "base64");
}

export type CallingSession =
  | { ok: true; owner: string; sender: CallingSessionRow; rows: CallingSessionRow[] }
  | { ok: false; message: string };

/**
 * Who is calling: the session id plus a proof only that session's own helper can
 * make, checked against the live session rows of the same person.
 */
export async function verifyCallingSession(ctx: McpContext, fromSession: string | undefined): Promise<CallingSession> {
  const owner = ctx.ownerUserId ?? ctx.userId;
  const parts = splitSessionEnvValue(fromSession ?? "");
  if (!parts) return { ok: false, message: MISSING_FROM };
  const rows = await activeRows(ctx, owner);
  const sender = rows.find((r) => r.sid === parts.sid);
  if (!sender || !sender.e2ee_session_key || !verifySenderProof(helperKey(sender.e2ee_session_key), parts.sid, parts.proof)) {
    logger.warn("Session identity: sender proof refused", { userId: owner });
    return { ok: false, message: WRONG_FROM };
  }
  return { ok: true, owner, sender, rows };
}
