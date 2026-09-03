// Unit tests for the shared vibecodes:// launch deep-link module — SLICE 4.
//
// Proves the build ⇄ parse round-trip the same-machine auto-launch relies on, and
// that the bridge token is redactable for logs (never leaked).
//
// Run: cd terminal/test && node --test

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildLaunchDeepLink,
  encodePromptParam,
  parseLaunchDeepLink,
  redactDeepLinkToken,
  LAUNCH_SCHEME,
  LAUNCH_HOST,
} from "../shared/deep-link.mjs";

const SAMPLE = {
  relay: "ws://127.0.0.1:8787",
  session: "11111111-2222-3333-4444-555555555555",
  token: "eyJzdWIiOiJ1c2VyIn0.aBcD-_eFgH+/=sigbytes",
  cwd: "/Users/nick/projects/my idea",
};

test("build ⇄ parse round-trips with cwd", () => {
  const url = buildLaunchDeepLink(SAMPLE);
  assert.ok(url.startsWith(`${LAUNCH_SCHEME}://${LAUNCH_HOST}?`));
  assert.deepEqual(parseLaunchDeepLink(url), SAMPLE);
});

test("build ⇄ parse round-trips without cwd", () => {
  const noCwd = { relay: SAMPLE.relay, session: SAMPLE.session, token: SAMPLE.token };
  assert.deepEqual(parseLaunchDeepLink(buildLaunchDeepLink(noCwd)), noCwd);
});

test("buildLaunchDeepLink throws on a missing required field", () => {
  assert.throws(() => buildLaunchDeepLink({ relay: "", session: "s", token: "t" }));
  assert.throws(() => buildLaunchDeepLink({ relay: "r", session: "", token: "t" }));
  assert.throws(() => buildLaunchDeepLink({ relay: "r", session: "s", token: "" }));
});

test("parseLaunchDeepLink rejects a foreign scheme / wrong action / junk", () => {
  assert.equal(parseLaunchDeepLink("claude-cli://open?q=hi"), null);
  assert.equal(parseLaunchDeepLink(`${LAUNCH_SCHEME}://nope?relay=r&session=s&token=t`), null);
  assert.equal(parseLaunchDeepLink("not a url"), null);
  assert.equal(parseLaunchDeepLink(""), null);
  assert.equal(parseLaunchDeepLink(null), null);
});

test("parseLaunchDeepLink returns null when a required param is absent", () => {
  assert.equal(parseLaunchDeepLink(`${LAUNCH_SCHEME}://${LAUNCH_HOST}?relay=r&session=s`), null);
});

test("redactDeepLinkToken hides the token but keeps the rest", () => {
  const url = buildLaunchDeepLink(SAMPLE);
  const redacted = redactDeepLinkToken(url);
  assert.match(redacted, /token=\*\*\*/);
  assert.ok(!redacted.includes(SAMPLE.token), "raw token must not appear");
  assert.ok(!redacted.includes(encodeURIComponent(SAMPLE.token)), "encoded token must not appear");
  assert.ok(redacted.includes(`session=${SAMPLE.session}`), "non-secret params survive");
});

// ── bootstrap prompt param (in-browser terminal parity) ───────────────────────

// Hostile prompt: shell metacharacters, quotes, expansion, newlines. It is INERT
// DATA end to end — must round-trip verbatim and never appear in a redacted log.
const HOSTILE_PROMPT =
  "Set up $(rm -rf ~) `hostname` \"double\" 'single' ; & | > < \\ %20 + \n second line $HOME";

test("build ⇄ parse round-trips a prompt (incl. hostile characters, verbatim)", () => {
  const withPrompt = { ...SAMPLE, prompt: HOSTILE_PROMPT };
  const url = buildLaunchDeepLink(withPrompt);
  assert.ok(url.endsWith(`prompt=${encodePromptParam(HOSTILE_PROMPT)}`), "prompt is the LAST param");
  assert.deepEqual(parseLaunchDeepLink(url), withPrompt);
});

