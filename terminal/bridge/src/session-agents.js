// The board's agents as real subagents — the bridge's side. The app builds
// the definitions (src/lib/terminal/session-agents.ts) and serves them from
// POST /api/terminal/session/agents; the bridge fetches them off-relay with
// its own token (the same channel as the E2EE key) and hands them to the CLI
// at launch, so each workflow step's persona is the subagent's real
// instructions, not text pasted into its task.
//
// Claude Code (task 59889027): `claude --agents <json>`. Nothing is written to
// disk; Claude Code keeps those definitions for that launch only, so a resumed
// conversation has lost them and is handed them again (same for Codex below).
//
// Codex (task e16d69e8): Codex can only read a custom agent's instructions
// from a role file — `[agents.<name>]` config takes just description,
// config_file and nickname_candidates, and its spawn tool has no instructions
// field (codex-rs agent_role_config.rs / multi_agents_spec.rs, 0.153.4). So
// the bridge writes one TOML role file per agent into a private temp folder
// (outside the project and ~/.codex), points Codex at each with
// `-c agents.<name>.config_file=<path>`, and deletes the folder when the
// session ends. Nick agreed to temporary files on 11 Oct 2026.
//
// Pure so it's unit-testable without a PTY (same idiom as resume-cmd.js); the
// file writing itself lives in index.js.

/** Mirrors SESSION_AGENTS_MAX_BYTES app-side; argv on macOS allows ~1 MB. */
export const SESSION_AGENTS_MAX_BYTES = 200_000;

const AGENT_NAME = /^vc-[a-z0-9-]{1,80}$/;
const SAFE_SETTING = /^[a-z0-9._\-]{1,40}$/i;
// A Claude Code tool name (Edit, Write, NotebookEdit …). The only extra field a
// definition may carry (task 472d5672): tools a Read-only agent can't use.
const TOOL_NAME = /^[A-Z][A-Za-z0-9_]{0,63}$/;
const MAX_DISALLOWED_TOOLS = 10;
// A definition's own memory limit (task 5e654dd1): board agents keep the full
// size. Mirrors AUTO_COMPACT_MIN / MAX in auto-compact.js.
const AGENT_WINDOW_MIN = 100_000;
const AGENT_WINDOW_MAX = 1_000_000;

/**
 * Validate the endpoint's `{ agents }` body. Anything unexpected — wrong
 * shape, a name outside the `vc-` namespace, an oversized payload — returns
 * null, and the session launches exactly as it did before.
 * @param {unknown} body
 * @returns {Record<string, { description: string, prompt: string, model?: string, effort?: string, disallowedTools?: string[], autoCompactWindow?: number }> | null}
 */
export function validateSessionAgents(body) {
  const agents = body && typeof body === "object" ? /** @type {any} */ (body).agents : null;
  if (!agents || typeof agents !== "object" || Array.isArray(agents)) return null;
  const clean = {};
  for (const [name, def] of Object.entries(agents)) {
    if (!AGENT_NAME.test(name) || !def || typeof def !== "object") return null;
    const { description, prompt, model, effort, disallowedTools, autoCompactWindow } = /** @type {any} */ (def);
    if (typeof description !== "string" || typeof prompt !== "string" || !prompt.trim()) return null;
    if (model !== undefined && (typeof model !== "string" || !SAFE_SETTING.test(model))) return null;
    if (effort !== undefined && (typeof effort !== "string" || !SAFE_SETTING.test(effort))) return null;
    if (
      disallowedTools !== undefined &&
      (!Array.isArray(disallowedTools) ||
        disallowedTools.length < 1 ||
        disallowedTools.length > MAX_DISALLOWED_TOOLS ||
        !disallowedTools.every((t) => typeof t === "string" && TOOL_NAME.test(t)))
    ) {
      return null;
    }
    if (
      autoCompactWindow !== undefined &&
      (typeof autoCompactWindow !== "number" ||
        !Number.isInteger(autoCompactWindow) ||
        autoCompactWindow < AGENT_WINDOW_MIN ||
        autoCompactWindow > AGENT_WINDOW_MAX)
    ) {
      return null;
    }
    clean[name] = {
      description,
      prompt,
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
      ...(disallowedTools ? { disallowedTools } : {}),
      ...(autoCompactWindow ? { autoCompactWindow } : {}),
    };
  }
  if (Object.keys(clean).length === 0) return null;
  return Buffer.byteLength(JSON.stringify(clean), "utf8") <= SESSION_AGENTS_MAX_BYTES ? clean : null;
}

/**
 * Claude Code: the validated payload as one `--agents` argv value.
 * @param {unknown} body
 * @returns {string | null}
 */
export function serializeSessionAgents(body) {
  const clean = validateSessionAgents(body);
  return clean ? JSON.stringify(clean) : null;
}

/**
 * A TOML basic string. JSON string escapes (\" \\ \b \f \n \r \t \uXXXX) are
 * all valid TOML; DEL is the one control character JSON leaves raw that TOML
 * forbids in a basic string.
 * @param {string} value
 */
export function tomlString(value) {
  return JSON.stringify(value).replace(/\u007f/g, "\\u007F");
}

/**
 * Codex: one role file per agent — `name`, `description` and
 * `developer_instructions` (required by Codex), plus the tier's model and
 * effort when the step has one. Untiered agents inherit the session's.
 * @param {unknown} body
 * @returns {{ name: string, fileName: string, toml: string }[] | null}
 */
export function codexAgentFiles(body) {
  const clean = validateSessionAgents(body);
  if (!clean) return null;
  return Object.entries(clean).map(([name, def]) => ({
    name,
    fileName: `${name}.toml`,
    toml:
      [
        `name = ${tomlString(name)}`,
        `description = ${tomlString(def.description)}`,
        `developer_instructions = ${tomlString(def.prompt)}`,
        ...(def.model ? [`model = ${tomlString(def.model)}`] : []),
        ...(def.effort ? [`model_reasoning_effort = ${tomlString(def.effort)}`] : []),
      ].join("\n") + "\n",
  }));
}

/**
 * Codex: the launch flags that register each written role file. Each `-c`
 * value is its own argv element, never shell-split.
 * @param {{ name: string, path: string }[]} written
 * @returns {string[]}
 */
export function codexAgentConfigArgs(written) {
  return written.flatMap(({ name, path }) => ["-c", `agents.${name}.config_file=${tomlString(path)}`]);
}

/**
 * The argv for pty.spawn: the command's own flags, then the agents flags, then
 * the prompt. The agents values and the prompt each travel as their own argv
 * elements — never through shellSplit — so their contents arrive as data.
 * @param {string[]} cmdArgs  the shell-split command after the binary
 * @param {string[]} agentArgs  `["--agents", json]` for Claude, the `-c` pairs for Codex, or []
 * @param {string} prompt
 * @returns {string[]}
 */
export function buildSpawnArgs(cmdArgs, agentArgs, prompt) {
  return [...cmdArgs, ...agentArgs, ...(prompt ? [prompt] : [])];
}

/**
 * Every Claude Code or Codex launch gets the board's agents — fresh or
 * resumed. A resumed conversation does NOT keep the agents it was first
 * started with: Claude's `--agents` are per launch, and Codex's role files
 * live in a temp folder deleted when the old bridge exits. Only an explicit
 * command override is never touched. (A resume carries no prompt, so the
 * caller must hold the spawn until the fetch finishes.)
 * @param {{ agent: string, explicitCmd: string | null }} launch
 */
export function wantsSessionAgents({ agent, explicitCmd }) {
  return (agent === "claude" || agent === "codex") && !explicitCmd;
}
