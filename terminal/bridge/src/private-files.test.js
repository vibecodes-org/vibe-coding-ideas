// Run: cd terminal/bridge && node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createPrivateFiles } from "./private-files.js";

test("files are owner-only in an owner-only folder, and removed on remove()", { skip: process.platform === "win32" }, () => {
  const pf = createPrivateFiles();
  const p = pf.write("peer-hooks.json", '{"secret":"s3cret"}');
  assert.equal(fs.readFileSync(p, "utf8"), '{"secret":"s3cret"}');
  assert.equal(fs.statSync(p).mode & 0o777, 0o600);
  assert.equal(fs.statSync(/** @type {string} */ (pf.dir)).mode & 0o777, 0o700);
  const dir = /** @type {string} */ (pf.dir);
  pf.remove();
  assert.equal(fs.existsSync(dir), false);
  pf.remove(); // twice is fine
});

test("a name with folders in it is refused", () => {
  const pf = createPrivateFiles();
  assert.throws(() => pf.write("../evil", "x"));
  assert.throws(() => pf.write("a/b", "x"));
  pf.remove();
});

test("nothing is created until a file is written", () => {
  const pf = createPrivateFiles();
  assert.equal(pf.dir, null);
  pf.remove();
});
