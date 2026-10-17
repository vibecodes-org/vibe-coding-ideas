// Regression tests for card 6b2cb8ac, cause K: the relay kept ONE helper
// control slot per account, so a second Mac's helper preempted the first, and
// "Update now" / "Download the helper" (quiesce) went to whichever Mac held
// the slot, not the Mac the user clicked from. Helper legs are now tagged
// with the Mac's names (its fixed name + aliases); a relaunch on the SAME Mac
// still replaces the old leg, other Macs' legs stay, and status/command can
// be targeted with `machines`.
//
// Run: cd terminal/relay && node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { TerminalRelay } from "./index.js";
import { mintHelperToken, mintControlToken, helperSessionId } from "../../shared/session-token.mjs";
import { parseHelperCommandFrame, encodeAlwaysOnFrame, encodeGoodbyeFrame } from "../../shared/control-frames.mjs";
import { makeFakeStorage, makeFakeState, withWorkerGlobals } from "./fake-do.test-util.js";

const SECRET = "helper-legs-test-secret";
const OWNER = "user-A";
const SID = helperSessionId(OWNER);

/** A socket that finished closing drops out of getWebSockets(), as in workerd. */
function gone(state, ws) {
  state.sockets.splice(state.sockets.indexOf(ws), 1);
}

function makeRelay() {
  const storage = makeFakeStorage({});
  const state = makeFakeState(storage);
  return { storage, state, relay: new TerminalRelay(state, { TERMINAL_SESSION_SECRET: SECRET }) };
}

async function attachHelper(relay, params = {}) {
  const token = await mintHelperToken({ sub: OWNER, secret: SECRET });
  const qs = new URLSearchParams({ session: SID, role: "helper", token, helperVersion: "0.3.25", ...params });
  const { server } = await withWorkerGlobals(() => relay.fetch(new Request(`https://relay.example.test/?${qs}`)));
  return server;
}

async function control() {
  return mintControlToken({ sub: OWNER, sid: SID, secret: SECRET });
}

async function status(relay, machines) {
  const qs = new URLSearchParams({ session: SID });
  if (machines !== undefined) qs.set("machines", machines);
  const res = await relay.fetch(
    new Request(`https://relay.example.test/helper/status?${qs}`, { headers: { Authorization: `Bearer ${await control()}` } }),
  );
  return res.json();
}

