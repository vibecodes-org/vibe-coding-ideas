// Session-to-session messages (card f0a13bde), the bridge side: the hook
// listener Claude reports to, the check on an arriving message, and the two
// ways a message reaches Claude (typed when safe, otherwise handed over by the
// Stop hook). Everything that touches the world is passed in, so the tests
// drive it with fakes. Message text is never logged here.

import http from "node:http";
import { randomBytes } from "node:crypto";
import {
  encodePeerAckFrame,
  formatPeerMessage,
  verifyPeerFrame,
} from "../../shared/peer-message.mjs";
import { createPeerState, endTyping, joinHeld, onHook, onInput, onMessage, onTick, safeToSubmit } from "./peer-delivery.js";

export const SEND_TOOL_MATCHER = "^mcp__.+__(send_session_message|list_my_sessions)$";
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
 *   key: string | null, sid: string, agent: string, explicitCmd: boolean, envValue: string | null,
 *   writePty: (data: string) => void, sendAck: (frame: string) => void,
 *   log?: (level: string, msg: string, extra?: object) => void, now?: () => number,
 *   delay?: (ms: number) => Promise<void>,
 * }} deps
 */
export function createPeerBridge(deps) {
  const { key, sid, agent, explicitCmd, envValue, writePty, sendAck } = deps;
  const log = deps.log ?? (() => {});
  const now = deps.now ?? (() => Date.now());
  const delay = deps.delay ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  let state = createPeerState();
  const seen = new Set();
  /** @type {Array<() => void>} */
  let submitWaiters = [];

  function ack(id, outcome) {
    try {
      sendAck(encodePeerAckFrame(id, outcome));
    } catch (e) {
      log("warn", "peer ack failed", { err: String(e?.message || e) });
    }
  }

  function looseId(text) {
    try {
      const m = JSON.parse(text);
      return typeof m?.id === "string" && m.id.length <= 64 ? m.id : null;
    } catch {
      return null;
    }
  }

  async function typeNow(env) {
    // Bracketed paste keeps a multi-line body as ONE message; Enter is a
    // separate write, only when it is still safe.
    writePty(`\x1b[200~${formatPeerMessage(env.from, env.text)}\x1b[201~`);
    await delay(PASTE_SETTLE_MS);
    if (!safeToSubmit(state)) {
      log("warn", "peer message pasted but not submitted (state changed)", { id: env.id, phase: state.phase });
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
    /** The person's keystrokes (after decryption). */
    handleInput(bytes) {
      state = onInput(state, bytes);
    },

    /** An incoming peer-message text frame from the relay. */
    async handleFrame(text) {
      const idGuess = looseId(text);
      const reply = (outcome) => {
        if (idGuess) ack(idGuess, outcome);
      };
      if (!key) return reply("cannot-receive");
      const v = verifyPeerFrame({ key, text, sid, now: now(), seen });
      if (!v.ok) {
        log("warn", "peer message refused", { reason: v.reason });
        return reply("rejected");
      }
      seen.add(v.env.id);
      if (seen.size > 500) seen.delete(seen.values().next().value);
      if (agent !== "claude" || explicitCmd) return ack(v.env.id, "cannot-receive");

      const r = onMessage(state, { id: v.env.id, text: formatPeerMessage(v.env.from, v.env.text) }, now());
      state = r.state;
      if (r.decision === "full") return ack(v.env.id, "rate-limited");
      if (r.decision === "hold") return ack(v.env.id, "waiting");
      const outcome = await typeNow(v.env);
      ack(v.env.id, outcome);
    },

    /** A hook event from Claude; returns the JSON answer for Claude. */
    handleHook(json) {
      const name = typeof json?.hook_event_name === "string" ? json.hook_event_name : "";
      const r = onHook(
        state,
        { name, notification: json?.notification_type, stopHookActive: json?.stop_hook_active === true },
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
        log("info", "handing held peer messages to Claude", { count: r.block.length });
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
