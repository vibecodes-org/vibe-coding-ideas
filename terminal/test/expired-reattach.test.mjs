// Expired-token reattach — regression proof (fix/terminal-expired-reattach).
//
// ROOT CAUSE (Reproduce & Investigate step): the token TTL (300s) bounded EVERY
// attach, including grace-window reattaches. A session older than the TTL (attach
// long ago → drop later) could never reconnect: authorizeAttach rejected the
// original — now expired — tokens and BOTH legs closed 4006, even though the relay
// was faithfully holding the session for exactly that reattach.
//
// THE FIX under test: authorizeAttach now takes the held session's bound owner
// (`boundOwner`) and waives EXPIRY ONLY — never signature/shape/sid/role — when the
// expired token's sub matches it (belt-and-braces capped at the max session age).
// So: TTL bounds session ESTABLISHMENT; reattach is bounded by the grace window +
// the live-session owner binding. Establishment on a virgin sid, foreign subs, and
// reattach after the grace teardown (owner binding released) all still fail 4006.
//
// All cases run against the Node stand-in relay, which passes the SAME boundOwner
// into the SAME shared authorizeAttach the Cloudflare DO uses. Tokens are aged for
// real (short TTL via the shared mint + a wall-clock wait) — no clock mocking, so
// this exercises the exact seconds-based expiry math the relay runs.
//
// Run: cd terminal/test && node --test expired-reattach.test.mjs   (or: npm test)

import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import WebSocket from "ws";
import { startStandinRelay } from "./standin-relay.mjs";
import { mintSessionTokens } from "../shared/session-token.mjs";
import { isPeerReattachedFrame } from "../shared/control-frames.mjs";

const SECRET = "expired-reattach-test-secret";

