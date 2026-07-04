// Plain-ws stand-in relay (Node) — for AUTOMATED testing.
//
// It is a faithful, lightweight twin of the Cloudflare Worker + Durable Object
// in ../relay/src/index.js: same opaque forwarding, same single-attach + owner
// rules, and (slice 6) the SAME idle / max-duration lifecycle limits and close
// codes/reasons — because it imports the SAME pure decision logic + reason
// builders (../relay/src/pairing.js). It does NOT hibernate (it's plain Node), so
// it uses plain setTimeout where the real DO uses storage alarms, but the
// observable behaviour (close code 1000 + idle/max reason) is identical.
//
// Why a stand-in: `wrangler dev` boots a full workerd runtime (slow, heavy, and
// can need a one-time binary download), which is a poor dependency for a fast,
// hermetic round-trip assertion. The real DO is exercised manually via
// `npx wrangler dev` (see RUN.md / verify-against-relay.mjs / verify-lifecycle.mjs);
// this twin proves the byte path + lifecycle deterministically in CI-style runs.
//
// Usage (programmatic): import { startStandinRelay } from "./standin-relay.mjs"
//   const relay = await startStandinRelay({ port: 0, idleMs: 200 });
//   ... relay.url ("ws://127.0.0.1:<port>") ... await relay.close();

import { WebSocketServer } from "ws";
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
} from "../relay/src/pairing.js";
import { authorizeAttach } from "../shared/session-token.mjs";
import {
  encodeAttachedFrame,
  encodePeerDegradedFrame,
  encodePeerReattachedFrame,
  encodeHeartbeatAckFrame,
  isHeartbeatFrame,
} from "../shared/control-frames.mjs";

const NORMAL_CLOSURE = 1000;

/**
 * @param {{ port?: number, secret?: string, idleMs?: number, maxMs?: number,
 *           graceMs?: number, sendAttachedFrame?: boolean,
 *           log?: (msg:string, extra?:object)=>void }} [opts]
 *   `secret` — TERMINAL_SESSION_SECRET used to verify leg tokens (defaults to env).
 *   `idleMs` / `maxMs` — lifecycle caps (default 30 min / 4 h); tests pass small values.
 *   `graceMs` — reconnect grace window (default 90s); tests pass small values.
 *   `sendAttachedFrame` — default true (mirrors the real DO's R1 confirmation to
 *   the bridge leg); tests pass false to simulate an OLD relay for skew coverage.
 * @returns {Promise<{ url:string, port:number, close:()=>Promise<void>, sessions: Map }>}
 */
