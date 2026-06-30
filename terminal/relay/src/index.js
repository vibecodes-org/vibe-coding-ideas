// VibeCodes Terminal Relay — Cloudflare Worker + Durable Object — SLICE 6
//
// One Durable Object instance per `session` id. It accepts two WebSocket legs —
// `bridge` (the local machine) and `browser` (the in-app terminal) — pairs them,
// and forwards bytes OPAQUELY in both directions. It never parses or logs stream
// content; only metadata (session id, role).
//
// Enforces SINGLE-ATTACH and OWNER-BINDING: a 2nd browser/bridge is rejected, and
// both legs must carry the same owner (`sub`).
//
// SLICE 6 — WebSocket Hibernation + lifecycle timers:
//   The DO uses the WebSocket HIBERNATION API (`state.acceptWebSocket` + the
//   `webSocket*` handler methods) so it can be EVICTED FROM MEMORY between
//   messages and stop billing duration while a session sits idle. Because instance
//   fields don't survive eviction, all session state is reconstructed from durable
//   sources on every wake-up:
//     - per-socket identity → `ws.serializeAttachment({ role, sub })` + tags
//       (`role:<role>`, `sub:<sub>`), read back via `getWebSockets(tag)` /
//       `deserializeAttachment()`.
//     - owner binding + lifecycle bookkeeping → `state.storage`.
//   Idle / max-duration limits are enforced with DO ALARMS (also
//   hibernation-compatible), so a forgotten session is closed cleanly instead of
//   living forever.
//
// Connect with:  wss://<host>/?session=<id>&role=<bridge|browser>&token=<jwt>
//
// Run locally (offline, no Cloudflare account):  npx wrangler dev
//
// The pairing / single-attach / lifecycle decision logic lives in ./pairing.js and
// is shared with the Node stand-in relay used by the automated tests, so both
// enforce identical rules.

import {
  decideAttach,
  isValidSession,
  CLOSE,
  DEFAULT_IDLE_MS,
  DEFAULT_MAX_MS,
  idleCloseReason,
  maxCloseReason,
  resolveMs,
} from "./pairing.js";
import { authorizeAttach } from "../../shared/session-token.mjs";

/** Normal WebSocket closure code used for clean, server-initiated session ends. */
const NORMAL_CLOSURE = 1000;

export default {
  /**
   * @param {Request} request
   * @param {{ TERMINAL_RELAY: DurableObjectNamespace }} env
   */
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/healthz") {
      return new Response("ok", { status: 200 });
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response(
        "VibeCodes terminal relay. Connect a WebSocket: /?session=<id>&role=<bridge|browser>",
        { status: 426 },
      );
    }

    const session = url.searchParams.get("session");
    // Cheap shape guard first (a malformed session id can't address a DO). FULL
    // token verification + owner-binding happens inside the Durable Object on WS
    // attach (see TerminalRelay.fetch).
    if (!isValidSession(session)) {
      return new Response(CLOSE.BAD_SESSION.reason, { status: 400 });
    }

    // Route every leg for a given session to the SAME Durable Object instance.
    const id = env.TERMINAL_RELAY.idFromName(session);
    const stub = env.TERMINAL_RELAY.get(id);
    return stub.fetch(request);
  },
};

export class TerminalRelay {
  /**
   * @param {DurableObjectState} state
   * @param {Record<string, unknown>} env
   */
  constructor(state, env) {
    this.state = state;
    this.env = env;
    // NOTE (hibernation): do NOT keep session state in instance fields — the DO
    // can be evicted between messages. Live sockets + state.storage are the only
    // durable sources, read on demand below.
  }

  /** @param {string} msg @param {object} [extra] */
  log(msg, extra = {}) {
    // Metadata only — never stream content.
    console.log(JSON.stringify({ comp: "relay", msg, ...extra }));
  }

  /** Idle cap in ms (env override → default). */
  idleMs() {
    return resolveMs(this.env.TERMINAL_IDLE_MS, DEFAULT_IDLE_MS);
  }

  /** Max session age in ms (env override → default). */
  maxMs() {
    return resolveMs(this.env.TERMINAL_MAX_MS, DEFAULT_MAX_MS);
  }

  /** The live peer socket for the opposite role, or null. Tag-driven so it works post-hibernation. */
  findPeer(role) {
    const peerTag = role === "bridge" ? "role:browser" : "role:bridge";
    return this.state.getWebSockets(peerTag)[0] ?? null;
  }

  /**
   * Current attachment state, derived from the LIVE hibernatable sockets + the
   * durable owner binding — the pure-logic input for decideAttach. This is how
   * single-attach/owner survive eviction: we never trust instance memory.
   * @returns {Promise<import("./pairing.js").AttachState>}
   */
  async computeAttachState() {
    const bridge = this.state.getWebSockets("role:bridge").length > 0;
    const browser = this.state.getWebSockets("role:browser").length > 0;
    const owner = (await this.state.storage.get("owner")) ?? null;
    return { bridge, browser, owner };
  }

