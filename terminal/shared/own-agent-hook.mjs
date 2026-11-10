// The one hook a board agent's definition may carry (card 24936814).
//
// Each Claude board agent reports its board calls to the app, so the app can
// record that the step really ran in its own agent. The hook is an http hook
// (Claude Code POSTs the event; no command runs on the user's machine) that
// matches only the three board tools that carry a work token.
//
// The bridge keeps `hooks` on an agent only when it equals EXACTLY this shape
// for the app origin it fetched the agents from; anything else is dropped.
// src/lib/workflow/own-agent.ts holds the app's copy, and
// src/lib/workflow/own-agent.test.ts runs both over one table.

export const OWN_AGENT_HOOK_MATCHER = "^mcp__.+__(save_step_output|add_step_comment|add_task_comment)$";
export const OWN_AGENT_HOOK_PATH = "/api/workflow/attest";
export const OWN_AGENT_HOOK_TIMEOUT_SECONDS = 5;

/**
 * @param {string} origin e.g. "https://vibecodes.co.uk" (a trailing slash is ignored)
 */
export function expectedOwnAgentHooks(origin) {
  return {
    PreToolUse: [
      {
        matcher: OWN_AGENT_HOOK_MATCHER,
        hooks: [
          {
            type: "http",
            url: `${String(origin).replace(/\/+$/, "")}${OWN_AGENT_HOOK_PATH}`,
            timeout: OWN_AGENT_HOOK_TIMEOUT_SECONDS,
          },
        ],
      },
    ],
  };
}

/**
 * True only when `hooks` is exactly the expected shape for `origin`: one
 * PreToolUse entry, the fixed matcher, one http hook to the app's own attest
 * URL, a timeout of 1 to 10, no other keys anywhere.
 * @param {unknown} hooks
 * @param {string} origin
 */
export function hooksMatchOwnAgentShape(hooks, origin) {
  if (typeof origin !== "string" || !origin) return false;
  const exact = (obj, keys) =>
    obj && typeof obj === "object" && !Array.isArray(obj) &&
    Object.keys(obj).length === keys.length && keys.every((k) => k in obj);
  if (!exact(hooks, ["PreToolUse"])) return false;
  const pre = hooks.PreToolUse;
  if (!Array.isArray(pre) || pre.length !== 1) return false;
  const entry = pre[0];
  if (!exact(entry, ["matcher", "hooks"]) || entry.matcher !== OWN_AGENT_HOOK_MATCHER) return false;
  if (!Array.isArray(entry.hooks) || entry.hooks.length !== 1) return false;
  const hook = entry.hooks[0];
  if (!exact(hook, ["type", "url", "timeout"])) return false;
  const want = expectedOwnAgentHooks(origin).PreToolUse[0].hooks[0];
  if (hook.type !== "http" || hook.url !== want.url) return false;
  return Number.isInteger(hook.timeout) && hook.timeout >= 1 && hook.timeout <= 10;
}