test("prompt spaces ride as `+` (URLSearchParams decodes them), a literal `+` stays %2B", () => {
  assert.equal(encodePromptParam("a b+c  d"), "a+b%2Bc++d");
  const url = buildLaunchDeepLink({ ...SAMPLE, prompt: "a b+c  d" });
  assert.ok(url.endsWith("prompt=a+b%2Bc++d"));
  assert.equal(parseLaunchDeepLink(url).prompt, "a b+c  d");
});

test("promptless links keep today's exact shape — no prompt key, no prompt param", () => {
  const url = buildLaunchDeepLink(SAMPLE);
  assert.ok(!url.includes("prompt="));
  const parsed = parseLaunchDeepLink(url);
  assert.deepEqual(parsed, SAMPLE);
  assert.ok(!("prompt" in parsed), "no prompt key on a promptless link");
});

// ── helper token param (card cc74a067, helper lifecycle) ──────────────────────

test("build ⇄ parse round-trips helperToken, positioned before prompt", () => {
  const withHelper = { ...SAMPLE, helperToken: "eyJzdWIiOiJ1c2VyIn0.helperSig", prompt: "hello" };
  const url = buildLaunchDeepLink(withHelper);
  assert.ok(url.includes("helperToken="));
  assert.ok(url.indexOf("helperToken=") < url.indexOf("prompt="), "helperToken precedes the LAST param, prompt");
  assert.deepEqual(parseLaunchDeepLink(url), withHelper);
});

test("omits helperToken entirely when absent", () => {
  const url = buildLaunchDeepLink(SAMPLE);
  assert.ok(!url.includes("helperToken="));
  assert.ok(!("helperToken" in parseLaunchDeepLink(url)));
});

test("redactDeepLinkToken hides helperToken as well as token", () => {
  const withHelper = { ...SAMPLE, helperToken: "super-secret-helper-token" };
  const redacted = redactDeepLinkToken(buildLaunchDeepLink(withHelper));
  assert.match(redacted, /helperToken=\*\*\*/);
  assert.ok(!redacted.includes("super-secret-helper-token"));
  assert.ok(redacted.includes(`session=${SAMPLE.session}`));
});

// ── exact-conversation resume (rework 5, card cbe60db5) ────────────────────────

const RESUME_ID = "99999999-8888-7777-6666-555555555555";

test("build ⇄ parse round-trips resume_id, positioned before prompt", () => {
  const withResumeId = { ...SAMPLE, resumeId: RESUME_ID, prompt: "ignored on a real resume link" };
  const url = buildLaunchDeepLink(withResumeId);
  assert.ok(url.includes(`resume_id=${RESUME_ID}`));
  assert.ok(url.indexOf("resume_id=") < url.indexOf("prompt="), "resume_id precedes the LAST param, prompt");
  assert.deepEqual(parseLaunchDeepLink(url), withResumeId);
});

test("omits resume_id entirely when absent", () => {
  const url = buildLaunchDeepLink(SAMPLE);
  assert.ok(!url.includes("resume_id="));
  assert.ok(!("resumeId" in parseLaunchDeepLink(url)));
});

test("resumeId wins over the legacy resume flag when both are somehow set", () => {
  const url = buildLaunchDeepLink({ ...SAMPLE, resume: true, resumeId: RESUME_ID });
  assert.ok(url.includes(`resume_id=${RESUME_ID}`));
  assert.ok(!url.includes("resume=1"));
  const parsed = parseLaunchDeepLink(url);
  assert.equal(parsed.resumeId, RESUME_ID);
  assert.ok(!("resume" in parsed));
});

test("a malformed resume_id is rejected outright — never forwarded to the caller", () => {
  const url = `${LAUNCH_SCHEME}://${LAUNCH_HOST}?relay=r&session=s&token=t&resume_id=not-a-uuid`;
  const parsed = parseLaunchDeepLink(url);
  assert.ok(parsed !== null);
  assert.ok(!("resumeId" in parsed));
});

