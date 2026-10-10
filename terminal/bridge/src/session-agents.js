// The board's agents as real Claude Code subagents (task 59889027) — the
// bridge's side. The app builds the definitions (src/lib/terminal/
// session-agents.ts) and serves them from POST /api/terminal/session/agents;
// the bridge fetches them off-relay with its own token (the same channel as
// the E2EE key) and passes them as `claude --agents <json>`, so each workflow
// step's persona is the subagent's real system prompt. Nothing is written to
// disk: Claude Code keeps `--agents` definitions for that session only.
//
// Pure so it's unit-testable without a PTY (same idiom as resume-cmd.js).

/** Mirrors SESSION_AGENTS_MAX_BYTES app-side; argv on macOS allows ~1 MB. */
export const SESSION_AGENTS_MAX_BYTES = 200_000;

const AGENT_NAME = /^vc-[a-z0-9-]{1,80}$/;
const SAFE_SETTING = /^[a-z0-9.\-]{1,40}$/i;

/**
 * Validate the endpoint's `{ agents }` body and serialise it for argv. Anything
 * unexpected — wrong shape, a name outside the `vc-` namespace, an oversized
 * payload — returns null, and the session launches exactly as it did before.
 * @param {unknown} body
 * @returns {string | null}
 */
export function serializeSessionAgents(body) {
  const agents = body && typeof body === "object" ? /** @type {any} */ (body).agents : null;
  if (!agents || typeof agents !== "object" || Array.isArray(agents)) return null;
  const clean = {};
  for (const [name, def] of Object.entries(agents)) {
    if (!AGENT_NAME.test(name) || !def || typeof def !== "object") return null;
    const { description, prompt, model, effort } = /** @type {any} */ (def);
    if (typeof description !== "string" || typeof prompt !== "string" || !prompt.trim()) return null;
    if (model !== undefined && (typeof model !== "string" || !SAFE_SETTING.test(model))) return null;
    if (effort !== undefined && (typeof effort !== "string" || !SAFE_SETTING.test(effort))) return null;
    clean[name] = { description, prompt, ...(model ? { model } : {}), ...(effort ? { effort } : {}) };
  }
  if (Object.keys(clean).length === 0) return null;
  const json = JSON.stringify(clean);
  return Buffer.byteLength(json, "utf8") <= SESSION_AGENTS_MAX_BYTES ? json : null;
}

/**
 * The argv for pty.spawn. The agents JSON and the prompt each travel as ONE
 * argv element — never through shellSplit — so their contents arrive as data.
 * @param {string[]} cmdArgs  the shell-split command after the binary
 * @param {string | null} agentsJson
 * @param {string} prompt
 * @returns {string[]}
 */
export function buildSpawnArgs(cmdArgs, agentsJson, prompt) {
  return [...cmdArgs, ...(agentsJson ? ["--agents", agentsJson] : []), ...(prompt ? [prompt] : [])];
}

/**
 * Only a fresh Claude launch that carries a board prompt gets agents: a
 * resumed conversation keeps its own, Codex has no equivalent, an explicit
 * command override is never touched, and a promptless launch spawns before
 * any fetch could finish.
 * @param {{ agent: string, prompt: string, resume: boolean, resumeId: string | null, explicitCmd: string | null }} launch
 */
export function wantsSessionAgents({ agent, prompt, resume, resumeId, explicitCmd }) {
  return agent === "claude" && !!prompt && !resume && !resumeId && !explicitCmd;
}
