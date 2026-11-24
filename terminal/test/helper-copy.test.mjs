// The helper's machine wording (card 51d424f7, release 1b): the Mac keeps its
// exact words; a Windows PC never sees "Mac" or "menu bar".
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { signOutLabel, wrongAccountNotice } = require("../helper/helper-copy.js");

test("the Mac wording is unchanged", () => {
  assert.equal(signOutLabel("darwin"), "Sign out this Mac");
  assert.equal(
    wrongAccountNotice("darwin"),
    "That link is for a different VibeCodes account than this Mac's helper. Nothing was started. To switch accounts, choose \"Sign out this Mac\" from the helper's menu-bar icon.",
  );
});

test("Windows says PC and points at the icon by the clock", () => {
  assert.equal(signOutLabel("win32"), "Sign out this PC");
  const notice = wrongAccountNotice("win32");
  assert.match(notice, /Sign out this PC/);
  assert.match(notice, /icon by the clock/);
  for (const word of ["Mac", "menu bar", "menu-bar"]) {
    assert.equal(notice.includes(word), false, word);
    assert.equal(signOutLabel("win32").includes(word), false, word);
  }
});