export function startStandinRelay(opts = {}) {
  const log = opts.log || (() => {});
  const secret = opts.secret ?? process.env.TERMINAL_SESSION_SECRET;
  const idleMs = resolveMs(opts.idleMs, DEFAULT_IDLE_MS);
  const maxMs = resolveMs(opts.maxMs, DEFAULT_MAX_MS);
  const graceMs = resolveMs(opts.graceMs, RECONNECT_GRACE_MS);
  const sendAttachedFrame = opts.sendAttachedFrame !== false;
  // session id -> { bridge: ws|null, browser: ws|null, owner: string|null,
  //                 idleTimer, maxTimer, graceTimer }
  //
  // GRACE-WINDOW REATTACH (fix/terminal-reconnect-reattach): faithfully mirrors the
  // Cloudflare DO. On a single-leg detach we HOLD the session (owner + surviving
  // socket kept, `peer-degraded` sent, no PEER_GONE) and arm a grace timer instead
  // of tearing down. A same-sid+owner reattach inside the window re-pairs both legs
  // (`peer-reattached`); the timer firing still-incomplete runs the OLD teardown.
  const sessions = new Map();

  const wss = new WebSocketServer({ port: opts.port ?? 0 });

  /** Close both legs with code 1000 + a lifecycle reason, then forget the session. */
  function endSession(session, reason) {
    const legs = sessions.get(session);
    if (!legs) return;
    clearTimeout(legs.idleTimer);
    clearTimeout(legs.maxTimer);
    clearTimeout(legs.graceTimer);
    for (const leg of [legs.bridge, legs.browser]) {
      if (leg && leg.readyState === leg.OPEN) {
        try { leg.close(NORMAL_CLOSURE, reason); } catch { /* closing */ }
      }
    }
    sessions.delete(session);
  }

  /** Grace window elapsed without a full reattach → the OLD teardown: any survivor
   *  gets PEER_GONE (4004) and the session is forgotten. */
  function endGrace(session) {
    const legs = sessions.get(session);
    if (!legs) return;
    clearTimeout(legs.idleTimer);
    clearTimeout(legs.maxTimer);
    clearTimeout(legs.graceTimer);
    for (const leg of [legs.bridge, legs.browser]) {
      if (leg && leg.readyState === leg.OPEN) {
        try { leg.close(CLOSE.PEER_GONE.code, CLOSE.PEER_GONE.reason); } catch { /* closing */ }
      }
    }
    sessions.delete(session);
  }

  /** (Re)arm the idle timer for a session (called on attach + every message). */
  function bumpIdle(session, legs) {
    clearTimeout(legs.idleTimer);
    legs.idleTimer = setTimeout(() => endSession(session, idleCloseReason(idleMs)), idleMs);
    legs.idleTimer.unref?.();
  }

  wss.on("connection", async (ws, req) => {
    const url = new URL(req.url, "ws://localhost");
    const session = url.searchParams.get("session");
    const role = url.searchParams.get("role");
    const token = url.searchParams.get("token");

    if (!isValidSession(session)) {
      ws.close(CLOSE.BAD_SESSION.code, CLOSE.BAD_SESSION.reason);
      return;
    }

    // Authenticate the leg with the SAME shared verifier the real relay uses.
    // Mirrors the Cloudflare DO (fix/terminal-expired-reattach): the held
    // session's bound owner + the max session age are handed to authorizeAttach
    // so a same-owner reattach to a LIVE session is waived past the token TTL.
    const auth = await authorizeAttach({
      token,
      secret,
      session,
      role,
      boundOwner: sessions.get(session)?.owner ?? null,
      maxSessionMs: maxMs,
    });
    if (!auth.ok) {
      log("attach rejected (auth)", { session, role, reason: auth.reason });
      ws.close(CLOSE.BAD_TOKEN.code, CLOSE.BAD_TOKEN.reason);
      return;
    }
    if (auth.expired) {
      log("attach authorized with expired token (reattach waiver)", { session, role });
    }

    if (!sessions.has(session)) {
      sessions.set(session, { bridge: null, browser: null, owner: null, idleTimer: null, maxTimer: null, graceTimer: null });
    }
    const legs = sessions.get(session);

    const state = { bridge: legs.bridge !== null, browser: legs.browser !== null, owner: legs.owner };
    const decision = decideAttach(state, role, auth.sub);
    if (!decision.ok) {
      log("attach rejected", { session, role, code: decision.code, reason: decision.reason });
      ws.close(decision.code, decision.reason);
      return;
    }

    // Same-owner browser PREEMPTION (fix/terminal-dock-heartbeat) — mirrors the
    // Cloudflare DO: the stale browser leg (possibly silently dead) is closed 4001
    // "preempted" and this attach takes its slot. Nulling the slot FIRST makes the
    // stale socket's teardown a no-op (superseded), so no grace window opens for a
    // swap that leaves the pair whole.
    if (decision.preempt && legs[role]) {
      const stale = legs[role];
      legs[role] = null;
      try { stale.close(CLOSE.PREEMPTED.code, CLOSE.PREEMPTED.reason); } catch { /* closing */ }
      log("stale browser leg preempted", { session, role });
    }

    const firstLeg = legs.bridge === null && legs.browser === null;
    if (legs.owner === null) legs.owner = auth.sub;
    legs[role] = ws;
    log("attached", { session, role });

    // R1 attach confirmation to the BRIDGE leg — mirrors the Cloudflare DO. A
    // prompt-carrying bridge defers its PTY spawn until this frame arrives.
    if (role === "bridge" && sendAttachedFrame) {
      try { ws.send(encodeAttachedFrame()); } catch { /* leg already gone */ }
    }

    // GRACE-WINDOW REATTACH reconciliation: if this session was being HELD for a
    // dropped leg and BOTH legs are present again, cancel the grace hold and tell
    // BOTH legs to resume. (Only one leg back → keep holding, wait for the other.)
    if (legs.graceTimer && legs.bridge && legs.browser) {
      clearTimeout(legs.graceTimer);
      legs.graceTimer = null;
      for (const leg of [legs.bridge, legs.browser]) {
        try { leg.send(encodePeerReattachedFrame()); } catch { /* closing */ }
      }
      log("reattached — pair whole again", { session, role });
    }

    // Arm the max-duration cap once, on the first leg; arm/refresh idle now (unless
    // still holding a grace window — a degraded session is governed by grace, not idle).
    if (firstLeg && !legs.maxTimer) {
      legs.maxTimer = setTimeout(() => endSession(session, maxCloseReason(maxMs)), maxMs);
      legs.maxTimer.unref?.();
    }
    if (!legs.graceTimer) bumpIdle(session, legs);

    ws.on("message", (data, isBinary) => {
      // HEARTBEAT intercept (fix/terminal-dock-heartbeat) — mirrors the Cloudflare
      // DO's auto-response: echo the ack to the PROBING leg only, never forward,
      // and never bump the idle clock (a heartbeat is not session activity).
      if (!isBinary && isHeartbeatFrame(String(data))) {
        try { ws.send(encodeHeartbeatAckFrame()); } catch { /* leg already gone */ }
        return;
      }
      const peer = role === "bridge" ? legs.browser : legs.bridge;
      if (peer && peer.readyState === peer.OPEN) {
        peer.send(data, { binary: isBinary }); // verbatim, opaque
      }
      // Activity → push the idle deadline out (max-duration is untouched).
      if (sessions.get(session) === legs && !legs.graceTimer) bumpIdle(session, legs);
    });

    // One leg went away → HOLD the session for the reconnect grace window instead of
    // tearing it down. Keep the owner + any surviving socket; tell the survivor via
    // `peer-degraded` (do NOT close it). endGrace() runs the old teardown if the
    // window elapses still-incomplete.
    const teardown = () => {
      if (legs[role] !== ws) return; // a superseding attach already owns this slot
      legs[role] = null;
      log("detached", { session, role });
      if (sessions.get(session) !== legs) return;
      if (!legs.graceTimer) {
        clearTimeout(legs.idleTimer); // idle is suspended while degraded
        legs.graceTimer = setTimeout(() => endGrace(session), graceMs);
        legs.graceTimer.unref?.();
      }
      const peer = role === "bridge" ? legs.browser : legs.bridge;
      if (peer && peer.readyState === peer.OPEN) {
        try { peer.send(encodePeerDegradedFrame()); } catch { /* closing */ }
      }
    };

    ws.on("close", teardown);
    ws.on("error", teardown);
  });

  return new Promise((resolve) => {
    wss.on("listening", () => {
      const { port } = wss.address();
      resolve({
        url: `ws://127.0.0.1:${port}`,
        port,
        sessions,
        close: () =>
          new Promise((res) => {
            for (const legs of sessions.values()) {
              clearTimeout(legs.idleTimer);
              clearTimeout(legs.maxTimer);
              clearTimeout(legs.graceTimer);
            }
            for (const client of wss.clients) {
              try { client.terminate(); } catch { /* ignore */ }
            }
            wss.close(() => res());
          }),
      });
    });
  });
}
