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
  TOMBSTONE_MS,
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
  sanitizeConversationId,
  encodeHelperCommandFrame,
  isGoodbyeFrame,
  parseGoodbyeReason,
  isAlwaysOnFrame,
  parseAlwaysOnValue,
  encodeOpenTerminalAuthorizedFrame,
  sanitizeBridgeEndReason,
  sanitizeMachineList,
} from "../shared/control-frames.mjs";

const NORMAL_CLOSURE = 1000;

/**
 * @param {{ port?: number, secret?: string, idleMs?: number, maxMs?: number,
 *           graceMs?: number, sendAttachedFrame?: boolean,
 *           log?: (msg:string, extra?:object)=>void }} [opts]
 *   `secret` — TERMINAL_SESSION_SECRET used to verify leg tokens (defaults to env).
 *   `idleMs` / `maxMs` — lifecycle caps (default 2 h / 24 h); tests pass small values.
 *   `graceMs` — reconnect grace window (default 90s); tests pass small values.
 *   `sendAttachedFrame` — default true (mirrors the real DO's R1 confirmation to
 *   the bridge leg); tests pass false to simulate an OLD relay for skew coverage.
 *   `tombstoneMs` — how long a session the bridge ended on purpose remembers
 *   why (default 10 min; card 6b2cb8ac).
 *   `onSessionClosed(sid, reason)` — stands in for the real DO's app
 *   callback (POST /api/terminal/session/closed); called for "bridge_ended".
 * @returns {Promise<{ url:string, port:number, close:()=>Promise<void>, sessions: Map }>}
 */
