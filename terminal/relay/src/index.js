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
  RECONNECT_GRACE_MS,
  idleCloseReason,
  maxCloseReason,
  resolveMs,
} from "./pairing.js";
import { shouldPersistActivity, DEFAULT_ACTIVITY_PERSIST_THROTTLE_MS } from "./activity-throttle.js";
import { authorizeAttach, authorizeControl } from "../../shared/session-token.mjs";
import {
  encodeAttachedFrame,
  encodePeerDegradedFrame,
  encodePeerReattachedFrame,
  encodeHeartbeatFrame,
  encodeHeartbeatAckFrame,
  isHeartbeatFrame,
  encodeBridgeVersionFrame,
  sanitizeHelperVersion,
} from "../../shared/control-frames.mjs";

/** Normal WebSocket closure code used for clean, server-initiated session ends. */
const NORMAL_CLOSURE = 1000;

/** @param {unknown} body @param {number} status @returns {Response} */
function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

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

    // Multi-session stage 3 (My-sessions "End" / "End all"): a plain HTTP POST,
    // not a WebSocket upgrade — dispatch it BEFORE the Upgrade-header gate
    // below. Auth (the control token) is checked inside the DO, where the
    // session's live state actually lives; here we only need a shape-valid
    // session id to route to the right DO instance (same as the WS path).
    if (url.pathname === "/end" && request.method === "POST") {
      const session = url.searchParams.get("session");
      if (!isValidSession(session)) {
        return jsonResponse({ ended: false, reason: "bad-session" }, 400);
      }
      const id = env.TERMINAL_RELAY.idFromName(session);
      const stub = env.TERMINAL_RELAY.get(id);
      return stub.fetch(request);
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
    //
    // EXCEPTION (MITIGATION 1 — Cloudflare free-tier op budget): two per-wake
    // SOFT CACHES, deliberately not durable. Losing them on eviction only costs
    // one extra storage op on the next wake — never a correctness issue:
    //   - `_lastPersistedActivityAt` throttles how often webSocketMessage
    //     actually WRITES lastActivityAt + re-arms the alarm (see
    //     shouldPersistActivity below). Worst case after a fresh wake: one
    //     extra persisted write.
    //   - `_sessionStartedAtCache` mirrors `sessionStartedAt`, which is
    //     write-once for the life of a session (see fetch() attach path) and
    //     only ever cleared by clearSessionState(), which also resets this
    //     cache — so it can never go stale while a session is live.
    this._lastPersistedActivityAt = null;
    this._sessionStartedAtCache = null;

    // App-level HEARTBEAT echo (fix/terminal-dock-heartbeat): answer the browser
    // dock's `{"t":"hb"}` liveness probe with `{"t":"hb-ack"}` WITHOUT waking the
    // DO (hibernation-safe auto-response). Deliberately NOT routed through
    // webSocketMessage: a heartbeat is never forwarded to the peer and never
    // stamps lastActivityAt, so the 30-min idle cap is unaffected by an
    // open-but-idle dock. If the runtime lacks auto-response, the belt-and-braces
    // intercept in webSocketMessage below still answers (with a DO wake).
    try {
      const Pair = globalThis.WebSocketRequestResponsePair;
      if (Pair) {
        this.state.setWebSocketAutoResponse(new Pair(encodeHeartbeatFrame(), encodeHeartbeatAckFrame()));
      }
    } catch (e) {
      this.log("heartbeat auto-response unavailable", { err: String(e) });
    }
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

  /** Reconnect grace window in ms (env override → shared default). */
  graceMs() {
    return resolveMs(this.env.TERMINAL_RECONNECT_GRACE_MS, RECONNECT_GRACE_MS);
  }

  /** Activity-persist throttle window in ms (env override → default). MITIGATION 1. */
  activityThrottleMs() {
    return resolveMs(this.env.TERMINAL_ACTIVITY_THROTTLE_MS, DEFAULT_ACTIVITY_PERSIST_THROTTLE_MS);
  }

  /** Send a control frame to EVERY live leg (used for peer-reattached). */
  broadcast(frame) {
    for (const ws of this.state.getWebSockets()) {
      try {
        ws.send(frame);
      } catch { /* leg already closing */ }
    }
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

  /**
   * Multi-session stage 3 — My-sessions "End" / "End all" (C3, F5). A
   * lifecycle-only HTTP action: authorize the control token, then close both
   * legs exactly like an idle/max-duration end (same `endSession` helper, same
   * NORMAL_CLOSURE code) — no content buffering, inspection, or logging beyond
   * the metadata every other path here already logs (AC20/F3).
   * @param {Request} request @param {URL} url
   */
  async handleEnd(request, url) {
    const session = url.searchParams.get("session");
    const authHeader = request.headers.get("Authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const auth = await authorizeControl({ token, secret: this.env.TERMINAL_SESSION_SECRET, session });
    if (!auth.ok) {
      this.log("end rejected (auth)", { session, reason: auth.reason });
      return jsonResponse({ ended: false, reason: "unauthorized" }, 401);
    }

    const state = await this.computeAttachState();
    if (!state.bridge && !state.browser) {
      // Nothing live to end — an honest, non-probing 200 (the caller already
      // proved authorization via the control token, so there is no liveness
      // leak in telling them truthfully that there's nothing here).
      this.log("end: no live session", { session });
      return jsonResponse({ ended: false, reason: "no-session" }, 200);
    }

    await this.endSession("ended-by-user");
    this.log("end: session ended", { session });
    return jsonResponse({ ended: true }, 200);
  }

  /** @param {Request} request */
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/end" && request.method === "POST") {
      return this.handleEnd(request, url);
    }
    const role = url.searchParams.get("role");
    const session = url.searchParams.get("session");
    const token = url.searchParams.get("token");

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    // 1) Authenticate the leg: verify the app-minted token's signature + expiry and
    //    that its `sid`/`role` claims match THIS connection. Never log the token.
    //    The durable owner binding is read FIRST and handed to authorizeAttach so a
    //    same-owner reattach to a LIVE session is accepted even after the token's
    //    TTL lapsed (fix/terminal-expired-reattach) — establishment (no bound
    //    owner) and foreign subs still require an unexpired token.
    const boundOwner = (await this.state.storage.get("owner")) ?? null;
    const auth = await authorizeAttach({
      token,
      secret: this.env.TERMINAL_SESSION_SECRET,
      session,
      role,
      boundOwner,
      maxSessionMs: this.maxMs(),
    });
    if (!auth.ok) {
      this.log("attach rejected (auth)", { session, role, reason: auth.reason, code: CLOSE.BAD_TOKEN.code });
      // Reject with a close FRAME (not an HTTP error) so the client sees the code.
      // A rejected leg never joins hibernation — plain accept + close.
      server.accept();
      server.close(CLOSE.BAD_TOKEN.code, CLOSE.BAD_TOKEN.reason);
      return new Response(null, { status: 101, webSocket: client });
    }
    if (auth.expired) {
      // Metadata only — never token material.
      this.log("attach authorized with expired token (reattach waiver)", { session, role });
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

    // 2b) Same-owner PREEMPTION (browser: fix/terminal-dock-heartbeat; bridge:
    //     fix/terminal-bridge-zombie-preemption): decideAttach accepted this leg
    //     OVER a still-registered socket of the same role — after a silent link
    //     death (wifi off; macOS never RSTs) the dead socket lingers OPEN forever
    //     and used to block every reattach with DUP_BROWSER / DUP_BRIDGE. Close
    //     the stale leg(s) BEFORE accepting the new one so single-attach holds
    //     post-swap; handleDetach sees the pair still whole and skips the grace
    //     hold. Foreign owners never reach here (owner check above).
    if (decision.preempt) {
      for (const stale of this.state.getWebSockets(`role:${role}`)) {
        try {
          stale.close(CLOSE.PREEMPTED.code, CLOSE.PREEMPTED.reason);
        } catch { /* already closing */ }
      }
      this.log("stale leg preempted", { session, role });
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
    let sessionStartedAt = await this.state.storage.get("sessionStartedAt");
    if (sessionStartedAt == null) {
      sessionStartedAt = now;
      await this.state.storage.put("sessionStartedAt", now);
    }
    // MITIGATION 1: sessionStartedAt is write-once for the session's life — cache
    // it now so armAlarm() below (and every later call, until clearSessionState())
    // can skip re-fetching it.
    this._sessionStartedAtCache = sessionStartedAt;
    await this.state.storage.put("lastActivityAt", now);
    this._lastPersistedActivityAt = now;

    // 4b) GRACE-WINDOW REATTACH reconciliation. If the session was being HELD open
    //     for a dropped leg (graceDeadline set), this attach may complete the pair
    //     again. When BOTH legs are present once more, clear the grace hold and
    //     tell BOTH legs to resume (peer-reattached). If only one leg is back (the
    //     both-legs-dropped case), keep holding and wait for the other. The owner
    //     binding was never released, so decideAttach above already enforced
    //     same-owner + single-attach on this reattach — a foreign sub was rejected.
    const wasHeld = (await this.state.storage.get("graceDeadline")) != null;
    const post = await this.computeAttachState();
    const pairWhole = post.bridge && post.browser;
    if (wasHeld && pairWhole) {
      await this.state.storage.delete("graceDeadline");
      this.log("reattached — pair whole again", { session, role });
    }
    await this.armAlarm(now);

    // 5) R1 attach confirmation — BRIDGE leg only. A rejected leg is also
    //    accept()ed then closed (see steps 1–2), so the bridge cannot treat its
    //    own `onopen` as proof of auth; this frame, sent strictly AFTER
    //    authorizeAttach + decideAttach passed, is the signal a prompt-carrying
    //    bridge waits on before spawning the PTY. The browser dock ignores TEXT
    //    frames, and old bridges log-and-ignore unknown control frames, so this
    //    is version-skew safe.
    if (role === "bridge") {
      try {
        server.send(encodeAttachedFrame());
      } catch (e) {
        this.log("attached-frame send failed", { session, err: String(e) });
      }
    }

    // 5b) HELPER-VERSION ANNOUNCEMENT (release-gate rework 2a). Ordering-independent
    //     both ways:
    //       - bridge attaches with a (sanitized) `helperVersion` query param → store
    //         it durably (attach-ordering independent: outlives this one socket) and,
    //         if a browser leg is ALREADY live, tell it now.
    //       - browser attaches → if a bridge version is already on file (the bridge
    //         attached first, or this is a reattach), tell THIS leg immediately.
    //     A missing/malformed param is a no-op either way (old bridge, or nothing to
    //     report yet) — never overwrites a previously-stored version with nothing.
    if (role === "bridge") {
      const helperVersion = sanitizeHelperVersion(url.searchParams.get("helperVersion"));
      if (helperVersion) {
        await this.state.storage.put("bridgeHelperVersion", helperVersion);
        const browserPeer = this.findPeer("bridge");
        if (browserPeer) {
          try {
            browserPeer.send(encodeBridgeVersionFrame(helperVersion));
          } catch (e) {
            this.log("bridge-version forward failed", { session, err: String(e) });
          }
        }
      }
    } else if (role === "browser") {
      const bridgeHelperVersion = await this.state.storage.get("bridgeHelperVersion");
      if (bridgeHelperVersion) {
        try {
          server.send(encodeBridgeVersionFrame(bridgeHelperVersion));
        } catch (e) {
          this.log("bridge-version send failed", { session, err: String(e) });
        }
      }
    }

    // 6) If this attach restored the pair inside the grace window, tell BOTH legs
    //    to resume. Sent AFTER the bridge's own `attached` frame; both are no-ops
    //    for a leg that doesn't know them (skew-safe).
    if (wasHeld && pairWhole) {
      this.broadcast(encodePeerReattachedFrame());
    }

    this.log("attached", { session, role, ...post });
    return new Response(null, { status: 101, webSocket: client });
  }

  // ── Hibernation handlers (called by the runtime; the DO may have just woken) ──

  /**
   * @param {WebSocket} ws
   * @param {string|ArrayBuffer} message
   */
  async webSocketMessage(ws, message) {
    // HEARTBEAT intercept (belt-and-braces): normally the auto-response pair set
    // in the constructor answers `{"t":"hb"}` without this handler ever running.
    // If auto-response is unavailable at runtime, echo the ack here — BEFORE the
    // forward (a heartbeat never reaches the peer) and BEFORE the activity stamp
    // (heartbeats must not extend the idle clock).
    if (typeof message === "string" && isHeartbeatFrame(message)) {
      try {
        ws.send(encodeHeartbeatAckFrame());
      } catch { /* leg already closing */ }
      return;
    }

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

    // Record activity + re-arm the idle/max alarm to the next deadline — but
    // THROTTLED (MITIGATION 1 — Cloudflare free-tier op budget): unconditionally
    // doing this per forwarded message was ~5 DO ops/message (1 put + armAlarm's
    // 3 gets + 1 setAlarm), which blows through the 100k-req/day + 100k-rows/day
    // free caps at chat speed. `lastActivityAt` only feeds the idle-timeout alarm
    // (30-min default) — a few seconds of staleness is harmless, so we only
    // persist + re-arm once per activityThrottleMs() (default 5s). Heartbeats
    // never reach here (handled above) and are unaffected either way.
    const now = Date.now();
    if (shouldPersistActivity(now, this._lastPersistedActivityAt, this.activityThrottleMs())) {
      this._lastPersistedActivityAt = now;
      await this.state.storage.put("lastActivityAt", now);
      await this.armAlarm(now);
    }
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
   * One leg went away. GRACE-WINDOW REATTACH (fix/terminal-reconnect-reattach):
   * instead of tearing the whole session down on ANY single detach, HOLD it open
   * for the reconnect grace window so the dropped role can re-attach (same sid +
   * owner) and resume with no token re-mint. Two cases:
   *
   *   - a leg is STILL attached (the survivor) → mark the session degraded
   *     (graceDeadline), keep the owner binding + the surviving socket, arm the
   *     grace alarm, and tell the survivor via `peer-degraded` — do NOT close it.
   *   - BOTH legs are now gone (e.g. sleep drops both 1006) → still keep the
   *     session + owner + grace alarm for the window so EITHER leg can come back
   *     and wait for the other.
   *
   * Only when the grace alarm fires still-incomplete does the old teardown run
   * (survivor PEER_GONE + clearSessionState) — see alarm() → endGrace().
   * @param {WebSocket} ws @param {string} why @param {object} [extra]
   */
  async handleDetach(ws, why, extra = {}) {
    let role = null;
    try {
      role = ws.deserializeAttachment()?.role ?? null;
    } catch { /* attachment may be gone */ }
    this.log("detached", { role, why, ...extra });

    // Survivors, excluding the closing socket (it may still appear in the list).
    const surviving = { bridge: false, browser: false };
    const survivorSockets = [];
    for (const peer of this.state.getWebSockets()) {
      if (peer === ws) continue;
      survivorSockets.push(peer);
      try {
        const peerRole = peer.deserializeAttachment()?.role;
        if (peerRole === "bridge" || peerRole === "browser") surviving[peerRole] = true;
      } catch { /* attachment may be gone */ }
    }

    // PREEMPTION swap (fix/terminal-dock-heartbeat): the closing socket was
    // already REPLACED — a same-owner attach closed it and both roles are still
    // live. Nothing dropped, so there is nothing to hold a grace window for;
    // opening one here would wrongly suspend the idle cap for the whole window.
    if (surviving.bridge && surviving.browser) {
      this.log("detach superseded — pair still whole", { role, why });
      return;
    }

    const now = Date.now();
    // Open (or keep) the grace hold; the grace alarm governs teardown from here.
    if ((await this.state.storage.get("graceDeadline")) == null) {
      await this.state.storage.put("graceDeadline", now + this.graceMs());
    }
    await this.armAlarm(now);

    // Tell any SURVIVING peer we're holding. We do NOT close survivors during
    // the window.
    for (const peer of survivorSockets) {
      try {
        peer.send(encodePeerDegradedFrame());
      } catch { /* already closing */ }
    }
    this.log("holding session for reconnect", { droppedRole: role, survivors: survivorSockets.length, graceMs: this.graceMs() });
  }

  // ── Idle / max-duration via DO alarms ────────────────────────────────────────

  /**
   * Arm the ONE alarm to the earliest live deadline: idle, max-duration, and — while
   * a reconnect grace window is open — the grace deadline. ONE alarm handler, earliest
   * deadline wins (coexists with the idle/max caps). Reads lastActivityAt from storage
   * so it stays correct whether called on fresh activity (now === last) or a defensive
   * re-arm (stored last is older).
   *
   * MITIGATION 1: `sessionStartedAt` is served from `_sessionStartedAtCache`
   * when available — it's write-once for a session's life (see fetch()'s
   * attach path) and the cache is reset only by clearSessionState(), so this
   * can never observe a stale value while the session is live. `lastActivityAt`
   * and `graceDeadline` are still read fresh every call: both can change
   * outside this method (grace is set/cleared in several places; lastActivityAt
   * is now throttled — see webSocketMessage) so a cache here could go stale.
   */
  async armAlarm(now) {
    if (this._sessionStartedAtCache == null) {
      this._sessionStartedAtCache = (await this.state.storage.get("sessionStartedAt")) ?? now;
    }
    const started = this._sessionStartedAtCache;
    const last = (await this.state.storage.get("lastActivityAt")) ?? now;
    const grace = await this.state.storage.get("graceDeadline");
    const candidates = [last + this.idleMs(), started + this.maxMs()];
    if (grace != null) candidates.push(grace);
    await this.state.storage.setAlarm(Math.min(...candidates));
  }

  /** Hibernation-compatible alarm: enforce the lifecycle caps / grace expiry, or re-arm. */
  async alarm() {
    const now = Date.now();
    const started = await this.state.storage.get("sessionStartedAt");
    const last = await this.state.storage.get("lastActivityAt");
    const grace = await this.state.storage.get("graceDeadline");

    if (started != null && now - started >= this.maxMs()) {
      this.log("session ended", { why: "max-duration", ageMs: now - started });
      return this.endSession(maxCloseReason(this.maxMs()));
    }

    // Reconnect grace expiry: the held-open session never became whole again inside
    // the window → the OLD teardown (survivor PEER_GONE + clearSessionState).
    if (grace != null && now >= grace) {
      const st = await this.computeAttachState();
      if (st.bridge && st.browser) {
        // Defensive: became whole without fetch clearing the hold — recover, don't tear.
        await this.state.storage.delete("graceDeadline");
        await this.armAlarm(now);
        return;
      }
      this.log("reconnect grace expired — tearing down", { });
      return this.endGrace();
    }

    // Idle only governs a WHOLE session; a held (degraded) session has stale activity
    // by definition and is governed by the grace deadline above instead.
    if (grace == null && last != null && now - last >= this.idleMs()) {
      this.log("session ended", { why: "idle-timeout", idleMs: now - last });
      return this.endSession(idleCloseReason(this.idleMs()));
    }

    // Nothing due yet → re-arm to the next earliest deadline.
    if (started != null || last != null || grace != null) {
      await this.armAlarm(now);
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

  /** Grace window elapsed without a full reattach → the original teardown: any
   *  survivor gets PEER_GONE (4004) and all session state is released. */
  async endGrace() {
    for (const ws of this.state.getWebSockets()) {
      try {
        ws.close(CLOSE.PEER_GONE.code, CLOSE.PEER_GONE.reason);
      } catch { /* already closing */ }
    }
    await this.clearSessionState();
  }

  /** Release owner binding + lifecycle bookkeeping + grace hold + any pending alarm. */
  async clearSessionState() {
    await this.state.storage.delete([
      "owner",
      "sessionStartedAt",
      "lastActivityAt",
      "graceDeadline",
      "bridgeHelperVersion",
    ]);
    await this.state.storage.deleteAlarm();
    // MITIGATION 1: invalidate the per-wake soft caches so a LATER attach to
    // this same (possibly still-warm) DO instance doesn't reuse a stale
    // sessionStartedAt/throttle timestamp from the session that just ended.
    this._sessionStartedAtCache = null;
    this._lastPersistedActivityAt = null;
  }
}
