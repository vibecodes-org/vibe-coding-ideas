import { randomUUID } from "node:crypto";
import { z } from "zod";
import { logger } from "../../../src/lib/logger";
import { relayHttpBaseUrl } from "../../../src/lib/terminal/relay-http";
import { reapExpiredSessions } from "../../../src/lib/terminal/session-reap";
import {
  isPeerOutcome,
  type PeerOutcome,
  outcomeText,
  peerSessionName,
  resolvePeerTarget,
  toListedSession,
  type PeerSessionRow,
} from "../../../src/lib/terminal/peer-message";
import { mintControlToken } from "../../../terminal/shared/session-token.mjs";
import {
  cleanPeerText,
  encodePeerFrame,
  signPeerEnvelope,
  splitSessionEnvValue,
  verifySenderProof,
  PEER_MAX_CHARS,
} from "../../../terminal/shared/peer-message.mjs";
import type { McpContext } from "../context";

// --- Session-to-session messages (card f0a13bde) ---
//
// list_my_sessions and send_session_message let one of a person's in-browser
// sessions (Claude Code or Codex) talk to another. Same owner only, checked
// here from the database; the sender is proven by a value only that session's
// helper holds; the sender's name and agent come from the database, never from
// the caller. The message text is never logged or echoed back.

export const listMySessionsSchema = z.object({
  from_session: z
    .string()
    .max(300)
    .optional()
    .describe("Optional: your own session value (VIBECODES_SESSION), used only to mark which listed session is you. Claude Code sessions fill this in automatically."),
});

export const sendSessionMessageSchema = z.object({
  to: z.string().min(1).max(200).describe("Which session to message: its id from list_my_sessions, or its exact name when only one session has that name"),
  message: z.string().min(1).max(10_000).describe(`Plain text, at most ${PEER_MAX_CHARS} characters. Control characters are removed.`),
  from_session: z
    .string()
    .max(300)
    .optional()
    .describe("Your own session value: the VIBECODES_SESSION environment variable (run `printenv VIBECODES_SESSION`). Claude Code sessions fill this in automatically: leave it out."),
});

const MISSING_FROM =
  "Can't tell which session you are. Run `printenv VIBECODES_SESSION` in your terminal and pass that value as from_session. " +
  "If it is empty, this session was not started from VibeCodes' in-browser terminal (or was started before this feature): " +
  "only in-browser sessions can send messages.";

function sessionSecret(): string {
  const secret = process.env.TERMINAL_SESSION_SECRET?.trim();
  if (!secret) throw new Error("Session messaging isn't configured on this server (no terminal secret).");
  return secret;
}

const SELECT =
  "sid, display_name, task_title, agent, idea_id, task_id, machine_label, e2ee_session_key, expires_at, user_id";

async function activeRows(ctx: McpContext, owner: string): Promise<(PeerSessionRow & { expires_at: string })[]> {
  await reapExpiredSessions(ctx.supabase, owner, Date.now(), "Session messages");
  const { data, error } = await ctx.supabase
    .from("terminal_sessions")
    .select(SELECT)
    .eq("user_id", owner)
    .eq("status", "active")
    .range(0, 199);
  if (error) {
    logger.error("Session messages: session lookup failed", { error: error.message });
    throw new Error("Couldn't look up your sessions.");
  }
  return (data ?? []) as unknown as (PeerSessionRow & { expires_at: string })[];
}

export async function listMySessions(ctx: McpContext, params: z.infer<typeof listMySessionsSchema>) {
  const owner = ctx.ownerUserId ?? ctx.userId;
  const rows = await activeRows(ctx, owner);
  const ideaIds = [...new Set(rows.map((r) => r.idea_id))];
  const titles = new Map<string, string>();
  if (ideaIds.length > 0) {
    const { data } = await ctx.supabase.from("ideas").select("id, title").in("id", ideaIds);
    for (const i of data ?? []) titles.set(i.id, i.title);
  }
  const yourSid = splitSessionEnvValue(params.from_session ?? "")?.sid ?? null;
  return {
    sessions: rows.map((r) => toListedSession(r, titles.get(r.idea_id) ?? null, r.sid === yourSid)),
    note:
      "can_receive is a guide only (a session whose Mac helper is out of date, or that has ended, still shows). " +
      "The answer to send_session_message is the final word.",
  };
}

