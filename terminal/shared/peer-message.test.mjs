import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PEER_MAX_CHARS,
  buildPeerHeader,
  buildSessionEnvValue,
  cleanPeerText,
  encodePeerAckFrame,
  encodePeerFrame,
  isPeerBridgeFrameType,
  parsePeerAckFrame,
  signPeerEnvelope,
  splitSessionEnvValue,
  verifyPeerFrame,
  verifySenderProof,
} from "./peer-message.mjs";

const KEY = "k".repeat(43);
const NOW = 1_700_000_000_000;
const env = (over = {}) => ({ id: "11111111-aaaa", to: "target-sid", from: { sid: "s1", name: "Fix login", agent: "codex" }, text: "hello", ts: NOW, ...over });
const frame = (e = env(), key = KEY) => encodePeerFrame(signPeerEnvelope(key, e));

test("cleanPeerText strips escapes, CR, ETX, DEL and C1 characters and keeps newlines", () => {
  const r = cleanPeerText("a\x1b[31mred\x1b[0m\r\nb\x03c\x7fd\u0085e\u009bf\nline3");
  assert.equal(r.ok, true);
  assert.equal(r.text, "a[31mred[0m\nbcdef\nline3");
  assert.ok(!/[\x00-\x09\x0b-\x1f\x7f-\x9f]/.test(r.text));
});

test("cleanPeerText refuses empty and over-long text", () => {
  assert.deepEqual(cleanPeerText("  \x1b \n "), { ok: false, reason: "empty" });
  assert.deepEqual(cleanPeerText("x".repeat(PEER_MAX_CHARS + 1)), { ok: false, reason: "too-long" });
  assert.equal(cleanPeerText("x".repeat(PEER_MAX_CHARS)).ok, true);
  assert.deepEqual(cleanPeerText(5), { ok: false, reason: "not-text" });
});

test("the header is built from the row only and cannot carry a newline or quote", () => {
  const h = buildPeerHeader({ sid: "abc", name: 'Evil"\nname', agent: "codex" });
  assert.ok(!h.includes("\n"));
  assert.match(h, /^\[Message from your session "Evil' name" \(Codex\)\. Not from Nick/);
  assert.match(h, /send_session_message to "abc"\.\]$/);
});

test("a good frame verifies", () => {
  const r = verifyPeerFrame({ key: KEY, text: frame(), sid: "target-sid", now: NOW + 1000, seen: new Set() });
  assert.equal(r.ok, true);
  assert.equal(r.env.text, "hello");
});

test("bad signature, wrong key, tampering, wrong session, stale, replayed and no key are refused", () => {
  const ok = (text, extra = {}) => verifyPeerFrame({ key: KEY, text, sid: "target-sid", now: NOW, seen: new Set(), ...extra });
  assert.equal(ok(frame(env(), "other-key")).reason, "bad-signature");
  const tampered = JSON.parse(frame());
  tampered.text = "rm -rf";
  assert.equal(ok(JSON.stringify(tampered)).reason, "bad-signature");
  assert.equal(ok(frame(env({ to: "someone-else" }))).reason, "wrong-session");
  assert.equal(ok(frame(env({ ts: NOW - 121_000 }))).reason, "stale");
  assert.equal(ok(frame(), { seen: new Set(["11111111-aaaa"]) }).reason, "replayed");
  assert.equal(ok(frame(), { key: null }).reason, "no-key");
  assert.equal(ok("not json").reason, "bad-shape");
  assert.equal(ok(JSON.stringify({ t: "peer-message", v: 1 })).reason, "bad-shape");
});

test("the sender proof round-trips and a wrong proof or key fails", () => {
  const v = buildSessionEnvValue(KEY, "sid-1");
  const { sid, proof } = splitSessionEnvValue(v);
  assert.equal(sid, "sid-1");
  assert.equal(verifySenderProof(KEY, sid, proof), true);
  assert.equal(verifySenderProof("x", sid, proof), false);
  assert.equal(verifySenderProof(KEY, "sid-2", proof), false);
  assert.equal(splitSessionEnvValue("nodot"), null);
});

test("ack frames round-trip and unknown outcomes are refused", () => {
  assert.deepEqual(parsePeerAckFrame(encodePeerAckFrame("id1", "waiting")), { id: "id1", outcome: "waiting" });
  assert.equal(parsePeerAckFrame(JSON.stringify({ t: "peer-message-ack", id: "x", outcome: "bogus" })), null);
});

test("isPeerBridgeFrameType flags message, ack and notice frames only", () => {
  assert.equal(isPeerBridgeFrameType(frame()), true);
  assert.equal(isPeerBridgeFrameType(encodePeerAckFrame("i", "delivered")), true);
  assert.equal(isPeerBridgeFrameType(JSON.stringify({ type: "resize", cols: 1, rows: 1 })), false);
  assert.equal(isPeerBridgeFrameType("peer-message"), false);
});

import { helperVersionAtLeast } from "./peer-frames.mjs";
test("helperVersionAtLeast compares numerically and refuses unknown versions", () => {
  assert.equal(helperVersionAtLeast("0.3.32", "0.3.32"), true);
  assert.equal(helperVersionAtLeast("0.3.100", "0.3.32"), true);
  assert.equal(helperVersionAtLeast("0.3.31", "0.3.32"), false);
  assert.equal(helperVersionAtLeast("1.0.0", "0.3.32"), true);
  assert.equal(helperVersionAtLeast(undefined, "0.3.32"), false);
  assert.equal(helperVersionAtLeast("junk", "0.3.32"), false);
});