async function command(relay, body) {
  const res = await relay.fetch(
    new Request(`https://relay.example.test/helper/command?session=${SID}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await control()}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return res.json();
}

const cmdsSent = (ws) => ws.sent.map((f) => parseHelperCommandFrame(f)).filter(Boolean);

test("two Macs' helper legs coexist; a relaunch on the SAME Mac retires only that Mac's old leg", async () => {
  const { relay } = makeRelay();
  const book = await attachHelper(relay, { machineLabel: "Nicks-MacBook-Pro.local", machineAliases: "Nicks-MBP.home.local" });
  const mini = await attachHelper(relay, { machineLabel: "Nicks-Mac-mini.local" });
  assert.deepEqual(book.closes, [], "another Mac's helper must not knock the MacBook off");
  assert.deepEqual(mini.closes, []);

  // The MacBook relaunches, reporting its drifted hostname as the label this time.
  const book2 = await attachHelper(relay, { machineLabel: "Nicks-MBP.home.local" });
  assert.equal(book.closes.length, 1, "same Mac (shared name) → old leg retired");
  assert.equal(book.closes[0][0], 4001);
  assert.deepEqual(mini.closes, [], "the mini's leg survives");
  assert.deepEqual(book2.closes, []);
});

test("a helper leg with no names keeps today's behaviour: it replaces every helper leg", async () => {
  const { relay } = makeRelay();
  const a = await attachHelper(relay, { machineLabel: "A.local" });
  const nameless = await attachHelper(relay, {});
  assert.equal(a.closes.length, 1);
  assert.deepEqual(nameless.closes, []);
});

test("quiesce with machines=[mini] reaches ONLY the mini's helper", async () => {
  const { relay } = makeRelay();
  const book = await attachHelper(relay, { machineLabel: "Nicks-MacBook-Pro.local" });
  const mini = await attachHelper(relay, { machineLabel: "Nicks-Mac-mini.local" });
  const res = await command(relay, { cmd: "quiesce", machines: ["nicks-mac-mini.local"] });
  assert.deepEqual(res, { delivered: true });
  assert.deepEqual(cmdsSent(mini), [{ cmd: "quiesce" }]);
  assert.deepEqual(cmdsSent(book), []);
});

test("machines matching no live helper → delivered:false 'not-on-this-mac'; an empty list → 'machine-unknown'", async () => {
  const { relay } = makeRelay();
  const book = await attachHelper(relay, { machineLabel: "Nicks-MacBook-Pro.local" });
  assert.deepEqual(await command(relay, { cmd: "quiesce", machines: ["Nicks-Mac-mini.local"] }), {
    delivered: false,
    reason: "not-on-this-mac",
  });
  assert.deepEqual(await command(relay, { cmd: "quiesce", machines: ["", 5] }), { delivered: false, reason: "machine-unknown" });
  assert.deepEqual(cmdsSent(book), []);
});

test("no machines (an old page) → the newest live helper leg, as today", async () => {
  const { relay } = makeRelay();
  const book = await attachHelper(relay, { machineLabel: "Nicks-MacBook-Pro.local" });
  const mini = await attachHelper(relay, { machineLabel: "Nicks-Mac-mini.local" });
  assert.deepEqual(await command(relay, { cmd: "stop" }), { delivered: true });
  assert.deepEqual(cmdsSent(mini), [{ cmd: "stop" }]);
  assert.deepEqual(cmdsSent(book), []);
});

test("status per machine: connected only for the Mac asked about; last-known fields kept per Mac", async () => {
  const { relay, state } = makeRelay();
  const book = await attachHelper(relay, { machineLabel: "Nicks-MacBook-Pro.local", helperVersion: "0.3.24", alwaysOn: "1" });
  await attachHelper(relay, { machineLabel: "Nicks-Mac-mini.local", helperVersion: "0.3.25" });

  const sBook = await status(relay, "Nicks-MacBook-Pro.local");
  assert.equal(sBook.connected, true);
  assert.equal(sBook.version, "0.3.24");
  assert.equal(sBook.machineLabel, "Nicks-MacBook-Pro.local");
  assert.equal(sBook.alwaysOn, true);

  const sMini = await status(relay, "Nicks-Mac-mini.local");
  assert.equal(sMini.connected, true);
  assert.equal(sMini.version, "0.3.25");
  assert.equal(sMini.alwaysOn, false);

  // The MacBook's helper drops without a goodbye → its status alone shows it.
  await relay.webSocketClose(book, 1006, "", false);
  gone(state, book);
  const after = await status(relay, "Nicks-MacBook-Pro.local");
  assert.equal(after.connected, false);
  assert.equal(after.stoppedUnexpectedly, true);
  assert.equal(after.version, "0.3.24");
  assert.equal((await status(relay, "Nicks-Mac-mini.local")).connected, true);

  const unknown = await status(relay, "Somebody-Else.local");
  assert.equal(unknown.connected, false);
  assert.equal(unknown.version, null);
});

test("status with no machines param is today's account-wide answer", async () => {
  const { relay } = makeRelay();
  await attachHelper(relay, { machineLabel: "A.local", helperVersion: "0.3.24" });
  const s = await status(relay);
  assert.equal(s.connected, true);
  assert.equal(s.version, "0.3.24");
});

test("an always-on frame updates only the sending Mac's status; a goodbye keeps the stop clean", async () => {
  const { relay, state } = makeRelay();
  const book = await attachHelper(relay, { machineLabel: "Book.local" });
  await attachHelper(relay, { machineLabel: "Mini.local" });
  await relay.webSocketMessage(book, encodeAlwaysOnFrame(true));
  assert.equal((await status(relay, "Book.local")).alwaysOn, true);
  assert.equal((await status(relay, "Mini.local")).alwaysOn, false);

  await relay.webSocketMessage(book, encodeGoodbyeFrame("quiesce"));
  await relay.webSocketClose(book, 1000, "", true);
  gone(state, book);
  const s = await status(relay, "Book.local");
  assert.equal(s.connected, false);
  assert.equal(s.stoppedUnexpectedly, false);
});