// ── real panel size at spawn (Bug B, card cbe60db5) ────────────────────────────

test("build ⇄ parse round-trips cols/rows, positioned before prompt", () => {
  const withDims = { ...SAMPLE, cols: 137, rows: 42, prompt: "hello" };
  const url = buildLaunchDeepLink(withDims);
  assert.ok(url.includes("cols=137"));
  assert.ok(url.includes("rows=42"));
  assert.ok(url.indexOf("cols=") < url.indexOf("prompt="), "cols precedes the LAST param, prompt");
  assert.deepEqual(parseLaunchDeepLink(url), withDims);
});

test("omits cols/rows entirely when absent", () => {
  const url = buildLaunchDeepLink(SAMPLE);
  assert.ok(!url.includes("cols="));
  assert.ok(!url.includes("rows="));
  const parsed = parseLaunchDeepLink(url);
  assert.ok(!("cols" in parsed) && !("rows" in parsed));
});

test("a lone dimension (missing pair) is dropped entirely — never a half pair", () => {
  const url = buildLaunchDeepLink({ ...SAMPLE, cols: 120 }); // rows omitted
  assert.ok(!url.includes("cols="));
  const parsedHalf = parseLaunchDeepLink(
    `${LAUNCH_SCHEME}://${LAUNCH_HOST}?relay=r&session=s&token=t&cols=120`,
  );
  assert.ok(!("cols" in parsedHalf) && !("rows" in parsedHalf));
});

test("non-sane cols/rows (zero, negative, non-integer, absurdly large) are rejected outright", () => {
  for (const bad of ["0", "-5", "12.5", "abc", "100000"]) {
    const url = `${LAUNCH_SCHEME}://${LAUNCH_HOST}?relay=r&session=s&token=t&cols=${bad}&rows=40`;
    const parsed = parseLaunchDeepLink(url);
    assert.ok(parsed !== null);
    assert.ok(!("cols" in parsed) && !("rows" in parsed), `cols=${bad} must not survive parsing`);
  }
});

// ── terminal starting model (task c4ca2d95) ────────────────────────────────

test("build ⇄ parse round-trips model, positioned before prompt", () => {
  const withModel = { ...SAMPLE, model: "opus", prompt: "hello" };
  const url = buildLaunchDeepLink(withModel);
  assert.ok(url.includes("model=opus"));
  assert.ok(url.indexOf("model=") < url.indexOf("prompt="), "model precedes the LAST param, prompt");
  assert.deepEqual(parseLaunchDeepLink(url), withModel);
});

test("omits model entirely when absent — no version-skew risk for an old bridge/helper (AC-13)", () => {
  const url = buildLaunchDeepLink(SAMPLE);
  assert.ok(!url.includes("model="));
  assert.ok(!("model" in parseLaunchDeepLink(url)));
});

test("round-trips a custom (non-alias) model id verbatim", () => {
  const url = buildLaunchDeepLink({ ...SAMPLE, model: "claude-opus-5-20260101" });
  assert.equal(parseLaunchDeepLink(url).model, "claude-opus-5-20260101");
});

test("a malformed model value (whitespace/shell metacharacters) is rejected outright — never forwarded", () => {
  const url = `${LAUNCH_SCHEME}://${LAUNCH_HOST}?relay=r&session=s&token=t&model=${encodeURIComponent("opus; rm -rf")}`;
  const parsed = parseLaunchDeepLink(url);
  assert.ok(parsed !== null);
  assert.ok(!("model" in parsed));
});

test("redactDeepLinkToken leaves model untouched — not a secret or free-form user content (AC-10)", () => {
  const url = buildLaunchDeepLink({ ...SAMPLE, model: "opus" });
  const redacted = redactDeepLinkToken(url);
  assert.ok(redacted.includes("model=opus"));
});

// ── terminal auto-accept mode (task d3de150c) ──────────────────────────────

