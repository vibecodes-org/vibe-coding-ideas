// The Windows installer smoke test reads the registry through `reg query` and
// decides from its text whether the link handler and the start-at-login entry
// point at the installed app (card 51d424f7, release 1b). These pin that
// reading, so a wrong parse can't turn a broken installer into a pass.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRegQuery, pointsAt, PTY_OK_SCRIPT } from "../helper/scripts/smoke-win-lib.mjs";

const EXE = "C:\\Users\\runneradmin\\AppData\\Local\\Programs\\VibeCodes\\VibeCodes.exe";

test("reads the link handler's default value", () => {
  const out = [
    "",
    "HKEY_CURRENT_USER\\Software\\Classes\\vibecodes\\shell\\open\\command",
    `    (Default)    REG_SZ    "${EXE}" "%1"`,
    "",
  ].join("\r\n");
  assert.deepEqual(parseRegQuery(out), [{ name: "(Default)", type: "REG_SZ", data: `"${EXE}" "%1"` }]);
});

test("reads every start-at-login value, names with spaces included", () => {
  const out = [
    "",
    "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
    "    OneDrive    REG_SZ    \"C:\\Program Files\\Microsoft OneDrive\\OneDrive.exe\" /background",
    `    co.uk.vibecodes.helper    REG_SZ    "${EXE}" --hidden`,
    "    Some App    REG_EXPAND_SZ    %LOCALAPPDATA%\\Some\\app.exe",
    "",
  ].join("\r\n");
  const values = parseRegQuery(out);
  assert.deepEqual(
    values.map((v) => v.name),
    ["OneDrive", "co.uk.vibecodes.helper", "Some App"],
  );
  assert.deepEqual(
    values.filter((v) => pointsAt(v.data, EXE)).map((v) => v.name),
    ["co.uk.vibecodes.helper"],
  );
});

test("an empty or missing key reads as no values", () => {
  assert.deepEqual(parseRegQuery(""), []);
  assert.deepEqual(parseRegQuery("HKEY_CURRENT_USER\\Software\\Classes\\vibecodes\r\n"), []);
});

test("pointsAt ignores case and quotes, and rejects another program", () => {
  assert.equal(pointsAt(`"${EXE.toLowerCase()}" "%1"`, EXE), true);
  assert.equal(pointsAt(`${EXE} --hidden`, EXE), true);
  assert.equal(pointsAt('"C:\\Other\\VibeCodes.exe" "%1"', EXE), false);
  assert.equal(pointsAt("", EXE), false);
});

test("the node-pty check runs a real console command and prints the result as one line", () => {
  assert.match(PTY_OK_SCRIPT, /require\(path\.join\(res, "bridge", "node_modules", "ws"\)\)/);
  assert.match(PTY_OK_SCRIPT, /require\(path\.join\(res, "bridge", "node_modules", "node-pty"\)\)/);
  assert.match(PTY_OK_SCRIPT, /"cmd\.exe", \["\/d", "\/c", "echo ok"\]/);
  // It must at least parse as a script.
  assert.doesNotThrow(() => new Function("require", "process", "setTimeout", PTY_OK_SCRIPT));
});