  /** @param {Request} request */
  async fetch(request) {
    const url = new URL(request.url);
    const role = url.searchParams.get("role");
    const session = url.searchParams.get("session");
    const token = url.searchParams.get("token");

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    // 1) Authenticate the leg: verify the app-minted token's signature + expiry and
    //    that its `sid`/`role` claims match THIS connection. Never log the token.
    const auth = await authorizeAttach({
      token,
      secret: this.env.TERMINAL_SESSION_SECRET,
      session,
      role,
    });
    if (!auth.ok) {
      this.log("attach rejected (auth)", { session, role, reason: auth.reason, code: CLOSE.BAD_TOKEN.code });
      // Reject with a close FRAME (not an HTTP error) so the client sees the code.
      // A rejected leg never joins hibernation — plain accept + close.
      server.accept();
      server.close(CLOSE.BAD_TOKEN.code, CLOSE.BAD_TOKEN.reason);
      return new Response(null, { status: 101, webSocket: client });
    }

    // 2) Owner-binding + single-attach (pure), fed from LIVE sockets + durable owner.
    const state = await this.computeAttachState();
    const decision = decideAttach(state, role, auth.sub);
    if (!decision.ok) {
      this.log("attach rejected", { session, role, code: decision.code, reason: decision.reason });
      server.accept();
      server.close(decision.code, decision.reason);
      return new Response(null, { status: 101, webSocket: client });
    }

    // 3) Accept into HIBERNATION. Tag by role (+ sub) so the peer is findable and
    //    single-attach is re-derivable after the DO is evicted from memory.
    this.state.acceptWebSocket(server, [`role:${role}`, `sub:${auth.sub}`]);
    // Per-socket identity that survives hibernation (read via deserializeAttachment).
    server.serializeAttachment({ role, sub: auth.sub });

    // 4) Durable bookkeeping. Bind the owner on the first leg; stamp the session
    //    start + activity and arm the idle/max alarm.
    const now = Date.now();
    if (state.owner === null) await this.state.storage.put("owner", auth.sub);
    if ((await this.state.storage.get("sessionStartedAt")) == null) {
      await this.state.storage.put("sessionStartedAt", now);
    }
    await this.state.storage.put("lastActivityAt", now);
    await this.armAlarm(now);

    this.log("attached", { session, role, ...(await this.computeAttachState()) });
    return new Response(null, { status: 101, webSocket: client });
  }

  // ── Hibernation handlers (called by the runtime; the DO may have just woken) ──

  /**
   * @param {WebSocket} ws
   * @param {string|ArrayBuffer} message
   */
  async webSocketMessage(ws, message) {
    const att = ws.deserializeAttachment() || {};
    const role = att.role;
    if (role !== "bridge" && role !== "browser") return;

    // Forward verbatim + opaque. Never inspect or log the payload.
    const peer = this.findPeer(role);
    if (peer) {
      try {
        peer.send(message);
      } catch (e) {
        this.log("forward failed", { role, err: String(e) });
      }
    }
    // If no peer yet the frame is dropped (no buffering) — see slice-1 notes.

    // Record activity + re-arm the idle/max alarm to the next deadline.
    const now = Date.now();
    await this.state.storage.put("lastActivityAt", now);
    await this.armAlarm(now);
  }

  /**
   * @param {WebSocket} ws @param {number} code @param {string} reason @param {boolean} wasClean
   */
  async webSocketClose(ws, code, reason, wasClean) {
    await this.handleDetach(ws, "close", { code, wasClean });
  }

  /** @param {WebSocket} ws @param {unknown} error */
  async webSocketError(ws, error) {
    await this.handleDetach(ws, "error", { err: String(error) });
  }

  /**
   * One leg went away. Tell the surviving peer (PEER_GONE) and drop it so the
   * session id can be cleanly re-established, then release all session state.
   * @param {WebSocket} ws @param {string} why @param {object} [extra]
   */
  async handleDetach(ws, why, extra = {}) {
    let role = null;
    try {
      role = ws.deserializeAttachment()?.role ?? null;
    } catch { /* attachment may be gone */ }
    this.log("detached", { role, why, ...extra });

    // Close the surviving peer (the closing socket may still appear in the list).
    for (const peer of this.state.getWebSockets()) {
      if (peer === ws) continue;
      try {
        peer.close(CLOSE.PEER_GONE.code, CLOSE.PEER_GONE.reason);
      } catch { /* already closing */ }
    }
    // The session is now empty → release the owner binding + lifecycle state so a
    // fresh authorized owner can re-establish the id.
    await this.clearSessionState();
  }

  // ── Idle / max-duration via DO alarms ────────────────────────────────────────

  /** Arm the alarm to the nearest of (idle deadline, max-duration deadline). */
  async armAlarm(now) {
    const started = (await this.state.storage.get("sessionStartedAt")) ?? now;
    const next = Math.min(now + this.idleMs(), started + this.maxMs());
    await this.state.storage.setAlarm(next);
  }

  /** Hibernation-compatible alarm: enforce the lifecycle caps or re-arm. */
  async alarm() {
    const now = Date.now();
    const started = await this.state.storage.get("sessionStartedAt");
    const last = await this.state.storage.get("lastActivityAt");

    if (started != null && now - started >= this.maxMs()) {
      this.log("session ended", { why: "max-duration", ageMs: now - started });
      return this.endSession(maxCloseReason(this.maxMs()));
    }
    if (last != null && now - last >= this.idleMs()) {
      this.log("session ended", { why: "idle-timeout", idleMs: now - last });
      return this.endSession(idleCloseReason(this.idleMs()));
    }
    // Activity happened since the alarm was set (or no legs) → re-arm defensively.
    if (started != null || last != null) {
      const next = Math.min((last ?? now) + this.idleMs(), (started ?? now) + this.maxMs());
      await this.state.storage.setAlarm(next);
    }
  }

  /** Close BOTH legs with the normal code 1000 + lifecycle reason, then clear state. */
  async endSession(reason) {
    for (const ws of this.state.getWebSockets()) {
      try {
        ws.close(NORMAL_CLOSURE, reason);
      } catch { /* already closing */ }
    }
    await this.clearSessionState();
  }

  /** Release owner binding + lifecycle bookkeeping + any pending alarm. */
  async clearSessionState() {
    await this.state.storage.delete(["owner", "sessionStartedAt", "lastActivityAt"]);
    await this.state.storage.deleteAlarm();
  }
}