export function startStandinRelay(opts = {}) {
  const log = opts.log || (() => {});
  const secret = opts.secret ?? process.env.TERMINAL_SESSION_SECRET;
  const idleMs = resolveMs(opts.idleMs, DEFAULT_IDLE_MS);
  const maxMs = resolveMs(opts.maxMs, DEFAULT_MAX_MS);
  const graceMs = resolveMs(opts.graceMs, RECONNECT_GRACE_MS);
  const sendAttachedFrame = opts.sendAttachedFrame !== false;
  const tombstoneMs = resolveMs(opts.tombstoneMs, TOMBSTONE_MS);
  const onSessionClosed = opts.onSessionClosed || (() => {});
  // Ended-session tombstones (card 6b2cb8ac) — mirrors the DO's
  // tombstoneReason/tombstoneAt/tombstoneOwner keys: sid -> { reason, at, owner }.
  const tombstones = new Map();
  const freshTombstone = (sid) => {
    const t = tombstones.get(sid);
    if (!t) return null;
    if (Date.now() - t.at >= tombstoneMs) {
      tombstones.delete(sid);
      return null;
    }
    return t;
  };
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
  //
  // PER MAC (card 6b2cb8ac): each entry is now a LIST of legs (one per Mac,
  // tagged with the Mac's names), mirroring the DO's per-leg attachments, and
  // `machineRecords` keeps each Mac's last-known status (the DO's
  // `helper:<name>:<field>` keys), keyed `${session}|${name}`.
  const helperLegs = new Map();
  const machineRecords = new Map();
  const legsOf = (session) => helperLegs.get(session) ?? [];
  const isOpen = (leg) => !!leg?.ws && leg.ws.readyState === leg.ws.OPEN && !leg.retired;
  const intersects = (a, b) => a.some((n) => b.includes(n));
  const recordMachine = (session, leg) => {
    for (const name of leg.names) machineRecords.set(`${session}|${name}`, leg);
  };
  const statusOf = (leg, connected) =>
    computeHelperStatus({
      connected,
      version: leg?.version ?? null,
      machineLabel: leg?.machineLabel ?? null,
      alwaysOn: leg?.alwaysOn ?? false,
      uncleanAt: connected ? null : leg?.uncleanAt ?? null,
      now: Date.now(),
      codexInstalled: leg?.codexInstalled ?? null,
      claudeInstalled: leg?.claudeInstalled ?? null,
    });

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
    let status;
    if (url.searchParams.has("machines")) {
      // Per-Mac status (card 6b2cb8ac) — mirrors the DO's machineHelperStatus.
      const machines = sanitizeMachineList(url.searchParams.get("machines"));
      const live = legsOf(session).filter((l) => isOpen(l) && intersects(l.names, machines));
      const newest = live[live.length - 1];
      if (newest) status = statusOf(newest, true);
      else {
        const rec = machines.map((n) => machineRecords.get(`${session}|${n}`)).find(Boolean);
        status = statusOf(rec ?? null, false);
      }
    } else {
      const legs = legsOf(session);
      const leg = legs[legs.length - 1];
      status = statusOf(leg ?? null, isOpen(leg));
    }
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
    const frame = encodeHelperCommandFrame(cmd, cmd === "set-always-on" ? body.value : undefined);
    const reply = (obj) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    if (body?.machines !== undefined) {
      // Per-Mac command (card 6b2cb8ac) — mirrors the DO's handleHelperCommand.
      const machines = sanitizeMachineList(body.machines);
      if (machines.length === 0) return reply({ delivered: false, reason: "machine-unknown" });
      const targets = legsOf(session).filter((l) => isOpen(l) && intersects(l.names, machines));
      for (const t of targets) {
        try { t.ws.send(frame); } catch { /* leg already closing */ }
      }
      if (targets.length === 0) return reply({ delivered: false, reason: "not-on-this-mac" });
      return reply({ delivered: true });
    }
    const live = legsOf(session).filter(isOpen);
    const leg = live[live.length - 1];
    if (leg) {
      try { leg.ws.send(frame); } catch { /* leg already closing */ }
    } else {
      log("helper command: no live helper leg", { session, cmd });
    }
    reply({ delivered: !!leg });
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
    const existingLegs = legsOf(session);
    const existing = existingLegs[existingLegs.length - 1];
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
    // latest-first (mirrors the Cloudflare DO's fetchHelperLeg) — but only on
    // the SAME Mac (a shared machine name; card 6b2cb8ac). A leg with no
    // names on either side keeps the old replace-every-leg rule.
    const names = sanitizeMachineList(
      [sanitizeMachineLabel(url.searchParams.get("machineLabel")), ...sanitizeMachineList(url.searchParams.get("machineAliases") ?? "")].filter(Boolean),
    );
    for (const old of existingLegs) {
      if (!isOpen(old)) continue;
      if (names.length === 0 || old.names.length === 0 || intersects(names, old.names)) {
        old.retired = true;
        try { old.ws.close(CLOSE.PREEMPTED.code, CLOSE.PREEMPTED.reason); } catch { /* closing */ }
      }
    }
    // A Mac's own last record supplies anything this attach didn't announce.
    const prior = names.map((n) => machineRecords.get(`${session}|${n}`)).find(Boolean) ?? (names.length === 0 ? existing : undefined);

    // Codex support (FR-3's helper-side half) — tri-state, mirrors the
    // Cloudflare DO's fetchHelperLeg exactly: "1"/"0" is a known answer,
    // anything else (including absent, an old helper) falls back to whatever
    // was already known (a reattach shouldn't forget it), else null (unknown).
    const codexInstalledRaw = url.searchParams.get("codexInstalled");
    const claudeInstalledRaw = url.searchParams.get("claudeInstalled");
    const codexInstalled =
      codexInstalledRaw === "1" ? true : codexInstalledRaw === "0" ? false : prior?.codexInstalled ?? null;
    const claudeInstalled =
      claudeInstalledRaw === "1" ? true : claudeInstalledRaw === "0" ? false : prior?.claudeInstalled ?? null;

    const leg = {
      ws,
      owner: auth.sub,
      names,
      retired: false,
      version: sanitizeHelperVersion(url.searchParams.get("helperVersion")) ?? prior?.version ?? null,
      machineLabel: sanitizeMachineLabel(url.searchParams.get("machineLabel")) ?? prior?.machineLabel ?? null,
      alwaysOn: url.searchParams.get("alwaysOn") === "1",
      codexInstalled,
      claudeInstalled,
      // Design rule: a fresh attach clears any "stopped unexpectedly" flag.
      uncleanAt: null,
      goodbye: false,
    };
    helperLegs.set(session, [...existingLegs.filter((l) => isOpen(l)), leg]);
    recordMachine(session, leg);
    log("helper attached", { session, version: leg.version, alwaysOn: leg.alwaysOn, codexInstalled, claudeInstalled });

    // OPEN-TERMINAL RELAY AUTHORIZATION (desktop Codex security fix, Finding
    // 1) — faithful twin of the Cloudflare DO's fetchHelperLeg: a helper leg
    // that connected with `purpose=open-terminal` gets an explicit ack, sent
    // strictly AFTER authorizeAttach succeeded above.
    if (url.searchParams.get("purpose") === "open-terminal") {
      try {
        ws.send(encodeOpenTerminalAuthorizedFrame());
      } catch { /* closing */ }
    }

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
      if (leg.retired) return; // a same-Mac relaunch already replaced this leg
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
      boundOwner: sessions.get(session)?.owner ?? freshTombstone(session)?.owner ?? null,
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

    // ENDED-SESSION TOMBSTONE (card 6b2cb8ac) — mirrors the DO's fetch() step
    // 1b: a browser attaching to a sid its bridge just ended on purpose is
    // closed 1000 with that reason; a bridge attaching forgets the tombstone.
    if (role === "bridge") {
      tombstones.delete(session);
    } else if (role === "browser" && !sessions.has(session)) {
      const tomb = freshTombstone(session);
      if (tomb && (tomb.owner === null || tomb.owner === auth.sub)) {
        log("attach to an ended session — closing with its reason", { session, reason: tomb.reason });
        ws.close(NORMAL_CLOSURE, tomb.reason);
        return;
      }
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
        bridgeConv: null,
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
      // Exact-conversation Resume (rework 5) — mirrors the Cloudflare DO's
      // `conv` handling, same store-durably + forward-combined-state shape.
      const conv = sanitizeConversationId(url.searchParams.get("conv"));
      if (helperVersion) legs.bridgeHelperVersion = helperVersion;
      if (host) legs.bridgeHost = host;
      if (conv) legs.bridgeConv = conv;
      if ((helperVersion || host || conv) && legs.browser && legs.browser.readyState === legs.browser.OPEN) {
        try {
          legs.browser.send(encodeBridgeVersionFrame(legs.bridgeHelperVersion, legs.bridgeHost, legs.bridgeConv));
        } catch { /* closing */ }
      }
    } else if (role === "browser" && (legs.bridgeHelperVersion || legs.bridgeHost || legs.bridgeConv)) {
      try {
        ws.send(encodeBridgeVersionFrame(legs.bridgeHelperVersion, legs.bridgeHost, legs.bridgeConv));
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
        legs.graceTimer = setTimeout(() => {
          const cur = sessions.get(session);
          if (!cur) return;
          if (cur.bridge && !cur.browser) {
            // Backgrounded-tab fix: the bridge (running the real PTY) is still
            // attached and healthy — only the browser dropped. That's now the
            // accepted steady state, not a countdown to death: release the
            // grace hold and fall back to the ordinary idle/max-duration caps
            // instead of tearing the session down via endGrace().
            cur.graceTimer = null;
            bumpIdle(session, cur);
            log("reconnect grace expired — bridge alone survives, releasing hold", { session });
            return;
          }
          endGrace(session);
        }, graceMs);
        legs.graceTimer.unref?.();
      }
      const peer = role === "bridge" ? legs.browser : legs.bridge;
      if (peer && peer.readyState === peer.OPEN) {
        try { peer.send(encodePeerDegradedFrame()); } catch { /* closing */ }
      }
    };

    // DELIBERATE BRIDGE END (card 6b2cb8ac) — mirrors the DO's endFromBridge:
    // a bridge closing 1000 stopped on purpose, so end the session now with
    // its reason (no grace hold), tell the app, and leave a tombstone.
    const endFromBridge = (rawReason) => {
      const reason = rawReason ? sanitizeBridgeEndReason(rawReason) : "pty-exit";
      legs.bridge = null;
      clearTimeout(legs.idleTimer);
      clearTimeout(legs.maxTimer);
      clearTimeout(legs.graceTimer);
      const browser = legs.browser;
      legs.browser = null;
      if (browser && browser.readyState === browser.OPEN) {
        try { browser.close(NORMAL_CLOSURE, reason); } catch { /* closing */ }
      }
      sessions.delete(session);
      tombstones.set(session, { reason, at: Date.now(), owner: legs.owner });
      log("session ended", { why: "bridge-ended", reason, sid: session });
      try { onSessionClosed(session, "bridge_ended"); } catch { /* test hook */ }
    };

    ws.on("close", (code, reasonBuf) => {
      if (role === "bridge" && code === NORMAL_CLOSURE && legs.bridge === ws && sessions.get(session) === legs) {
        endFromBridge(reasonBuf ? reasonBuf.toString() : "");
        return;
      }
      teardown();
    });
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
