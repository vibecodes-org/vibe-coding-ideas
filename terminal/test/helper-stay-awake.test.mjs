// Stay-awake decision + helper packaging/idle-quit guards (card f4be2981).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { decideStayAwake, stayAwakeLabel } = require("../helper/stay-awake.js");
const { decideLingerAction, shouldQuitOnLingerExpiry } =require("../helper/lifecycle.js");

test("starts when the first agent goes busy, stops when the last goes quiet", () => {
  assert.equal(decideStayAwake(1, false), "start");
  assert.equal(decideStayAwake(2, true), "keep");
  assert.equal(decideStayAwake(0, true), "stop");
  assert.equal(decideStayAwake(0, false), "keep");
});

test("menu-bar label is singular and plural", () => {
  assert.equal(stayAwakeLabel(1), "Keeping this Mac awake: 1 agent working");
  assert.equal(stayAwakeLabel(3), "Keeping this Mac awake: 3 agents working");
});

test("stay-awake.js is packed into the app (electron-builder files list)", () => {
  const yml = fs.readFileSync(new URL("../helper/electron-builder.yml", import.meta.url), "utf8");
  assert.match(yml, /^\s*- stay-awake\.js\s*$/m);
});

test("a running bridge with no browser attached keeps the helper running (not idle)", () => {
  assert.equal(decideLingerAction({ bridgeCount: 1, alwaysOn: false }), "cancel");
  assert.equal(shouldQuitOnLingerExpiry({ bridgeCount: 1, alwaysOn: false }), false);
});
