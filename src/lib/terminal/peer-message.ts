// Session-to-session messages (card f0a13bde): the app-side rules that need no
// database or network, so they can be tested alone. The text cleaning, the
// header, the signing and the sender proof live in terminal/shared/
// peer-message.mjs, because the bridge needs the same code to check them.

export type PeerOutcome =
  | "delivered"
  | "waiting"
  | "not-running"
  | "helper-too-old"
  | "cannot-receive"
  | "rate-limited"
  | "unconfirmed"
  | "rejected";

export interface PeerSessionRow {
  sid: string;
  display_name: string | null;
  task_title: string | null;
  agent: "claude" | "codex";
  idea_id: string;
  task_id: string | null;
  machine_label: string | null;
  e2ee_session_key: string | null;
  custom_command?: boolean;
}

export const AGENT_LABEL: Record<"claude" | "codex", string> = { claude: "Claude Code", codex: "Codex" };

/** The name a session shows: its display name, then its task title, then "Untitled session". */
export function peerSessionName(row: Pick<PeerSessionRow, "display_name" | "task_title">): string {
  const named = row.display_name?.trim() || row.task_title?.trim();
  return named || "Untitled session";
}

export type ResolveTarget =
  | { ok: true; row: PeerSessionRow }
  | { ok: false; reason: "not-found" | "ambiguous" | "self" };

/**
 * `to` is a session id, or an exact name that matches exactly one of the
 * caller's own live sessions. Sending to yourself is refused. A foreign id
 * never matches because `rows` is only ever the caller's own sessions.
 */
export function resolvePeerTarget(rows: PeerSessionRow[], to: string, senderSid: string): ResolveTarget {
  const wanted = to.trim();
  if (!wanted) return { ok: false, reason: "not-found" };
  const bySid = rows.find((r) => r.sid === wanted);
  if (bySid) return bySid.sid === senderSid ? { ok: false, reason: "self" } : { ok: true, row: bySid };
  const lower = wanted.toLowerCase();
  const byName = rows.filter((r) => peerSessionName(r).toLowerCase() === lower);
  const others = byName.filter((r) => r.sid !== senderSid);
  if (others.length === 1) return { ok: true, row: others[0] };
  if (others.length > 1) return { ok: false, reason: "ambiguous" };
  if (byName.length > 0) return { ok: false, reason: "self" };
  return { ok: false, reason: "not-found" };
}

/** The honest, plain answer the sending agent sees (mock section 3). */
export function outcomeText(outcome: PeerOutcome, targetName: string): string {
  switch (outcome) {
    case "delivered":
      return `Delivered to "${targetName}".`;
    case "waiting":
      return `Waiting: "${targetName}" is busy (or someone is typing there) and will get it when it's free.`;
    case "not-running":
      return `Not delivered: "${targetName}" isn't running any more.`;
    case "helper-too-old":
      return `Not delivered: the Mac that runs "${targetName}" needs the VibeCodes helper update.`;
    case "cannot-receive":
      return `Not delivered: "${targetName}" can't receive messages (sessions started with a custom command can't, and neither can Codex sessions on an older VibeCodes helper or sessions started before this feature).`;
    case "rate-limited":
      return `Not delivered: too many messages to "${targetName}"; wait a minute.`;
    case "unconfirmed":
      return `Sent to the Mac, but "${targetName}" didn't confirm it arrived. Don't assume it did.`;
    case "rejected":
      return `Not delivered: "${targetName}" refused the message (it failed its safety check). Restart that session if this keeps happening.`;
  }
}

export function isPeerOutcome(v: unknown): v is PeerOutcome {
  return (
    v === "delivered" || v === "waiting" || v === "not-running" || v === "helper-too-old" ||
    v === "cannot-receive" || v === "rate-limited" || v === "unconfirmed" || v === "rejected"
  );
}

/** What `list_my_sessions` returns for one session. */
export interface ListedSession {
  id: string;
  name: string;
  agent: string;
  board: string | null;
  task: string | null;
  machine: string | null;
  can_receive: boolean;
}

export function toListedSession(
  row: PeerSessionRow,
  ideaTitle: string | null,
  you: boolean,
): ListedSession & { you?: boolean } {
  return {
    id: row.sid,
    name: peerSessionName(row),
    agent: AGENT_LABEL[row.agent] ?? "Claude Code",
    board: ideaTitle,
    task: row.task_title?.trim() || null,
    machine: row.machine_label,
    // Claude or Codex, only with a key. A Codex session on an older helper
    // still answers "cannot-receive": the send result is the final word.
    can_receive: (row.agent === "claude" || row.agent === "codex") && !!row.e2ee_session_key,
    ...(you ? { you: true } : {}),
  };
}
