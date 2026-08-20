// Terminal session PATCH — multi-session stage 3 (C4: the My-sessions identity
// line — "machine · cwd · short sid"), extended by Nick's sign-off change 2
// for the bridge-announced machine identity, rework 5 (exact-conversation
// Resume) for the bridge-announced claude conversation id, and card 3bf262ac
// ("terminal sessions need names that stick") for the user-initiated rename.
//
// TWO DIFFERENT FIELD FAMILIES on this route, with DIFFERENT semantics —
// keep them that way:
//   - `cwd` / `machineLabel` / `claudeSessionId`: best-effort, BRIDGE-FED
//     identity fields. `cwd` is resolved client-side to build the launch
//     prompt/deep link (use-terminal-session.ts → resolveLaunchPromptParts);
//     `machineLabel`/`claudeSessionId` arrive via the relay's
//     `bridge-version` control frame. Fire-and-forget; a failure here never
//     surfaces to the user. ONLY ever written while the row is
//     `status = 'active'`, and ONLY EVER SET, NEVER CLEARED — a request with
//     no valid field to write is a silent no-op, not an error.
//     `machineLabel`/`claudeSessionId` are re-sanitized here with the SAME
//     rules the relay applies before ever forwarding them — never trust the
//     client alone.
//   - `displayName`: the USER-INITIATED rename (card 3bf262ac). Allowed on
//     rows in EITHER status — an ended row is exactly where Nick needs to
//     rename most (the session chooser's Recent/resume list), so this field
//     deliberately has NO `status = 'active'` filter, unlike the three
//     above. It is also CLEARABLE: an empty/whitespace value clears the name
//     back to NULL (never `""`), which is how the rename UI's "blank field"
//     save resets to the auto-name. Server-enforced 100-CODE-POINT trim/clamp
//     (`normalizeDisplayNameInput`) — never UTF-16 units, which would
//     desync from a client that clamped by code point (an emoji-heavy name
//     could otherwise pass the client's check and still get silently
//     mangled here).

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { normalizeDisplayNameInput } from "@/lib/terminal/display-name";
import {
  sanitizeMachineLabel,
  sanitizeConversationId,
} from "../../../../../../terminal/shared/control-frames.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z
  .object({
    cwd: z.string().trim().min(1).max(1024).optional(),
    machineLabel: z.string().trim().min(1).max(200).optional(),
    claudeSessionId: z.string().trim().min(1).max(64).optional(),
    // Deliberately NOT `.min(1)` and NOT `.trim()`-transformed here — a
    // value of `""` or `"   "` is how the rename UI signals "clear back to
    // the auto-name" (see the module doc above), and this handler needs to
    // see that value AS SENT to tell "present but blank" apart from "field
    // omitted entirely" (`=== undefined`). Bounded generously above the real
    // 100-code-point limit; `normalizeDisplayNameInput` enforces the actual
    // limit.
    displayName: z.string().max(1000).optional(),
  })
  .refine(
    (data) =>
      data.cwd !== undefined ||
      data.machineLabel !== undefined ||
      data.claudeSessionId !== undefined ||
      data.displayName !== undefined,
    { message: "At least one of cwd, machineLabel, claudeSessionId or displayName is required" },
  );

export async function PATCH(req: Request, { params }: { params: Promise<{ sid: string }> }) {
  try {
    const { sid } = await params;
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

    // ── bridge-fed identity fields — unchanged: active-only, set-never-clear.
    const identityUpdate: { cwd?: string; machine_label?: string; claude_session_id?: string } = {};
    if (parsed.data.cwd) identityUpdate.cwd = parsed.data.cwd;
    if (parsed.data.machineLabel) {
      const sanitized = sanitizeMachineLabel(parsed.data.machineLabel);
      if (sanitized) identityUpdate.machine_label = sanitized;
    }
    if (parsed.data.claudeSessionId) {
      const sanitized = sanitizeConversationId(parsed.data.claudeSessionId);
      if (sanitized) identityUpdate.claude_session_id = sanitized;
    }

    if (Object.keys(identityUpdate).length > 0) {
      const { error } = await supabase
        .from("terminal_sessions")
        .update(identityUpdate)
        .eq("sid", sid)
        .eq("user_id", user.id)
        .eq("status", "active");
      if (error) {
        logger.error("Terminal session identity PATCH failed", { sid, error: error.message });
        return NextResponse.json({ error: "Couldn't update session identity" }, { status: 500 });
      }
    }

    // ── user-initiated rename (card 3bf262ac) — allowed on active AND ended
    // rows (see module doc); clearable; NO `status` filter, unlike above.
    let resolvedDisplayName: string | null | undefined;
    if (parsed.data.displayName !== undefined) {
      resolvedDisplayName = normalizeDisplayNameInput(parsed.data.displayName);
      const { error } = await supabase
        .from("terminal_sessions")
        .update({ display_name: resolvedDisplayName })
        .eq("sid", sid)
        .eq("user_id", user.id);
      if (error) {
        logger.error("Terminal session rename PATCH failed", { sid, error: error.message });
        return NextResponse.json({ error: "Couldn't rename the session" }, { status: 500 });
      }
    }

    if (Object.keys(identityUpdate).length === 0 && resolvedDisplayName === undefined) {
      // Nothing valid survived sanitization (e.g. a machineLabel-only request
      // whose value failed the shared gate) and no rename was requested —
      // a no-op, not an error.
      return NextResponse.json({ ok: true });
    }

    // `displayName` rides the response so the client can reconcile its
    // optimistic value against whatever the server actually normalized/
    // trimmed/clamped it to — same spirit as returning the minted token
    // shapes elsewhere in this feature.
    return NextResponse.json({
      ok: true,
      ...(resolvedDisplayName !== undefined ? { displayName: resolvedDisplayName } : {}),
    });
  } catch (err) {
    logger.error("Terminal session identity PATCH error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "An unexpected error occurred" }, { status: 500 });
  }
}
