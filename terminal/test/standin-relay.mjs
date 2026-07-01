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
  idleCloseReason,
  maxCloseReason,
  resolveMs,
} from "../relay/src/pairing.js";
import { authorizeAttach } from "../shared/session-token.mjs";

const NORMAL_CLOSURE = 1000;

/**
 * @param {{ port?: number, secret?: string, idleMs?: number, maxMs?: number,
 *           log?: (msg:string, extra?:object)=>void }} [opts]
 *   `secret` — TERMINAL_SESSION_SECRET used to verify leg tokens (defaults to env).
 *   `idleMs` / `maxMs` — lifecycle caps (default 30 min / 4 h); tests pass small values.
 * @returns {Promise<{ url:string, port:number, close:()=>Promise<void>, sessions: Map }>}
 */
export function startStandinRelay(opts = {}) {
  const log = opts.log || (() => {});
  const secret = opts.secret ?? process.env.TERMINAL_SESSION_SECRET;
  const idleMs = resolveMs(opts.idleMs, DEFAULT_IDLE_MS);
  const maxMs = resolveMs(opts.maxMs, DEFAULT_MAX_MS);
  // session id -> { bridge: ws|null, browser: ws|null, owner: string|null,
  //                 idleTimer, maxTimer }
  const sessions = new Map();

  const wss = new WebSocketServer({ port: opts.port ?? 0 });

  /** Close both legs with code 1000 + a lifecycle reason, then forget the session. */
  function endSession(session, reason) {
    const legs = sessions.get(session);
    if (!legs) return;
    clearTimeout(legs.idleTimer);
    clearTimeout(legs.maxTimer);
    for (const leg of [legs.bridge, legs.browser]) {
      if (leg && leg.readyState === leg.OPEN) {
        try { leg.close(NORMAL_CLOSURE, reason); } catch { /* closing */ }
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
    const auth = await authorizeAttach({ token, secret, session, role });
    if (!auth.ok) {
      log("attach rejected (auth)", { session, role, reason: auth.reason });
      ws.close(CLOSE.BAD_TOKEN.code, CLOSE.BAD_TOKEN.reason);
      return;
    }

    if (!sessions.has(session)) {
      sessions.set(session, { bridge: null, browser: null, owner: null, idleTimer: null, maxTimer: null });
    }
    const legs = sessions.get(session);

    const state = { bridge: legs.bridge !== null, browser: legs.browser !== null, owner: legs.owner };
    const decision = decideAttach(state, role, auth.sub);
    if (!decision.ok) {
      log("attach rejected", { session, role, code: decision.code, reason: decision.reason });
      ws.close(decision.code, decision.reason);
      return;
    }

    const firstLeg = legs.bridge === null && legs.browser === null;
    if (legs.owner === null) legs.owner = auth.sub;
    legs[role] = ws;
    log("attached", { session, role });

    // Arm the max-duration cap once, on the first leg; arm/refresh idle now.
    if (firstLeg) {
      legs.maxTimer = setTimeout(() => endSession(session, maxCloseReason(maxMs)), maxMs);
      legs.maxTimer.unref?.();
    }
    bumpIdle(session, legs);

    ws.on("message", (data, isBinary) => {
      const peer = role === "bridge" ? legs.browser : legs.bridge;
      if (peer && peer.readyState === peer.OPEN) {
        peer.send(data, { binary: isBinary }); // verbatim, opaque
      }
      // Activity → push the idle deadline out (max-duration is untouched).
      if (sessions.get(session) === legs) bumpIdle(session, legs);
    });

    const teardown = () => {
      if (legs[role] === ws) legs[role] = null;
      log("detached", { session, role });
      const peer = role === "bridge" ? legs.browser : legs.bridge;
      if (peer && peer.readyState === peer.OPEN) {
        try { peer.close(CLOSE.PEER_GONE.code, CLOSE.PEER_GONE.reason); } catch { /* closing */ }
      }
      if (role === "bridge") legs.browser = null;
      else legs.bridge = null;
      if (!legs.bridge && !legs.browser) {
        clearTimeout(legs.idleTimer);
        clearTimeout(legs.maxTimer);
        sessions.delete(session);
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
