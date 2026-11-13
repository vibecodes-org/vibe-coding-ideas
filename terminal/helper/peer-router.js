// Session-to-session messages (card f0a13bde), the Mac app's side: it knows
// every Claude Code and Codex session it is running, and passes a message from
// one to another. Messages never leave this Mac. The sender's name on a
// message comes from here, never from the sending agent. Message text is
// never logged.

"use strict";

const PER_MINUTE = 10;
const PER_HOUR = 60;
const AGENT_LABEL = { claude: "Claude Code", codex: "Codex" };

const RESULT_TEXT = {
  delivered: "Delivered: it was typed into that session.",
  waiting: "Delivered: that session is busy, so it will see the message as soon as it is free.",
  unconfirmed: "Passed to that session, but it couldn't confirm it was read. Don't resend unless it fails to answer.",
  "rate-limited": "Not sent: that session has had too many messages recently. Try again in a few minutes.",
  "cannot-receive": "Not sent: that session can't receive messages.",
  "not-running": "Not sent: that session isn't running any more.",
};

function short(sid) {
  return String(sid || "").slice(0, 8);
}

function describe(s) {
  const where = s.folder ? ` working in "${String(s.folder).replace(/["\n\r]/g, "'").slice(0, 80)}"` : "";
  return `${short(s.sid)}  ${AGENT_LABEL[s.agent] || s.agent}${where}${s.canReceive ? "" : "  (can't receive messages)"}`;
}

/**
 * @param {{ now?: () => number, log?: Function, deliverTimeoutMs?: number, newId?: () => string }} [opts]
 */
function createPeerRouter(opts = {}) {
  const now = opts.now || (() => Date.now());
  const log = opts.log || (() => {});
  const deliverTimeoutMs = opts.deliverTimeoutMs || 15000;
  let counter = 0;
  const newId = opts.newId || (() => `d${Date.now().toString(36)}${(counter++).toString(36)}`);

  /** key → { sid, agent, folder, canReceive, send } */
  const sessions = new Map();
  /** target sid → timestamps of messages passed to it */
  const sentTimes = new Map();
  /** rid → { targetKey, finish } */
  const pending = new Map();

  function reply(sender, reqId, status, body) {
    try {
      sender.send({ type: "peer-result", reqId, status, body });
    } catch (e) {
      log("warn", "couldn't answer a session's message request", { err: String((e && e.message) || e) });
    }
  }

  function overLimit(sid) {
    const t = now();
    const list = (sentTimes.get(sid) || []).filter((x) => t - x < 3600000);
    sentTimes.set(sid, list);
    return list.length >= PER_HOUR || list.filter((x) => t - x < 60000).length >= PER_MINUTE;
  }

  function list(fromKey, from) {
    const others = [...sessions.entries()].filter(([k]) => k !== fromKey).map(([, s]) => s);
    if (others.length === 0) {
      return "No other Claude Code or Codex sessions are running in the VibeCodes app on this Mac.";
    }
    const lines = [`You are session ${short(from.sid)}. Other sessions on this Mac:`, ...others.map(describe)];
    if (from.agent === "claude" && others.some((s) => s.agent === "claude")) {
      lines.push("For Claude Code sessions, use your built-in SendMessage tool instead.");
    }
    return lines.join("\n");
  }

  return {
    /** A bridge said who it is (again when its folder became known). */
    hello(key, msg, send) {
      if (!msg || typeof msg.sid !== "string" || !msg.sid || (msg.agent !== "claude" && msg.agent !== "codex")) return;
      sessions.set(key, {
        sid: msg.sid,
        agent: msg.agent,
        folder: typeof msg.folder === "string" && msg.folder ? msg.folder : null,
        canReceive: msg.canReceive === true,
        send,
      });
    },

    /** A bridge exited. */
    gone(key) {
      sessions.delete(key);
      for (const [rid, p] of pending) {
        if (p.targetKey === key) p.finish("not-running", rid);
      }
    },

    /** A session ran the message command. */
    request(key, msg, send) {
      const reqId = msg && typeof msg.reqId === "string" ? msg.reqId : "";
      const from = sessions.get(key);
      if (!from) {
        reply({ send }, reqId, "error", "The VibeCodes app doesn't know this session yet. Try again in a moment.");
        return;
      }
      if (msg.cmd === "list") {
        reply(from, reqId, "ok", list(key, from));
        return;
      }
      if (msg.cmd !== "send" || typeof msg.to !== "string" || typeof msg.text !== "string") {
        reply(from, reqId, "error", "Unknown command. Use list or send.");
        return;
      }
      const want = msg.to.trim().toLowerCase();
      if (want.length < 4) {
        reply(from, reqId, "error", "Give at least the first 4 characters of the session id (from the list command).");
        return;
      }
      const matches = [...sessions.entries()].filter(([, s]) => s.sid.toLowerCase().startsWith(want));
      if (matches.length === 0) {
        reply(from, reqId, "error", RESULT_TEXT["not-running"] + " Run list to see the sessions that are.");
        return;
      }
      if (matches.length > 1) {
        reply(from, reqId, "error", "More than one session starts with that id. Give more of it.");
        return;
      }
      const [targetKey, target] = matches[0];
      if (targetKey === key) {
        reply(from, reqId, "error", "That's this session. Pick another one from the list.");
        return;
      }
      if (from.agent === "claude" && target.agent === "claude") {
        reply(from, reqId, "error", "Both are Claude Code sessions: use your built-in SendMessage tool for this one.");
        return;
      }
      if (!target.canReceive) {
        reply(from, reqId, "error", RESULT_TEXT["cannot-receive"]);
        return;
      }
      if (overLimit(target.sid)) {
        reply(from, reqId, "error", RESULT_TEXT["rate-limited"]);
        return;
      }
      sentTimes.get(target.sid).push(now());
      const rid = newId();
      let done = false;
      const timer = setTimeout(() => finish("unconfirmed", rid), deliverTimeoutMs);
      if (timer.unref) timer.unref();
      function finish(outcome) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        pending.delete(rid);
        log("info", "session message passed on", { from: short(from.sid), to: short(target.sid), outcome });
        const ok = outcome === "delivered" || outcome === "waiting" || outcome === "unconfirmed";
        reply(from, reqId, ok ? "ok" : "error", RESULT_TEXT[outcome] || RESULT_TEXT.unconfirmed);
      }
      pending.set(rid, { targetKey, finish });
      try {
        target.send({
          type: "peer-deliver",
          rid,
          from: { sid: from.sid, agent: from.agent, folder: from.folder },
          text: msg.text,
        });
      } catch {
        finish("not-running");
      }
    },

    /** The receiving bridge said what happened. */
    outcome(msg) {
      const p = msg && typeof msg.rid === "string" ? pending.get(msg.rid) : null;
      if (p) p.finish(typeof msg.outcome === "string" ? msg.outcome : "unconfirmed");
    },

    /** For tests. */
    get size() {
      return sessions.size;
    },
  };
}

module.exports = { createPeerRouter, PER_MINUTE, PER_HOUR };
