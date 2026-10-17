// Shared auth for the bridge-called terminal routes that read or write board
// data on the bridge's behalf (card 6b2cb8ac: session/workspace and
// session/folder).
//
// Same token check as session/key — the bridge's own session token,
// verified with authorizeAttach (role "bridge") — with one addition: the
// session row is read FIRST and its owner is handed in as `boundOwner`, so a
// bridge whose short-lived token has aged (a relaunch, a slow clone) is still
// accepted, but ONLY for the row's own owner and within 24h of minting. A
// token for any other user is refused outright. The caller then decides what
// an ended/expired row means for its own route.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { authorizeAttach } from "../../../terminal/shared/session-token.mjs";
import { REGISTRY_SESSION_TTL_MS, isSessionExpired } from "@/lib/terminal/session-registry";

export interface BridgeSessionRow {
  user_id: string;
  idea_id: string;
  status: "active" | "ended";
  expires_at: string;
}

export type BridgeSessionAuth =
  | { ok: true; row: BridgeSessionRow | null; live: boolean }
  | { ok: false; status: 401 | 500; reason: string };

export async function authorizeBridgeSession(
  supabase: SupabaseClient<Database>,
  { sid, token, secret }: { sid: string; token: string; secret: string },
): Promise<BridgeSessionAuth> {
  const { data: row, error } = await supabase
    .from("terminal_sessions")
    .select("user_id, idea_id, status, expires_at")
    .eq("sid", sid)
    .maybeSingle();
  if (error) return { ok: false, status: 500, reason: "registry-read-failed" };

  const auth = await authorizeAttach({
    token,
    secret,
    session: sid,
    role: "bridge",
    boundOwner: row?.user_id ?? null,
    maxSessionMs: REGISTRY_SESSION_TTL_MS,
  });
  if (!auth.ok) return { ok: false, status: 401, reason: auth.reason ?? "unauthorized" };
  if (row && auth.sub !== row.user_id) return { ok: false, status: 401, reason: "owner-mismatch" };

  const live = !!row && row.status === "active" && !isSessionExpired(row.expires_at);
  return { ok: true, row: row ?? null, live };
}
