import { test } from "node:test";
import assert from "node:assert/strict";
import { createCatchupBuffer } from "./catchup-buffer.js";

test("keeps chunks in order under the cap", () => {
  const b = createCatchupBuffer(100);
  b.push(Buffer.from("aa"));
  b.push(Buffer.from("bb"));
  assert.equal(b.length, 2);
  assert.equal(b.shift().toString(), "aa");
  assert.equal(b.bytes, 2);
});

test("drops the oldest chunks once over the cap", () => {
  const b = createCatchupBuffer(10);
  for (const s of ["aaaa", "bbbb", "cccc"]) b.push(Buffer.from(s));
  assert.equal(b.bytes, 8);
  assert.equal(b.droppedBytes, 4);
  assert.equal(b.shift().toString(), "bbbb");
});

test("a single chunk over the cap is still kept", () => {
  const b = createCatchupBuffer(3);
  b.push(Buffer.from("zzzzzz"));
  assert.equal(b.length, 1);
});

test("stays bounded over a long gap", () => {
  const b = createCatchupBuffer(1000);
  for (let i = 0; i < 10000; i++) b.push(Buffer.alloc(100));
  assert.ok(b.bytes <= 1000);
});
