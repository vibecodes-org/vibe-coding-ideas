// VibeCodes Terminal Relay — Cloudflare Worker + Durable Object — SLICE 1
//
// One Durable Object instance per `session` id. It accepts two WebSocket legs —
// `bridge` (the local machine) and `browser` (the in-app terminal) — pairs them,
// and forwards bytes OPAQUELY in both directions. It never parses or logs stream
// content; only metadata (session id, role, byte counts).
//
// Enforces SINGLE-ATTACH: a 2nd browser (or 2nd bridge) for an already-attached
// session is rejected with a clear close code/reason.
//
// Connect with:  wss://<host>/?session=<id>&role=<bridge|browser>
//
// Run locally (offline, no Cloudflare account):  npx wrangler dev
//
// The pairing / single-attach decision logic lives in ./pairing.js and is shared
// with the Node stand-in relay used by the automated test, so both enforce
// identical rules.

import { decideAttach, isValidSession, CLOSE } from "./pairing.js";
import { authorizeAttach } from "../../shared/session-token.mjs";

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
    // attach (see TerminalRelay.fetch) — that is where the per-session owner state
    // lives, so both the signature/expiry check and the owner check are enforced
    // in one place, by the same shared `authorizeAttach`.
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
    /** @type {WebSocket|null} */
    this.bridge = null;
    /** @type {WebSocket|null} */
    this.browser = null;
    /** @type {string|null} owning user id (`sub`) this session is bound to */
    this.owner = null;
    this.bytes = { bridge: 0, browser: 0 };
  }

  /** @param {string} msg @param {object} [extra] */
  log(msg, extra = {}) {
    // Metadata only — never stream content.
    console.log(JSON.stringify({ comp: "relay", msg, ...extra }));
  }

  /** Current attachment state derived from live sockets (pure-logic input). */
  attachState() {
    return {
      bridge: this.bridge !== null,
      browser: this.browser !== null,
      owner: this.owner,
    };
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
    server.accept();

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
      server.close(CLOSE.BAD_TOKEN.code, CLOSE.BAD_TOKEN.reason);
      return new Response(null, { status: 101, webSocket: client });
    }

    // 2) Owner-binding + single-attach (pure). Both legs of a session must carry the
    //    same `sub`; a leg for a different user is rejected with OWNER_MISMATCH.
    const decision = decideAttach(this.attachState(), role, auth.sub);
    if (!decision.ok) {
      this.log("attach rejected", { session, role, code: decision.code, reason: decision.reason });
      // Send the close on the accepted server socket so the client sees the code.
      server.close(decision.code, decision.reason);
      return new Response(null, { status: 101, webSocket: client });
    }

    if (this.owner === null) this.owner = auth.sub;
    if (role === "bridge") this.bridge = server;
    else this.browser = server;
    this.log("attached", { session, role, ...this.attachState() });

    server.addEventListener("message", (event) => {
      const peer = role === "bridge" ? this.browser : this.bridge;
      const data = event.data;
      // Count bytes for metadata; do NOT inspect content.
      this.bytes[role] += typeof data === "string" ? data.length : data.byteLength;
      if (peer) {
        try {
          peer.send(data); // verbatim, opaque
        } catch (e) {
          this.log("forward failed", { session, role, err: String(e) });
        }
      }
      // If no peer yet, the frame is dropped — slice 1 has no buffering. The
      // bridge's first PTY output may predate the browser attaching; the test
      // orchestrates browser-first to avoid races, and real usage opens the
      // browser dock to "Connecting…" before the bridge produces output.
    });

    const teardown = (why) => {
      if (role === "bridge") this.bridge = null;
      else this.browser = null;
      this.log("detached", { session, role, why, bytes: this.bytes[role] });
      // Tell the surviving peer its partner is gone, then drop it so the
      // session can be cleanly re-established.
      const peer = role === "bridge" ? this.browser : this.bridge;
      if (peer) {
        try {
          peer.close(CLOSE.PEER_GONE.code, CLOSE.PEER_GONE.reason);
        } catch { /* already closing */ }
        if (role === "bridge") this.browser = null;
        else this.bridge = null;
      }
      // Release the owner binding once the session is fully empty so the id can be
      // cleanly re-established by an authorized owner.
      if (this.bridge === null && this.browser === null) this.owner = null;
    };

    server.addEventListener("close", () => teardown("close"));
    server.addEventListener("error", () => teardown("error"));

    return new Response(null, { status: 101, webSocket: client });
  }
}
