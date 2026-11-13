// A vibecodes:// link reaches the helper on the command line (Windows cold
// start and the second-instance forward). Windows-shaped argument lists.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { urlFromArgv } = require("../helper/launch-argv.js");
const P = "vibecodes://";
const LINK = "vibecodes://launch?relay=wss%3A%2F%2Fr.example&sid=abc&token=t.x";

test("finds the link after the exe path (Windows cold start)", () => {
  assert.equal(urlFromArgv(["C:\\Users\\Sam\\AppData\\Local\\Programs\\VibeCodes\\VibeCodes.exe", LINK], P), LINK);
});

test("finds the link in a second-instance argv with extra flags", () => {
  assert.equal(urlFromArgv(["VibeCodes.exe", "--allow-file-access-from-files", LINK], P), LINK);
});

test("tolerates a link wrapped in quotes", () => {
  assert.equal(urlFromArgv(["VibeCodes.exe", `"${LINK}"`], P), LINK);
});

test("a login start (--hidden) has no link", () => {
  assert.equal(urlFromArgv(["VibeCodes.exe", "--hidden"], P), undefined);
});

test("never throws on odd input", () => {
  assert.equal(urlFromArgv(undefined, P), undefined);
  assert.equal(urlFromArgv([null, 5, {}], P), undefined);
});

test("launch-argv.js is packed into the app (electron-builder files list)", () => {
  const yml = fs.readFileSync(new URL("../helper/electron-builder.yml", import.meta.url), "utf8");
  assert.match(yml, /^\s*- launch-argv\.js\s*$/m);
});
