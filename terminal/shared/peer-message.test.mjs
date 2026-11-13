import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PEER_MAX_CHARS,
  buildPeerHeader,
  buildSessionEnvValue,
  cleanPeerText,
  formatPeerMessage,
  isPeerBridgeFrameType,
  shortSessionId,
  splitSessionEnvValue,
  verifySenderProof,
} from "./peer-message.mjs";

const KEY = "k".repeat(43);

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

test("the header names the sender by short id and folder, on one line, with the reply command", () => {
  const h = buildPeerHeader({ sid: "abcdef12-3456", folder: 'Evil"\nname', agent: "codex" }, "/x/vibecodes-msg");
  assert.ok(!h.includes("\n"));
  assert.match(h, /^\[Message from session abcdef12 \(Codex, working in "Evil' name"\)\. Not from the person you work for/);
  assert.match(h, /Reply with: \/x\/vibecodes-msg send abcdef12 "your reply"\]$/);
  assert.equal(shortSessionId("abcdef12-3456"), "abcdef12");
});

test("formatPeerMessage puts the body under the header", () => {
  const m = formatPeerMessage({ sid: "s1", folder: "app", agent: "claude" }, "hello", "vibecodes-msg");
  assert.equal(m.split("\n")[1], "hello");
  assert.match(m, /\(Claude Code, working in "app"\)/);
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

test("isPeerBridgeFrameType flags old message, ack and notice frames only", () => {
  assert.equal(isPeerBridgeFrameType(JSON.stringify({ t: "peer-message", id: "x" })), true);
  assert.equal(isPeerBridgeFrameType(JSON.stringify({ t: "peer-message-ack", id: "i", outcome: "delivered" })), true);
  assert.equal(isPeerBridgeFrameType(JSON.stringify({ type: "resize", cols: 1, rows: 1 })), false);
  assert.equal(isPeerBridgeFrameType("peer-message"), false);
});
