// "Ran in its own agent" reports (card 24936814).
//
// Claude Code POSTs here from an http PreToolUse hook that lives inside each
// board agent's definition (src/lib/workflow/own-agent.ts), so it fires only
// when a board agent, not the main session, makes one of the three board calls
// that carry a work token. The event names the agent (`agent_type`) and holds
// the call's input, including the step's `work_token`.
//
// AUTH: the work token itself. It must belong to a step that is in progress
// (compared in constant time against work_token_hash). Anything else is
// ignored. The answer is ALWAYS an empty 204: a hook failure never blocks the
// agent's tool call, and the caller learns nothing about why a report was
// ignored. Tokens and tool input are never logged.
//
// Evidence from Claude Code, not proof: someone holding a live work token could
// post the same request by hand.

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { logger } from "@/lib/logger";
import { isNamedAgentFor, parseAttestPayload } from "@/lib/workflow/own-agent";
import { verifyClaimToken } from "../../../../../mcp-server/src/claim-token";

export const runtime = "nodejs";

/** A hook event with a board tool's input is small; anything bigger is not one. */
const MAX_BODY_BYTES = 256 * 1024;

const NO_CONTENT = () => new Response(null, { status: 204 });

export async function POST(request: Request): Promise<Response> {
  try {
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > MAX_BODY_BYTES) return NO_CONTENT();
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return NO_CONTENT();

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return NO_CONTENT();
    }
    const report = parseAttestPayload(json);
    if (!report) return NO_CONTENT();

    const supabase = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const select = "id, bot_id, status, work_token_hash, attested_agent_type";
    const lookup = report.stepId
      ? supabase.from("task_workflow_steps").select(select).eq("id", report.stepId)
      : supabase
          .from("task_workflow_steps")
          .select(select)
          .eq("task_id", report.taskId!)
          .eq("status", "in_progress")
          .limit(20);
    const { data: candidates, error } = await lookup;
    if (error) {
      logger.warn("attest: step lookup failed", { error: error.message });
      return NO_CONTENT();
    }

    const step = (candidates ?? []).find(
      (c) => c.status === "in_progress" && verifyClaimToken(c.work_token_hash, report.workToken),
    );
    if (!step || !step.work_token_hash) return NO_CONTENT();

    // Already recorded: nothing to write (this is also the rate limit).
    if (step.attested_agent_type === report.agentType) return NO_CONTENT();
    // A report from the step's own agent is never replaced by another agent's.
    if (
      step.bot_id &&
      step.attested_agent_type &&
      isNamedAgentFor(step.attested_agent_type, step.bot_id) &&
      !isNamedAgentFor(report.agentType, step.bot_id)
    ) {
      return NO_CONTENT();
    }

    const { error: updateError } = await supabase
      .from("task_workflow_steps")
      .update({
        attested_agent_type: report.agentType,
        attested_agent_id: report.agentId,
        attested_at: new Date().toISOString(),
      })
      .eq("id", step.id)
      .eq("status", "in_progress")
      .eq("work_token_hash", step.work_token_hash)
      .select("id")
      .maybeSingle();
    if (updateError) logger.warn("attest: write failed", { stepId: step.id, error: updateError.message });
  } catch (e) {
    logger.warn("attest: unexpected error", { error: e instanceof Error ? e.message : String(e) });
  }
  return NO_CONTENT();
}