// ── generic waiters (same idioms as reconnect-reattach.test.mjs) ───────────────
async function waitFor(pred, ms, label, pollMs = 25) {
  const started = Date.now();
  for (;;) {
    const v = await pred();
    if (v) return v;
    if (Date.now() - started > ms) throw new Error(`timed out after ${ms}ms waiting for ${label}`);
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Open a raw ws leg and collect its TEXT control frames + binary bytes. */
async function openRawLeg(relayUrl, session, role, token) {
  const ws = new WebSocket(`${relayUrl}/?session=${session}&role=${role}&token=${encodeURIComponent(token)}`);
  const leg = { ws, texts: [], binary: "", closed: null };
  ws.on("message", (data, isBinary) => {
    if (isBinary) leg.binary += Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
    else leg.texts.push(Buffer.isBuffer(data) ? data.toString("utf8") : String(data));
  });
  ws.on("close", (code, reasonBuf) => { leg.closed = [code, reasonBuf ? reasonBuf.toString() : ""]; });
  await Promise.race([
    once(ws, "open"),
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${role} open timeout`)), 5000)),
  ]);
  return leg;
}

const hasFrame = (leg, pred) => leg.texts.some(pred);

/** Mint a token pair with a tiny TTL, then wait until it is PROVABLY expired. */
async function mintAndAge({ sub, sid }) {
  const tokens = await mintSessionTokens({ sub, idea: "idea-ER", sid, secret: SECRET, ttlSeconds: 1 });
  return {
    tokens,
    ageOut: async () => {
      // exp = floor(mint-time)+1; 1.6s later floor(now) >= exp is guaranteed.
      await sleep(1600);
      assert.ok(Math.floor(Date.now() / 1000) >= tokens.exp, "tokens must be past exp before the reattach");
    },
  };
}

// ── (1) aged reattach succeeds on BOTH legs ────────────────────────────────────
test("(1) aged session: BOTH legs drop past the TTL, reattach with the SAME expired tokens → whole + bytes resume", { timeout: 20000 }, async (t) => {
  const session = `er-1-${Math.random().toString(36).slice(2, 8)}`;
  const owner = `user-${Math.random().toString(36).slice(2, 8)}`;
  const relay = await startStandinRelay({ port: 0, secret: SECRET, graceMs: 8000 });
  t.after(() => relay.close());
  const { tokens, ageOut } = await mintAndAge({ sub: owner, sid: session });

  // Establish while the tokens are still live (TTL bounds establishment).
  let browser = await openRawLeg(relay.url, session, "browser", tokens.browser);
  let bridge = await openRawLeg(relay.url, session, "bridge", tokens.bridge);

  // Age the session past the token TTL, then drop BOTH legs (sleep-style 1006).
  await ageOut();
  browser.ws.terminate();
  bridge.ws.terminate();
  await waitFor(() => relay.sessions.get(session)?.bridge == null && relay.sessions.get(session)?.browser == null, 5000, "both legs dropped");
  assert.ok(relay.sessions.has(session), "session held (grace window) after both legs dropped");

  // Reattach BOTH legs with the ORIGINAL — now expired — tokens, inside grace.
  browser = await openRawLeg(relay.url, session, "browser", tokens.browser);
  t.after(() => { try { browser.ws.terminate(); } catch { /* */ } });
  bridge = await openRawLeg(relay.url, session, "bridge", tokens.bridge);
  t.after(() => { try { bridge.ws.terminate(); } catch { /* */ } });

  await waitFor(() => hasFrame(browser, isPeerReattachedFrame), 5000, "peer-reattached to browser");
  await waitFor(() => hasFrame(bridge, isPeerReattachedFrame), 5000, "peer-reattached to bridge");
  assert.equal(browser.closed, null, "reattached browser leg was NOT closed (no 4006)");
  assert.equal(bridge.closed, null, "reattached bridge leg was NOT closed (no 4006)");

  // Bytes flow again through the re-paired session.
  const tok = `AGED-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  bridge.ws.send(Buffer.from(tok, "utf8"), { binary: true });
  await waitFor(() => browser.binary.includes(tok), 5000, "post-reattach byte flow");
  console.log("[er/1] PASS — aged reattach accepted on both legs, bytes resumed");
});

// ── (2) establishment on a virgin sid still requires a live token ─────────────
test("(2) first-attach with an expired token on a virgin sid → 4006 (TTL bounds establishment)", { timeout: 15000 }, async (t) => {
  const session = `er-2-${Math.random().toString(36).slice(2, 8)}`;
  const owner = `user-${Math.random().toString(36).slice(2, 8)}`;
  const relay = await startStandinRelay({ port: 0, secret: SECRET, graceMs: 8000 });
  t.after(() => relay.close());

  // Signed correctly for this sid, but expired ~59 min ago — no session exists, so
  // there is no bound owner and the waiver must NOT apply.
  const past = Math.floor(Date.now() / 1000) - 3600;
  const tokens = await mintSessionTokens({ sub: owner, idea: "idea-ER", sid: session, secret: SECRET, now: past, ttlSeconds: 60 });

  const leg = await openRawLeg(relay.url, session, "browser", tokens.browser);
  await waitFor(() => leg.closed != null, 5000, "expired first-attach close");
  assert.equal(leg.closed[0], 4006, "virgin-sid establishment with an expired token must close 4006");
  assert.equal(relay.sessions.has(session), false, "no session state was created");
  console.log("[er/2] PASS — expired token cannot ESTABLISH a session");
});

// ── (3) foreign-owner expired reattach → 4006 ──────────────────────────────────
test("(3) foreign-owner EXPIRED token against a held session → 4006; survivor untouched", { timeout: 15000 }, async (t) => {
  const session = `er-3-${Math.random().toString(36).slice(2, 8)}`;
  const ownerA = `user-A-${Math.random().toString(36).slice(2, 8)}`;
  const ownerB = `user-B-${Math.random().toString(36).slice(2, 8)}`;
  const relay = await startStandinRelay({ port: 0, secret: SECRET, graceMs: 8000 });
  t.after(() => relay.close());

  // Owner A establishes normally, then the bridge drops → session held for A.
  const a = await mintSessionTokens({ sub: ownerA, idea: "idea-ER", sid: session, secret: SECRET });
  const browser = await openRawLeg(relay.url, session, "browser", a.browser);
  t.after(() => { try { browser.ws.terminate(); } catch { /* */ } });
  const bridge = await openRawLeg(relay.url, session, "bridge", a.bridge);
  bridge.ws.terminate();
  await waitFor(() => relay.sessions.get(session)?.bridge == null, 5000, "bridge slot freed (held)");

  // Owner B presents an EXPIRED (signature-valid, sid/role-correct) token: the
  // waiver requires sub === boundOwner, so this fails like plain expiry → 4006,
  // NOT 4005 — a foreign expired token must not learn the session is live.
  const past = Math.floor(Date.now() / 1000) - 3600;
  const b = await mintSessionTokens({ sub: ownerB, idea: "idea-ER", sid: session, secret: SECRET, now: past, ttlSeconds: 60 });
  const intruder = await openRawLeg(relay.url, session, "bridge", b.bridge);
  await waitFor(() => intruder.closed != null, 5000, "intruder close");
  assert.equal(intruder.closed[0], 4006, "foreign expired reattach must be rejected 4006 (same as plain expiry)");
  assert.equal(browser.ws.readyState, WebSocket.OPEN, "the held owner-A survivor is untouched");
  assert.ok(relay.sessions.has(session), "session still held for the rightful owner");
  console.log("[er/3] PASS — foreign-owner expired token rejected without a liveness leak");
});

// ── (4) after the grace teardown, expired tokens are dead for good ─────────────
test("(4) reattach after grace expiry (session reaped, owner released) → 4006", { timeout: 15000 }, async (t) => {
  const session = `er-4-${Math.random().toString(36).slice(2, 8)}`;
  const owner = `user-${Math.random().toString(36).slice(2, 8)}`;
  const relay = await startStandinRelay({ port: 0, secret: SECRET, graceMs: 250 });
  t.after(() => relay.close());
  const { tokens, ageOut } = await mintAndAge({ sub: owner, sid: session });

  const browser = await openRawLeg(relay.url, session, "browser", tokens.browser);
  const bridge = await openRawLeg(relay.url, session, "bridge", tokens.bridge);

  // Drop both and let the tiny grace window elapse → old teardown, owner released.
  browser.ws.terminate();
  bridge.ws.terminate();
  await waitFor(() => !relay.sessions.has(session), 5000, "session reaped after grace expiry");

  // Ensure the tokens are past exp, then try to come back: with the owner binding
  // gone there is nothing to waive against → establishment rules → 4006.
  await ageOut();
  const late = await openRawLeg(relay.url, session, "browser", tokens.browser);
  await waitFor(() => late.closed != null, 5000, "late reattach close");
  assert.equal(late.closed[0], 4006, "expired reattach after the grace teardown must close 4006");
  console.log("[er/4] PASS — the waiver dies with the session (owner binding released)");
});

// ── (5) expired same-owner browser preemption of a zombie leg ──────────────────
test("(5) aged session: same-owner browser with the EXPIRED token preempts its zombie leg (stale gets 4001 preempted)", { timeout: 20000 }, async (t) => {
  const session = `er-5-${Math.random().toString(36).slice(2, 8)}`;
  const owner = `user-${Math.random().toString(36).slice(2, 8)}`;
  const relay = await startStandinRelay({ port: 0, secret: SECRET, graceMs: 8000 });
  t.after(() => relay.close());
  const { tokens, ageOut } = await mintAndAge({ sub: owner, sid: session });

  const zombie = await openRawLeg(relay.url, session, "browser", tokens.browser);
  const bridge = await openRawLeg(relay.url, session, "bridge", tokens.bridge);
  t.after(() => { try { bridge.ws.terminate(); } catch { /* */ } });

  // Age past the TTL. The first browser leg is now a ZOMBIE (still registered
  // server-side, e.g. after a silent link death) and the token is expired.
  await ageOut();
  const fresh = await openRawLeg(relay.url, session, "browser", tokens.browser);
  t.after(() => { try { fresh.ws.terminate(); } catch { /* */ } });

  // The stale leg is preempted (4001 "preempted"); the fresh leg takes the slot.
  await waitFor(() => zombie.closed != null, 5000, "zombie browser closed");
  assert.equal(zombie.closed[0], 4001, "stale leg must be closed with the preempted/duplicate code 4001");
  assert.match(zombie.closed[1], /preempted/, "close reason says preempted");
  assert.equal(fresh.closed, null, "the preempting (expired-token, same-owner) leg was accepted");

  // The swapped-in leg is live: bridge bytes reach it.
  const tok = `SWAP-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  bridge.ws.send(Buffer.from(tok, "utf8"), { binary: true });
  await waitFor(() => fresh.binary.includes(tok), 5000, "post-preemption byte flow");
  assert.equal(fresh.ws.readyState, WebSocket.OPEN, "fresh browser leg stays live");
  console.log("[er/5] PASS — expired same-owner preemption: zombie out, fresh leg live");
});
