// Unit tests for the dev protocol-registration gate (terminal/helper/proto-reg.js).
//
// The gate keeps dev helper runs from stealing the OS vibecodes:// handler:
// on macOS setAsDefaultProtocolClient ignores path/args and registers the raw
// Electron bundle (com.github.Electron), so dev registration must be OFF for
// everything except an explicit VIBECODES_DEV_PROTO_REG=1 opt-in.
//
// Run: cd terminal/test && node proto-reg.test.mjs   (or via `npm test`)

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { shouldRegisterProtocolInDev } = require("../helper/proto-reg.js");

test("dev registration is OFF for anything that is not exactly '1'", () => {
  assert.equal(shouldRegisterProtocolInDev({}), false, "empty env");
  assert.equal(shouldRegisterProtocolInDev({ VIBECODES_DEV_PROTO_REG: "0" }), false, '"0"');
  assert.equal(shouldRegisterProtocolInDev({ VIBECODES_DEV_PROTO_REG: "" }), false, "empty string");
  assert.equal(shouldRegisterProtocolInDev({ VIBECODES_DEV_PROTO_REG: "true" }), false, '"true"');
  assert.equal(shouldRegisterProtocolInDev(undefined), false, "undefined env");
});

test("dev registration is ON only for the exact opt-in '1'", () => {
  assert.equal(shouldRegisterProtocolInDev({ VIBECODES_DEV_PROTO_REG: "1" }), true);
});
