// Plain-ws stand-in relay (Node) — for AUTOMATED testing.
//
// It is a faithful, lightweight twin of the Cloudflare Worker + Durable Object
// in ../relay/src/index.js: same opaque forwarding, same single-attach rule,
// because it imports the SAME pure decision logic (../relay/src/pairing.js).
//
// Why a stand-in: `wrangler dev` boots a full workerd runtime (slow, heavy, and
// can need a one-time binary download), which is a poor dependency for a fast,
// hermetic round-trip assertion. The real DO is exercised manually via
// `npx wrangler dev` (see RUN.md); this twin proves the bridge<->relay<->browser
// byte path deterministically in CI-style runs.
//
// Usage (programmatic): import { startStandinRelay } from "./standin-relay.mjs"
//   const relay = await startStandinRelay({ port: 0 });
//   ... relay.url ("ws://127.0.0.1:<port>") ... await relay.close();

import { WebSocketServer } from "ws";
import {
  decideAttach,
  isValidSession,
  CLOSE,
} from "../relay/src/pairing.js";

/**
 * @param {{ port?: number, log?: (msg:string, extra?:object)=>void }} [opts]
 * @returns {Promise<{ url:string, port:number, close:()=>Promise<void>, sessions: Map }>}
 */
export function startStandinRelay(opts = {}) {
  const log = opts.log || (() => {});
  // session id -> { bridge: ws|null, browser: ws|null }
  const sessions = new Map();

  const wss = new WebSocketServer({ port: opts.port ?? 0 });

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url, "ws://localhost");
    const session = url.searchParams.get("session");
    const role = url.searchParams.get("role");

    // TODO(slice 2): validate app-minted session token + owner binding.
    if (!isValidSession(session)) {
      ws.close(CLOSE.BAD_SESSION.code, CLOSE.BAD_SESSION.reason);
      return;
    }

    if (!sessions.has(session)) sessions.set(session, { bridge: null, browser: null });
    const legs = sessions.get(session);

    const state = { bridge: legs.bridge !== null, browser: legs.browser !== null };
    const decision = decideAttach(state, role);
    if (!decision.ok) {
      log("attach rejected", { session, role, code: decision.code, reason: decision.reason });
      ws.close(decision.code, decision.reason);
      return;
    }

    legs[role] = ws;
    log("attached", { session, role });

    ws.on("message", (data, isBinary) => {
      const peer = role === "bridge" ? legs.browser : legs.bridge;
      if (peer && peer.readyState === peer.OPEN) {
        peer.send(data, { binary: isBinary }); // verbatim, opaque
      }
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
      if (!legs.bridge && !legs.browser) sessions.delete(session);
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
            for (const client of wss.clients) {
              try { client.terminate(); } catch { /* ignore */ }
            }
            wss.close(() => res());
          }),
      });
    });
  });
}
