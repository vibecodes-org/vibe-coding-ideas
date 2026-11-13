// Session-to-session messages (card f0a13bde), the bridge side: the hook
// listener Claude and Codex report to, and the two ways a message passed on by
// the Mac app reaches the agent (typed when safe, otherwise handed over by the
// Stop hook). Everything that touches the world is passed in, so the tests
// drive it with fakes. Message text is never logged here.

import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { cleanPeerText, formatPeerMessage } from "../../shared/peer-message.mjs";
import { createPeerState, endTyping, joinHeld, onHook, onInput, onMessage, onTick, safeToSubmit } from "./peer-delivery.js";

// The one board tool that needs to know which session is calling: it gets the
// session's proof filled in, so the agent never has to look it up.
export const SEND_TOOL_MATCHER = "^mcp__.+__offer_next_card$";
const HOOK_TIMEOUT_SECONDS = 5;
const SUBMIT_WAIT_MS = 3000;
const PASTE_SETTLE_MS = 150;
const MAX_HOOK_BODY = 256 * 1024;

/**
 * The `--settings` JSON for a Claude launch: http hooks to this bridge's own
 * listener, nothing else. Claude merges these with the user's own hooks.
 * @param {number} port @param {string} secret
 */
export function buildHookSettings(port, secret) {
  const h = (name, matcher) => [
    {
      ...(matcher ? { matcher } : {}),
      hooks: [{ type: "http", url: `http://127.0.0.1:${port}/${secret}/${name}`, timeout: HOOK_TIMEOUT_SECONDS }],
    },
  ];
  return {
    hooks: {
      UserPromptSubmit: h("UserPromptSubmit"),
      Stop: h("Stop"),
      PostToolUse: h("PostToolUse"),
      Notification: h("Notification", "permission_prompt|idle_prompt"),
      PermissionRequest: h("PermissionRequest"),
      PreToolUse: h("PreToolUse", SEND_TOOL_MATCHER),
    },
  };
}

/** The extra launch arguments for Claude. */
export function hookSettingsArgs(port, secret) {
  return ["--settings", JSON.stringify(buildHookSettings(port, secret))];
}

// Codex: command hooks (Codex has no http hooks). The command is the same in
// every session; the listener's address arrives in this environment variable,
// so the command's fingerprint never changes. Hook failures print nothing and
// never block Codex.
export const CODEX_HOOK_ENV = "VIBECODES_PEER_HOOK";
export const CODEX_HOOK_COMMAND = `curl -s -m ${HOOK_TIMEOUT_SECONDS} -X POST -H 'content-type: application/json' --data-binary @- "$${CODEX_HOOK_ENV}" || true`;
const CODEX_HOOK_EVENTS = /** @type {const} */ ([
  ["UserPromptSubmit", "user_prompt_submit", null],
  ["Stop", "stop", null],
  ["PostToolUse", "post_tool_use", null],
  ["PermissionRequest", "permission_request", null],
  ["SessionStart", "session_start", null],
]);
// No PreToolUse hook for Codex: it passes its own session value to
// offer_next_card (the tool's instructions tell it how), and PostToolUse
// already says "busy".
// Where Codex files hooks passed on the command line (its "session flags").
const CODEX_FLAG_HOOK_SOURCE = "/<session-flags>/config.toml";

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}

/**
 * Codex runs a hook only once it is approved, and records the approval as the
 * hook's fingerprint. This is that fingerprint, computed the way Codex does
 * (sha256 of its key-sorted JSON form, unset fields left out, default timeout
 * 600s), so the launch can carry the approval for the bridge's own hooks and
 * the person never has to approve them by hand.
 * @param {string} eventLabel e.g. "stop" @param {string | null} matcher @param {string} command
 */
export function codexHookHash(eventLabel, matcher, command) {
  const identity = {
    event_name: eventLabel,
    ...(matcher ? { matcher } : {}),
    hooks: [{ type: "command", command, timeout: 600, async: false }],
  };
  return "sha256:" + createHash("sha256").update(JSON.stringify(sortKeys(identity))).digest("hex");
}

const tomlString = (s) => JSON.stringify(s);

/** The extra launch arguments for Codex: the hooks, then their approvals. */
export function codexHookArgs() {
  const args = [];
  const state = [];
  for (const [event, label, matcher] of CODEX_HOOK_EVENTS) {
    const m = matcher ? `matcher=${tomlString(matcher)},` : "";
    args.push("-c", `hooks.${event}=[{${m}hooks=[{type="command",command=${tomlString(CODEX_HOOK_COMMAND)}}]}]`);
    const key = `${CODEX_FLAG_HOOK_SOURCE}:${label}:0:0`;
    state.push(`${tomlString(key)}={trusted_hash=${tomlString(codexHookHash(label, matcher, CODEX_HOOK_COMMAND))}}`);
  }
  // One table: Codex reads a dotted -c path with a quoted key wrongly.
  args.push("-c", `hooks.state={${state.join(",")}}`);
  return args;
}

/** The listener address Codex's hook command posts to. */
export function codexHookUrl(port, secret) {
  return `http://127.0.0.1:${port}/${secret}/hook`;
}

/**
 * Loopback-only listener. Accepts only POST /<secret>/<event>, small JSON
 * bodies, and answers within the hook timeout.
 * @param {{ secret: string, onEvent: (json: any) => object, log?: Function }} opts
 * @returns {Promise<{ port: number, close: () => void }>}
 */