test("build ⇄ parse round-trips permissionMode, positioned before prompt", () => {
  const withMode = { ...SAMPLE, permissionMode: "auto", prompt: "hello" };
  const url = buildLaunchDeepLink(withMode);
  assert.ok(url.includes("permissionMode=auto"));
  assert.ok(url.indexOf("permissionMode=") < url.indexOf("prompt="), "permissionMode precedes the LAST param, prompt");
  assert.deepEqual(parseLaunchDeepLink(url), withMode);
});

test("omits permissionMode entirely when absent — no version-skew risk for an old bridge/helper", () => {
  const url = buildLaunchDeepLink(SAMPLE);
  assert.ok(!url.includes("permissionMode="));
  assert.ok(!("permissionMode" in parseLaunchDeepLink(url)));
});

test("never fires a forbidden permissionMode value — hard whitelist, builder side", () => {
  const url = buildLaunchDeepLink({ ...SAMPLE, permissionMode: "bypassPermissions" });
  assert.ok(!url.includes("permissionMode="));
});

test("a forbidden permissionMode value on the wire (e.g. bypassPermissions) is rejected outright — never forwarded", () => {
  const url = `${LAUNCH_SCHEME}://${LAUNCH_HOST}?relay=r&session=s&token=t&permissionMode=bypassPermissions`;
  const parsed = parseLaunchDeepLink(url);
  assert.ok(parsed !== null);
  assert.ok(!("permissionMode" in parsed));
});

test("redactDeepLinkToken leaves permissionMode untouched — not a secret or free-form user content", () => {
  const url = buildLaunchDeepLink({ ...SAMPLE, permissionMode: "auto" });
  const redacted = redactDeepLinkToken(url);
  assert.ok(redacted.includes("permissionMode=auto"));
});

test("redactDeepLinkToken elides the prompt (user content) as well as the token", () => {
  const url = buildLaunchDeepLink({ ...SAMPLE, prompt: HOSTILE_PROMPT });
  const redacted = redactDeepLinkToken(url);
  assert.match(redacted, /token=\*\*\*/);
  assert.match(redacted, /prompt=\*\*\*/);
  assert.ok(!redacted.includes(SAMPLE.token), "raw token must not appear");
  assert.ok(!redacted.includes(encodeURIComponent(HOSTILE_PROMPT)), "encoded prompt must not appear");
  assert.ok(redacted.includes(`session=${SAMPLE.session}`), "non-secret params survive");
});

// ── concurrent-terminal isolation (native --worktree flag) ─────────────────

test("build ⇄ parse round-trips worktree, positioned before prompt", () => {
  const withWorktree = { ...SAMPLE, worktree: true, prompt: "hello" };
  const url = buildLaunchDeepLink(withWorktree);
  assert.ok(url.includes("worktree=1"));
  assert.ok(url.indexOf("worktree=") < url.indexOf("prompt="), "worktree precedes the LAST param, prompt");
  assert.deepEqual(parseLaunchDeepLink(url), withWorktree);
});

test("omits worktree entirely when absent/false — no version-skew risk for an old bridge/helper", () => {
  const url = buildLaunchDeepLink(SAMPLE);
  assert.ok(!url.includes("worktree="));
  assert.ok(!("worktree" in parseLaunchDeepLink(url)));
  const falseUrl = buildLaunchDeepLink({ ...SAMPLE, worktree: false });
  assert.ok(!falseUrl.includes("worktree="));
});

test("a bogus worktree value on the wire is rejected outright — never forwarded", () => {
  const url = `${LAUNCH_SCHEME}://${LAUNCH_HOST}?relay=r&session=s&token=t&worktree=true`;
  const parsed = parseLaunchDeepLink(url);
  assert.ok(parsed !== null);
  assert.ok(!("worktree" in parsed));
});

test("redactDeepLinkToken leaves worktree untouched — not a secret or free-form user content", () => {
  const url = buildLaunchDeepLink({ ...SAMPLE, worktree: true });
  const redacted = redactDeepLinkToken(url);
  assert.ok(redacted.includes("worktree=1"));
});