export async function sendSessionMessage(ctx: McpContext, params: z.infer<typeof sendSessionMessageSchema>) {
  const owner = ctx.ownerUserId ?? ctx.userId;
  const secret = sessionSecret();

  // 1. Who is sending: id plus a proof only that session's own helper can make.
  const parts = splitSessionEnvValue(params.from_session ?? "");
  if (!parts) return { delivered: false, outcome: "not-sent", message: MISSING_FROM };
  const rows = await activeRows(ctx, owner);
  const sender = rows.find((r) => r.sid === parts.sid);
  if (!sender || !sender.e2ee_session_key || !verifySenderProof(sender.e2ee_session_key, parts.sid, parts.proof)) {
    logger.warn("Session messages: sender proof refused", { userId: owner });
    return {
      delivered: false,
      outcome: "not-sent",
      message: "Couldn't confirm which session you are (the from_session value is wrong, or your session has ended). Re-run `printenv VIBECODES_SESSION` and try again.",
    };
  }

  // 2. The target: one of the same person's other live sessions.
  const target = resolvePeerTarget(rows, params.to, sender.sid);
  if (!target.ok) {
    const message =
      target.reason === "self"
        ? "You can't message your own session."
        : target.reason === "ambiguous"
          ? "More than one of your sessions has that name. Use the id from list_my_sessions."
          : "No live session of yours matches that. Call list_my_sessions for the current list.";
    return { delivered: false, outcome: "not-sent", message };
  }
  const targetName = peerSessionName(target.row);

  // 3. Clean the text, build and sign the message with the TARGET's own key.
  const cleaned = cleanPeerText(params.message);
  if (!cleaned.ok) {
    const message =
      cleaned.reason === "too-long"
        ? `That message is longer than ${PEER_MAX_CHARS} characters. Shorten it (put detail in a file and point to it).`
        : "The message is empty (after removing control characters).";
    return { delivered: false, outcome: "not-sent", message };
  }
  if (!target.row.e2ee_session_key) {
    return { delivered: false, outcome: "cannot-receive", message: outcomeText("cannot-receive", targetName) };
  }
  const id = randomUUID();
  const frame = encodePeerFrame(
    signPeerEnvelope(target.row.e2ee_session_key, {
      id,
      to: target.row.sid,
      from: { sid: sender.sid, name: peerSessionName(sender), agent: sender.agent },
      text: cleaned.text,
      ts: Date.now(),
    }),
  );

  // 4. Hand it to the relay, which waits for the target's helper to answer.
  let outcome: PeerOutcome | null = null;
  try {
    const control = await mintControlToken({ sub: owner, sid: target.row.sid, secret });
    const res = await fetch(`${relayHttpBaseUrl()}/message?session=${encodeURIComponent(target.row.sid)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${control}`, "content-type": "application/json" },
      body: JSON.stringify({ id, frame }),
      signal: AbortSignal.timeout(9000),
    });
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as { outcome?: unknown } | null;
      if (isPeerOutcome(body?.outcome)) outcome = body.outcome;
    } else {
      logger.warn("Session messages: relay refused", { status: res.status });
    }
  } catch (err) {
    logger.warn("Session messages: relay unreachable", { error: err instanceof Error ? err.message : String(err) });
  }
  if (!outcome) {
    // An old relay (no /message route) or a failed call: never a fake success.
    return {
      delivered: false,
      outcome: "not-sent",
      message: "Not delivered: couldn't reach the session relay (it may need its update). Nothing was sent.",
    };
  }
  logger.info("Session message sent", { userId: owner, outcome, chars: cleaned.text.length });
  return {
    delivered: outcome === "delivered",
    outcome,
    message: outcomeText(outcome, targetName),
    chars: cleaned.text.length,
  };
}
