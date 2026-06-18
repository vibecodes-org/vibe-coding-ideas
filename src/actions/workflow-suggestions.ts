"use server";

import { createClient } from "@/lib/supabase/server";
import { applyWorkflowTemplateWithContext } from "@/actions/workflow-templates";
import { logger } from "@/lib/logger";

/**
 * Human-only resolution of mismatched-workflow suggestions — Keep / Replace /
 * Remove.
 *
 * These are SERVER ACTIONS, not MCP tools. Resolving a suggestion is reserved
 * for humans (AC-23): an autonomous agent that hits an open suggestion is told
 * to ask its human to resolve it, it can never resolve one itself. Two layers
 * enforce that:
 *   1. RLS — every write is gated by `is_idea_team_member()`, and we require an
 *      authenticated user before touching the DB.
 *   2. Defence-in-depth — we reject any caller whose `users` row is a bot
 *      account (`is_bot = true`), mirroring the identity enforcement on
 *      `complete_step` / `fail_step`.
 *
 * Concurrency: each resolve guards on `status = 'suggested'` with
 * `.eq("status", "suggested")` + `.maybeSingle()` (mirroring the workflow-step
 * mutations in `workflow.ts`). A second concurrent resolve matches zero rows and
 * no-ops with a clear error instead of double-applying a template. The status
 * transition is committed BEFORE the template is applied so the guard, not the
 * apply, is the race winner.
 *
 * Returns are toast-friendly `{ success: true, ... }` / `{ error: string }`
 * shapes — these never throw to the client, callers `toast` the message.
 */

type ResolveResult =
  | { success: true; run?: unknown }
  | { error: string };

/**
 * Resolve the authenticated human caller, or return a toast-friendly error.
 * Rejects bot accounts (human-only resolution, AC-23).
 */
async function requireHuman(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<{ userId: string } | { error: string }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "You must be signed in to resolve a suggestion." };

  const { data: profile, error } = await supabase
    .from("users")
    .select("is_bot")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    logger.error("Workflow suggestion: failed to load caller profile", {
      error: error.message,
      userId: user.id,
    });
    return { error: "Could not verify your account. Please try again." };
  }

  if (profile?.is_bot) {
    return {
      error: "Workflow suggestions can only be resolved by a human team member.",
    };
  }

  return { userId: user.id };
}

/**
 * Load an open suggestion. Returns null when it doesn't exist or is no longer
 * 'suggested' (already resolved by someone else).
 */
async function loadOpenSuggestion(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  suggestionId: string
) {
  const { data, error } = await supabase
    .from("workflow_suggestions")
    .select("id, idea_id, task_id, suggested_template_id, status")
    .eq("id", suggestionId)
    .eq("status", "suggested")
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as {
    id: string;
    idea_id: string;
    task_id: string;
    suggested_template_id: string | null;
    status: string;
  } | null;
}

/**
 * AC-5 — Keep: apply the originally suggested template to the task, then mark
 * the suggestion `accepted`.
 */
export async function keepWorkflowSuggestion(
  suggestionId: string
): Promise<ResolveResult> {
  try {
    const supabase = await createClient();

    const auth = await requireHuman(supabase);
    if ("error" in auth) return auth;

    const suggestion = await loadOpenSuggestion(supabase, suggestionId);
    if (!suggestion) {
      return { error: "This suggestion has already been resolved." };
    }
    if (!suggestion.suggested_template_id) {
      return { error: "This suggestion has no template to apply." };
    }

    // Concurrency guard: claim the suggestion FIRST. If a second caller already
    // transitioned it, this matches zero rows and we abort before applying.
    const { data: claimed, error: claimErr } = await supabase
      .from("workflow_suggestions")
      .update({
        status: "accepted",
        resolved_at: new Date().toISOString(),
        resolved_by: auth.userId,
      })
      .eq("id", suggestionId)
      .eq("status", "suggested")
      .select("id")
      .maybeSingle();

    if (claimErr) throw new Error(claimErr.message);
    if (!claimed) {
      return { error: "This suggestion has already been resolved." };
    }

    const run = await applyWorkflowTemplateWithContext(
      supabase,
      auth.userId,
      suggestion.task_id,
      suggestion.suggested_template_id
    );

    return { success: true, run };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to keep suggestion.";
    logger.error("Workflow suggestion: keep failed", { error: message, suggestionId });
    return { error: message };
  }
}

/**
 * AC-6 — Replace: apply a DIFFERENT template (chosen by the human) instead of
 * the suggested one, then mark the suggestion `replaced`. The originally
 * suggested template is never applied.
 */
export async function replaceWorkflowSuggestion(
  suggestionId: string,
  replacementTemplateId: string
): Promise<ResolveResult> {
  try {
    const supabase = await createClient();

    const auth = await requireHuman(supabase);
    if ("error" in auth) return auth;

    const suggestion = await loadOpenSuggestion(supabase, suggestionId);
    if (!suggestion) {
      return { error: "This suggestion has already been resolved." };
    }

    // Validate the replacement belongs to this idea's available templates.
    const { data: replacement, error: tplErr } = await supabase
      .from("workflow_templates")
      .select("id")
      .eq("id", replacementTemplateId)
      .eq("idea_id", suggestion.idea_id)
      .maybeSingle();

    if (tplErr) throw new Error(tplErr.message);
    if (!replacement) {
      return { error: "That template isn't available for this idea." };
    }

    // Concurrency guard: claim the suggestion before applying anything.
    const { data: claimed, error: claimErr } = await supabase
      .from("workflow_suggestions")
      .update({
        status: "replaced",
        replacement_template_id: replacementTemplateId,
        resolved_at: new Date().toISOString(),
        resolved_by: auth.userId,
      })
      .eq("id", suggestionId)
      .eq("status", "suggested")
      .select("id")
      .maybeSingle();

    if (claimErr) throw new Error(claimErr.message);
    if (!claimed) {
      return { error: "This suggestion has already been resolved." };
    }

    const run = await applyWorkflowTemplateWithContext(
      supabase,
      auth.userId,
      suggestion.task_id,
      replacementTemplateId
    );

    return { success: true, run };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to replace suggestion.";
    logger.error("Workflow suggestion: replace failed", {
      error: message,
      suggestionId,
    });
    return { error: message };
  }
}

/**
 * AC-7 — Remove: dismiss the suggestion without applying any template. The
 * task's label is left untouched.
 */
export async function removeWorkflowSuggestion(
  suggestionId: string
): Promise<ResolveResult> {
  try {
    const supabase = await createClient();

    const auth = await requireHuman(supabase);
    if ("error" in auth) return auth;

    // Concurrency guard: dismiss only if still open.
    const { data: claimed, error: claimErr } = await supabase
      .from("workflow_suggestions")
      .update({
        status: "dismissed",
        resolved_at: new Date().toISOString(),
        resolved_by: auth.userId,
      })
      .eq("id", suggestionId)
      .eq("status", "suggested")
      .select("id")
      .maybeSingle();

    if (claimErr) throw new Error(claimErr.message);
    if (!claimed) {
      return { error: "This suggestion has already been resolved." };
    }

    return { success: true };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to remove suggestion.";
    logger.error("Workflow suggestion: remove failed", {
      error: message,
      suggestionId,
    });
    return { error: message };
  }
}
