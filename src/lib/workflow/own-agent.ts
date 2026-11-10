// Did this step really run in its own agent? (card 24936814)
//
// Claude Code reports which agent made a board call (an http PreToolUse hook
// inside each board agent's definition posts to /api/workflow/attest). This
// module is the pure part: the hook shape, parsing the report, and turning the
// report into the four results the step dialog shows. Evidence from Claude
// Code, not proof: someone holding a live work token could post the same
// request by hand.
//
// terminal/shared/own-agent-hook.mjs is the bridge's copy of the hook shape;
// own-agent.test.ts keeps the two identical.

export const OWN_AGENT_HOOK_MATCHER = "^mcp__.+__(save_step_output|add_step_comment|add_task_comment)$";
export const OWN_AGENT_HOOK_PATH = "/api/workflow/attest";
export const OWN_AGENT_HOOK_TIMEOUT_SECONDS = 5;
/** Bump when the hook changes: it is mixed into every agent's tag so saved copies re-sync once. */
export const OWN_AGENT_HOOK_VERSION = 1;

export type OwnAgentHooks = {
  PreToolUse: { matcher: string; hooks: { type: "http"; url: string; timeout: number }[] }[];
};

export type RanInOwnAgent = "confirmed" | "other_agent" | "not_confirmed" | "cant_confirm";

/** The app's own origin: NEXT_PUBLIC_APP_URL, blank-safe, no trailing slash. */
export function appOrigin(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/+$/, "") || "https://vibecodes.co.uk";
}

export function buildOwnAgentHooks(origin: string = appOrigin()): OwnAgentHooks {
  return {
    PreToolUse: [
      {
        matcher: OWN_AGENT_HOOK_MATCHER,
        hooks: [
          { type: "http", url: `${origin.replace(/\/+$/, "")}${OWN_AGENT_HOOK_PATH}`, timeout: OWN_AGENT_HOOK_TIMEOUT_SECONDS },
        ],
      },
    ],
  };
}

export type AttestReport = {
  agentType: string;
  agentId: string | null;
  toolName: string;
  workToken: string;
  stepId: string | null;
  taskId: string | null;
};

const MATCHER_RE = new RegExp(OWN_AGENT_HOOK_MATCHER);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function str(v: unknown, max: number): string | null {
  return typeof v === "string" && v.length > 0 && v.length <= max ? v : null;
}

/** Validates a Claude Code PreToolUse event. Returns null for anything that is not a usable report. */
export function parseAttestPayload(json: unknown): AttestReport | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const p = json as Record<string, unknown>;
  if (p.hook_event_name !== "PreToolUse") return null;
  const agentType = str(p.agent_type, 200);
  if (!agentType) return null;
  const toolName = str(p.tool_name, 200);
  if (!toolName || !MATCHER_RE.test(toolName)) return null;
  const input = p.tool_input;
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const i = input as Record<string, unknown>;
  const workToken = str(i.work_token, 200);
  if (!workToken || !workToken.startsWith("wt_")) return null;
  const stepId = typeof i.step_id === "string" && UUID_RE.test(i.step_id) ? i.step_id : null;
  const taskId = typeof i.task_id === "string" && UUID_RE.test(i.task_id) ? i.task_id : null;
  if (!stepId && !taskId) return null;
  return { agentType, agentId: str(p.agent_id, 200), toolName, workToken, stepId, taskId };
}

/** True for a board-agent subagent name of this bot: `vc-<slug>-<first 8 of bot id>[-<tier>][-<effort>]`. */
export function isNamedAgentFor(subagentType: string, botId: string): boolean {
  const id8 = botId.replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase();
  if (!id8) return false;
  return new RegExp(`^vc-[a-z0-9-]*-${id8}(-[a-z]+)*$`).test(subagentType.trim().toLowerCase());
}

export function resolveRanInOwnAgent(args: {
  agent: "claude" | "codex";
  botId: string | null;
  /** True only when the claim named a board agent for this step (see claimNamedNativeSubagent). */
  nativeNamed: boolean;
  attestedType: string | null;
}): RanInOwnAgent {
  if (args.agent === "codex") return "cant_confirm";
  if (!args.botId || !args.nativeNamed) return "cant_confirm";
  if (!args.attestedType) return "not_confirmed";
  return isNamedAgentFor(args.attestedType, args.botId) ? "confirmed" : "other_agent";
}

/** Review, QA, testing and audit steps, where an independent agent is the point. */
export function isReviewStep(agentRole: string | null | undefined): boolean {
  return !!agentRole && /\b(review|reviewer|qa|test|tester|testing|audit|auditor)\b/i.test(agentRole);
}