export function startHookServer({ secret, onEvent, log = () => {} }) {
  const server = http.createServer((req, res) => {
    const parts = (req.url || "").split("/");
    if (req.method !== "POST" || parts[1] !== secret) {
      res.statusCode = 404;
      res.end();
      return;
    }
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_HOOK_BODY) {
        res.statusCode = 413;
        res.end();
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      let json = {};
      try {
        json = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        json = {};
      }
      let out = {};
      try {
        out = onEvent(json) || {};
      } catch (e) {
        log("warn", "peer hook handler failed", { err: String(e?.message || e) });
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(out));
    });
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = /** @type {import("node:net").AddressInfo} */ (server.address());
      server.unref();
      resolve({ port: addr.port, close: () => server.close() });
    });
  });
}

export function newHookSecret() {
  return randomBytes(24).toString("hex");
}

/**
 * @param {{
 *   agent: string, explicitCmd: boolean, envValue: string | null,
 *   writePty: (data: string) => void, replyCommand: string,
 *   log?: (level: string, msg: string, extra?: object) => void, now?: () => number,
 *   delay?: (ms: number) => Promise<void>, startsIdle?: boolean,
 * }} deps  startsIdle: launched with no prompt, so the agent is idle once it has started.
 *          replyCommand: how this session's agent runs the message command (shown in the header).
 */
export function createPeerBridge(deps) {
  const { agent, explicitCmd, envValue, writePty, replyCommand } = deps;
  const canReceive = (agent === "claude" || agent === "codex") && !explicitCmd;
  const startsIdle = deps.startsIdle === true;
  const log = deps.log ?? (() => {});
  const now = deps.now ?? (() => Date.now());
  const delay = deps.delay ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  let state = createPeerState();
  /** @type {Array<() => void>} */
  let submitWaiters = [];

  async function typeNow(id, formatted) {
    // Bracketed paste keeps a multi-line body as ONE message; Enter is a
    // separate write, only when it is still safe.
    writePty(`\x1b[200~${formatted}\x1b[201~`);
    await delay(PASTE_SETTLE_MS);
    if (!safeToSubmit(state)) {
      log("warn", "peer message pasted but not submitted (state changed)", { id, phase: state.phase });
      state = endTyping(state, { pasted: true, submitted: false });
      return "unconfirmed";
    }
    const submitted = new Promise((resolve) => {
      submitWaiters.push(() => resolve(true));
    });
    writePty("\r");
    const ok = await Promise.race([submitted, delay(SUBMIT_WAIT_MS).then(() => false)]);
    state = endTyping(state, { pasted: true, submitted: ok });
    return ok ? "delivered" : "unconfirmed";
  }

  return {
    canReceive,

    /** The person's keystrokes (after decryption). */
    handleInput(bytes) {
      state = onInput(state, bytes);
    },

    /**
     * A message the Mac app passed on from another session on this Mac. The
     * sender details come from the Mac app, never from the sending agent.
     * @param {{ id: string, from: { sid: string, agent: string, folder?: string | null }, text: string }} msg
     * @returns {Promise<"delivered"|"unconfirmed"|"waiting"|"rate-limited"|"cannot-receive">}
     */
    async deliver(msg) {
      if (!canReceive) return "cannot-receive";
      const cleaned = cleanPeerText(msg?.text);
      if (!cleaned.ok) return "cannot-receive";
      const id = String(msg.id ?? "").slice(0, 64);
      // Session record: what happened to each incoming message (never its text).
      const phase = state.phase;
      const formatted = formatPeerMessage(msg.from, cleaned.text, replyCommand);
      const r = onMessage(state, { id, text: formatted }, now());
      state = r.state;
      if (r.decision === "full") {
        log("info", "peer message refused, too many waiting", { id, phase });
        return "rate-limited";
      }
      if (r.decision === "hold") {
        log("info", "peer message held until the session is free", { id, phase, held: state.inbox.length });
        return "waiting";
      }
      const outcome = await typeNow(id, formatted);
      log("info", "peer message typed in", { id, outcome });
      return outcome;
    },

    /** A hook event from Claude or Codex; returns the JSON answer for the agent. */
    handleHook(json) {
      const name = typeof json?.hook_event_name === "string" ? json.hook_event_name : "";
      const r = onHook(
        state,
        { name, notification: json?.notification_type, stopHookActive: json?.stop_hook_active === true, startsIdle },
        now(),
      );
      state = r.state;
      if (r.dropped.length) log("info", "held peer messages expired", { count: r.dropped.length });
      if (name === "UserPromptSubmit") {
        const w = submitWaiters;
        submitWaiters = [];
        for (const f of w) f();
      }
      if (name === "Stop" && r.block) {
        log("info", "handing held peer messages to the agent", { count: r.block.length });
        return { decision: "block", reason: joinHeld(r.block) };
      }
      if (name === "PreToolUse" && typeof json?.tool_name === "string" && new RegExp(SEND_TOOL_MATCHER).test(json.tool_name) && envValue) {
        return {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "allow",
            updatedInput: { ...(json.tool_input && typeof json.tool_input === "object" ? json.tool_input : {}), from_session: envValue },
          },
        };
      }
      return {};
    },

    tick() {
      const r = onTick(state, now());
      state = r.state;
      if (r.dropped.length) log("info", "held peer messages expired", { count: r.dropped.length });
    },

    /** For tests. */
    get state() {
      return state;
    },
  };
}
