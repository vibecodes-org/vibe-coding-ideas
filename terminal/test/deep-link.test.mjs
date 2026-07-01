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
