"use server";

import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import {
  decidePinMigration,
  isPlausibleProjectPath,
  stripClaudeWorktreeSuffix,
  MANUAL_PIN_HOSTNAME,
  type RecordedProjectPath,
} from "@/lib/launch-claude-code";

/**
 * Server-side writes into `idea_project_paths` for the two human-initiated
 * (non-agent) paths — see docs on `decidePinMigration` / `MANUAL_PIN_HOSTNAME`
 * in src/lib/launch-claude-code.ts for the design this implements:
 *
 *  - `migrateLaunchPathPin` — the one-time fold-in of a pre-existing
 *    localStorage "Set exact folder" pin into the server record, so the pin
 *    can be retired as a read source without silently changing anyone's
 *    launch folder.
 *  - `saveManualProjectPath` — what the "Set exact folder" dialog now calls
 *    on Save (existing-mode only), replacing the old direct-to-localStorage
 *    write. Server-side means the pin now persists across browsers.
 *
 * Both take an optional `hostname` — this browser's real machine identity
 * from `getMachineIdentity()` (`src/lib/terminal/machine-identity.ts`),
 * read on the CLIENT (it's a localStorage read; these are server actions
 * and can't read it themselves) and passed in. Falls back to
 * `MANUAL_PIN_HOSTNAME` when null (a browser that has never had a terminal
 * session, so it genuinely doesn't know its own hostname yet) — see
 * `MANUAL_PIN_HOSTNAME`'s doc for why preferring the real hostname matters:
 * a fake, account-wide sentinel row is what let one browser's manual pin
 * silently become what every other browser/machine on the account resolves.
 *
 * Both run through the authenticated (RLS-scoped) client — `owner_user_id`
 * always comes from the session, never a client-supplied value, matching the
 * owner-only RLS policy on idea_project_paths (see migration 00123).
 */

export interface SavePinResult {
  ok: boolean;
  /** Present on success; omitted on auth/validation/db failure. */
  recorded?: RecordedProjectPath;
}

/** Trim a caller-supplied hostname; empty/whitespace-only reads as "not known". */
function normalizeHostname(hostname: string | null | undefined): string | null {
  const trimmed = hostname?.trim();
  return trimmed ? trimmed : null;
}

async function upsertProjectPath(
  ideaId: string,
  hostname: string,
  absolutePath: string
): Promise<SavePinResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false };

  const { data, error } = await supabase
    .from("idea_project_paths")
    .upsert(
      {
        idea_id: ideaId,
        owner_user_id: user.id,
        hostname,
        absolute_path: absolutePath,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "idea_id,owner_user_id,hostname" }
    )
    .select("owner_user_id, hostname, absolute_path")
    .single();

  if (error) {
    logger.warn("launch-path upsert failed", { ideaId, hostname, error: error.message });
    return { ok: false };
  }

  // Belt-and-braces ownership assertion (adopted from an earlier prototype of
  // this action, mcp-server's `record_project_path` sibling): the row we just
  // wrote must belong to the caller. Structurally this can't happen today —
  // `owner_user_id` above always comes from the session, never client input,
  // and the table's RLS policy independently enforces `auth.uid() =
  // owner_user_id` (migration 00123) — but if either of those is ever
  // weakened by a future refactor, this turns a silent misdirected write into
  // a loud, logged failure instead of a leaked one.
  if (data.owner_user_id !== user.id) {
    logger.error("launch-path upsert returned a row owned by someone else", {
      ideaId,
      hostname,
      callerId: user.id,
      rowOwnerId: data.owner_user_id,
    });
    return { ok: false };
  }

  return {
    ok: true,
    recorded: { hostname: data.hostname, absolute_path: data.absolute_path },
  };
}

/**
 * The "Set exact folder" dialog's Save, for existing-mode paths. Always
 * upserts onto ONE dedicated row — `hostname` (this machine's real identity)
 * when known, else `MANUAL_PIN_HOSTNAME` — rather than being routed through
 * the 0/1/>1-row migration logic (that logic exists to avoid disturbing
 * agent-recorded rows on a ONE-TIME, no-user-action migration; an explicit
 * Save is a deliberate write from a known machine and should always land
 * there).
 *
 * Known consequence (flagged, not solved here — no reconciliation UI per the
 * card): if a DIFFERENT hostname's row already exists for this idea with a
 * different path, this creates a second distinct path, and
 * chooseLaunchCwd's contract makes the resolution ambiguous (source "none")
 * rather than picking one. That's an honest reflection of a genuine
 * multi-machine divergence (this machine really does use a different
 * folder), not new ambiguity manufactured by this change.
 */
export async function saveManualProjectPath(
  ideaId: string,
  absolutePath: string,
  hostname?: string | null
): Promise<SavePinResult> {
  // A pasted worktree path (`…/.claude/worktrees/<id>`) collapses to the main
  // project folder it hangs off — same rule as every other write path.
  const trimmed = stripClaudeWorktreeSuffix(absolutePath);
  if (!isPlausibleProjectPath(trimmed)) return { ok: false };
  return upsertProjectPath(ideaId, normalizeHostname(hostname) ?? MANUAL_PIN_HOSTNAME, trimmed);
}

export interface MigratePinResult extends SavePinResult {
  action: "insert" | "update" | "skip" | "invalid" | "unauthenticated" | "error";
}

/**
 * One-time migration of a pre-existing browser pin into `idea_project_paths`.
 * Called by `useLaunchPathPinMigration` on first board load per idea, ONLY
 * when a localStorage existing-mode pin is still present (the hook clears it
 * on success, so this naturally stops running once migrated — no separate
 * "migrated" flag needed).
 *
 * Decision delegated to `decidePinMigration` (pure, unit-tested) against the
 * CURRENT rows for (idea, user) AND `hostname` — this machine's real identity
 * from `getMachineIdentity()`, passed in from the client (see this module's
 * top-of-file doc) — see `decidePinMigration`'s doc for the full precedence
 * table (a row for the real hostname wins outright; otherwise falls back to
 * the original 0/1/>1-row logic, using the real hostname instead of
 * `MANUAL_PIN_HOSTNAME` for a fresh insert when it's known).
 *
 * Idempotent: re-running with the same pin path converges to the same row
 * state in every branch (upsert on the decided hostname, or no write at all).
 */
export async function migrateLaunchPathPin(
  ideaId: string,
  pinPath: string,
  hostname?: string | null
): Promise<MigratePinResult> {
  const trimmed = stripClaudeWorktreeSuffix(pinPath);
  if (!isPlausibleProjectPath(trimmed)) return { ok: false, action: "invalid" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, action: "unauthenticated" };

  const { data: rows, error: selectError } = await supabase
    .from("idea_project_paths")
    .select("hostname")
    .eq("idea_id", ideaId)
    .eq("owner_user_id", user.id);

  if (selectError) {
    logger.warn("migrateLaunchPathPin: row lookup failed", {
      ideaId,
      error: selectError.message,
    });
    return { ok: false, action: "error" };
  }

  const decision = decidePinMigration(rows ?? [], normalizeHostname(hostname));
  if (decision.action === "skip") {
    logger.debug("migrateLaunchPathPin: skipped (ambiguous — >1 recorded rows)", { ideaId });
    return { ok: true, action: "skip" };
  }

  const result = await upsertProjectPath(ideaId, decision.hostname!, trimmed);
  if (!result.ok) return { ok: false, action: "error" };
  return { ok: true, action: decision.action, recorded: result.recorded };
}
