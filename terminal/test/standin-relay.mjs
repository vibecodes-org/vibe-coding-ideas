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

import http from "node:http";
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
import { computeHelperStatus } from "../relay/src/helper-status.js";
import { authorizeAttach, authorizeControl, HELPER_MAX_BOUND_MS } from "../shared/session-token.mjs";
import {
  encodeAttachedFrame,
  encodePeerDegradedFrame,
  encodePeerReattachedFrame,
  encodeHeartbeatAckFrame,
  isHeartbeatFrame,
  encodeBridgeVersionFrame,
  sanitizeHelperVersion,
  sanitizeMachineLabel,
  encodeHelperCommandFrame,
  isGoodbyeFrame,
  parseGoodbyeReason,
  isAlwaysOnFrame,
  parseAlwaysOnValue,
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

  // Helper lifecycle (card cc74a067): a SEPARATE map, one entry per owner's
  // reserved `helper-<sub>` session id — mirrors the Cloudflare DO's isolated
  // per-instance storage (a helper leg never shares a `sessions` entry with a
  // real bridge/browser pairing). `{ ws, owner, version, machineLabel,
  // alwaysOn, uncleanAt }`; `uncleanAt` is set whenever a helper's socket
  // closes without a preceding goodbye frame — see computeHelperStatus.
  const helperLegs = new Map();

  // Multi-session stage 3 (POST /end): the stand-in needs a plain HTTP
  // endpoint alongside the WebSocket upgrade path, so — unlike the original
  // `{ port }` shorthand — we own the http.Server explicitly and hand it to
  // WebSocketServer via the `server` option (ws only intercepts the `upgrade`
  // event on it; everything else is handled by our own request listener).
  const httpServer = http.createServer((req, res) => {
    handleHttpRequest(req, res).catch((err) => {
      log("end handler crashed", { err: String(err) });
      try {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ ended: false, reason: "internal-error" }));
      } catch { /* response already sent */ }
    });
  });
  const wss = new WebSocketServer({ server: httpServer });

  /** Faithful twin of the Cloudflare DO's handleEnd (relay/src/index.js). */
  async function handleHttpRequest(req, res) {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/helper/status" && req.method === "GET") {
      return handleHelperStatusHttp(req, res, url);
    }
    if (url.pathname === "/helper/command" && req.method === "POST") {
      return handleHelperCommandHttp(req, res, url);
    }
    if (url.pathname !== "/end" || req.method !== "POST") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }
    const session = url.searchParams.get("session");
    const authHeader = req.headers["authorization"] || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const auth = await authorizeControl({ token, secret, session });
    if (!auth.ok) {
      log("end rejected (auth)", { session, reason: auth.reason });
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ ended: false, reason: "unauthorized" }));
      return;
    }
    const legs = sessions.get(session);
    const hasLive =
      !!legs &&
      ((legs.bridge && legs.bridge.readyState === legs.bridge.OPEN) ||
        (legs.browser && legs.browser.readyState === legs.browser.OPEN));
    if (!hasLive) {
      log("end: no live session", { session });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ended: false, reason: "no-session" }));
      return;
    }
    endSession(session, "ended-by-user");
    log("end: session ended", { session });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ended: true }));
  }

  /** Faithful twin of the Cloudflare DO's handleHelperStatus. */
  async function handleHelperStatusHttp(req, res, url) {
    const session = url.searchParams.get("session");
    const authHeader = req.headers["authorization"] || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const auth = await authorizeControl({ token, secret, session });
    if (!auth.ok) {
      log("helper status rejected (auth)", { session, reason: auth.reason });
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    const leg = helperLegs.get(session);
    const status = computeHelperStatus({
      connected: !!leg?.ws && leg.ws.readyState === leg.ws.OPEN,
      version: leg?.version ?? null,
      machineLabel: leg?.machineLabel ?? null,
      alwaysOn: leg?.alwaysOn ?? false,
      uncleanAt: leg?.uncleanAt ?? null,
      now: Date.now(),
    });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(status));
  }

  /** Faithful twin of the Cloudflare DO's handleHelperCommand. */
  async function handleHelperCommandHttp(req, res, url) {
    const session = url.searchParams.get("session");
    const authHeader = req.headers["authorization"] || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const auth = await authorizeControl({ token, secret, session });
    if (!auth.ok) {
      log("helper command rejected (auth)", { session, reason: auth.reason });
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    let body;
    try {
      const raw = await new Promise((resolve, reject) => {
        let data = "";
        req.on("data", (c) => { data += c; });
        req.on("end", () => resolve(data));
        req.on("error", reject);
      });
      body = JSON.parse(raw);
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "bad-body" }));
      return;
    }
    const cmd = body?.cmd;
    if (cmd !== "stop" && cmd !== "quiesce" && cmd !== "set-always-on") {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "bad-command" }));
      return;
    }
    if (cmd === "set-always-on" && typeof body?.value !== "boolean") {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "bad-value" }));
      return;
    }
    const leg = helperLegs.get(session);
    const delivered = !!leg?.ws && leg.ws.readyState === leg.ws.OPEN;
    if (delivered) {
      try {
        leg.ws.send(encodeHelperCommandFrame(cmd, cmd === "set-always-on" ? body.value : undefined));
      } catch { /* leg already closing */ }
    } else {
      log("helper command: no live helper leg", { session, cmd });
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ delivered }));
  }

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

  /**
   * Helper lifecycle (card cc74a067) — faithful twin of the Cloudflare DO's
   * fetchHelperLeg + handleHelperMessage + handleHelperDetach: bypasses
   * decideAttach (no pairing — a helper has no peer), reuses authorizeAttach
   * with the SAME sticky-owner reattach waiver (bounded by HELPER_MAX_BOUND_MS),
   * preempts a stale same-owner leg, and tracks version/machineLabel/alwaysOn
   * + "stopped unexpectedly" (uncleanAt) durably per reserved session id.
   */
  async function handleHelperConnection(ws, url, session, token) {
    const existing = helperLegs.get(session);
    const auth = await authorizeAttach({
      token,
      secret,
      session,
      role: "helper",
      boundOwner: existing?.owner ?? null,
      maxSessionMs: HELPER_MAX_BOUND_MS,
    });
    if (!auth.ok) {
      log("helper attach rejected (auth)", { session, reason: auth.reason });
      ws.close(CLOSE.BAD_TOKEN.code, CLOSE.BAD_TOKEN.reason);
      return;
    }

    // Same-owner PREEMPTION: a second helper leg for the same owner wins
    // latest-first (mirrors the Cloudflare DO's fetchHelperLeg).
    if (existing?.ws && existing.ws.readyState === existing.ws.OPEN) {
      try { existing.ws.close(CLOSE.PREEMPTED.code, CLOSE.PREEMPTED.reason); } catch { /* closing */ }
    }

    const leg = {
      ws,
      owner: auth.sub,
      version: sanitizeHelperVersion(url.searchParams.get("helperVersion")) ?? existing?.version ?? null,
      machineLabel: sanitizeMachineLabel(url.searchParams.get("machineLabel")) ?? existing?.machineLabel ?? null,
      alwaysOn: url.searchParams.get("alwaysOn") === "1",
      // Design rule: a fresh attach clears any "stopped unexpectedly" flag.
      uncleanAt: null,
      goodbye: false,
    };
    helperLegs.set(session, leg);
    log("helper attached", { session, version: leg.version, alwaysOn: leg.alwaysOn });

    ws.on("message", (data, isBinary) => {
      if (isBinary) return; // a helper leg never sends binary
      const text = data.toString();
      if (isGoodbyeFrame(text)) {
        const reason = parseGoodbyeReason(text);
        if (!reason) return;
        leg.goodbye = true;
        leg.uncleanAt = null;
        log("helper goodbye", { session, reason });
        return;
      }
      if (isAlwaysOnFrame(text)) {
        const value = parseAlwaysOnValue(text);
        if (value === null) return;
        leg.alwaysOn = value;
        log("helper always-on updated", { session, value });
        return;
      }
      log("helper: ignored unknown control frame", { session });
    });

    const teardown = () => {
      if (helperLegs.get(session) !== leg) return; // a superseding attach already owns this slot
      log("helper detached", { session, goodbye: leg.goodbye });
      if (!leg.goodbye) leg.uncleanAt = Date.now();
    };
    ws.on("close", teardown);
    ws.on("error", teardown);
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

    // Helper lifecycle (card cc74a067): a `helper` leg is structurally
    // different (single, per-owner, no peer) — dispatch to its own handler
    // BEFORE the bridge/browser pairing logic below, which it never touches.
    if (role === "helper") {
      return handleHelperConnection(ws, url, session, token);
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
      sessions.set(session, {
        bridge: null,
        browser: null,
        owner: null,
        idleTimer: null,
        maxTimer: null,
        graceTimer: null,
        bridgeHelperVersion: null,
        bridgeHost: null,
      });
    }
    const legs = sessions.get(session);

    const state = { bridge: legs.bridge !== null, browser: legs.browser !== null, owner: legs.owner };
    const decision = decideAttach(state, role, auth.sub);
    if (!decision.ok) {
      log("attach rejected", { session, role, code: decision.code, reason: decision.reason });
      ws.close(decision.code, decision.reason);
      return;
    }

    // Same-owner PREEMPTION (browser: fix/terminal-dock-heartbeat; bridge:
    // fix/terminal-bridge-zombie-preemption) — mirrors the Cloudflare DO: the
    // stale leg of the same role (possibly silently dead) is closed 4001
    // "preempted" and this attach takes its slot. Nulling the slot FIRST makes the
    // stale socket's teardown a no-op (superseded), so no grace window opens for a
    // swap that leaves the pair whole.
    if (decision.preempt && legs[role]) {
      const stale = legs[role];
      legs[role] = null;
      try { stale.close(CLOSE.PREEMPTED.code, CLOSE.PREEMPTED.reason); } catch { /* closing */ }
      log("stale leg preempted", { session, role });
    }

    const firstLeg = legs.bridge === null && legs.browser === null;
    const wasHeld = legs.graceTimer != null;
    if (legs.owner === null) legs.owner = auth.sub;
    legs[role] = ws;
    log("attached", { session, role });

    // R1 attach confirmation to the BRIDGE leg — mirrors the Cloudflare DO. A
    // prompt-carrying bridge defers its PTY spawn until this frame arrives.
    if (role === "bridge" && sendAttachedFrame) {
      try { ws.send(encodeAttachedFrame()); } catch { /* leg already gone */ }
    }

    // HELPER-VERSION + MACHINE-IDENTITY ANNOUNCEMENT (release-gate rework 2a,
    // extended by Nick's sign-off change 2) — mirrors the Cloudflare DO's fetch()
    // step 5b: ordering-independent both ways, and the two fields are independent
    // of each other. A bridge attaching with a sanitized `helperVersion` and/or
    // `host` stores whichever is present on the session and forwards the CURRENT
    // combined state to an already-live browser leg; a browser attaching (before
    // or after the bridge) gets whatever's already on file, if any.
    if (role === "bridge") {
      const helperVersion = sanitizeHelperVersion(url.searchParams.get("helperVersion"));
      const host = sanitizeMachineLabel(url.searchParams.get("host"));
      if (helperVersion) legs.bridgeHelperVersion = helperVersion;
      if (host) legs.bridgeHost = host;
      if ((helperVersion || host) && legs.browser && legs.browser.readyState === legs.browser.OPEN) {
        try {
          legs.browser.send(encodeBridgeVersionFrame(legs.bridgeHelperVersion, legs.bridgeHost));
        } catch { /* closing */ }
      }
    } else if (role === "browser" && (legs.bridgeHelperVersion || legs.bridgeHost)) {
      try {
        ws.send(encodeBridgeVersionFrame(legs.bridgeHelperVersion, legs.bridgeHost));
      } catch { /* leg already gone */ }
    }

    // GRACE-WINDOW REATTACH reconciliation: if this session was being HELD for a
    // dropped leg and BOTH legs are present again, cancel the grace hold. (Only
    // one leg back → keep holding, wait for the other.)
    const pairWhole = legs.bridge && legs.browser;
    if (wasHeld && pairWhole) {
      clearTimeout(legs.graceTimer);
      legs.graceTimer = null;
      log("reattached — pair whole again", { session, role });
    }

    // `peer-reattached` is the PAIR-IS-WHOLE signal — mirrors the Cloudflare DO
    // (relay/src/index.js step 6, fix/relay-pair-whole-notify): it fires
    // whenever THIS attach makes the pair whole, not only after a grace hold —
    // that also covers initial pairing and a same-owner PREEMPTION reattach
    // (pop-out / bring-back-to-dock), neither of which ever opens a grace hold.
    // A leg attaching to a quiet session has no other way to learn its peer is
    // there (no bytes flow, and unpaired input is dropped).
    if (pairWhole) {
      for (const leg of [legs.bridge, legs.browser]) {
        try { leg.send(encodePeerReattachedFrame()); } catch { /* closing */ }
      }
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
    httpServer.listen(opts.port ?? 0, () => {
      const { port } = httpServer.address();
      resolve({
        url: `ws://127.0.0.1:${port}`,
        // Multi-session stage 3: the HTTP base for POST /end (same host/port —
        // ws upgrades and plain HTTP share one listener, exactly like the real
        // Cloudflare Worker fronting one Durable Object namespace).
        httpUrl: `http://127.0.0.1:${port}`,
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
            wss.close(() => httpServer.close(() => res()));
          }),
      });
    });
  });
}
