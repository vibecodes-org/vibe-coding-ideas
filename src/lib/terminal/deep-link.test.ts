import { describe, it, expect } from "vitest";
import {
  buildLaunchDeepLink,
  redactDeepLinkToken,
  LAUNCH_SCHEME,
  LAUNCH_HOST,
} from "./deep-link";
// The bridge/helper PARSES with the shared .mjs. Importing it here pins the two
// implementations together: a link this (TS) module builds MUST parse back to the
// same fields with the shared parser, or this test fails — catching any drift.
import { parseLaunchDeepLink } from "../../../terminal/shared/deep-link.mjs";

const SAMPLE = {
  relay: "ws://127.0.0.1:8787",
  session: "11111111-2222-3333-4444-555555555555",
  // A realistic two-part HMAC token with reserved-ish chars to prove encoding.
  token: "eyJzdWIiOiJ1c2VyIn0.aBcD-_eFgH+/=signaturebytes",
  cwd: "/Users/nick/projects/my idea",
};

describe("buildLaunchDeepLink", () => {
  it("builds a vibecodes://launch URL with encoded params", () => {
    const url = buildLaunchDeepLink(SAMPLE);
    expect(url.startsWith(`${LAUNCH_SCHEME}://${LAUNCH_HOST}?`)).toBe(true);
    // Reserved characters in relay/token/cwd are percent-encoded, never raw.
    expect(url).toContain(`relay=${encodeURIComponent(SAMPLE.relay)}`);
    expect(url).toContain(`token=${encodeURIComponent(SAMPLE.token)}`);
    expect(url).toContain(`cwd=${encodeURIComponent(SAMPLE.cwd)}`);
    expect(url).not.toContain(" "); // the space in cwd must be encoded
  });

  it("omits cwd entirely when absent", () => {
    const url = buildLaunchDeepLink({ relay: SAMPLE.relay, session: SAMPLE.session, token: SAMPLE.token });
    expect(url).not.toContain("cwd=");
  });

  it("throws when a required field is missing", () => {
    expect(() => buildLaunchDeepLink({ relay: "", session: "s", token: "t" })).toThrow();
    expect(() => buildLaunchDeepLink({ relay: "r", session: "", token: "t" })).toThrow();
    expect(() => buildLaunchDeepLink({ relay: "r", session: "s", token: "" })).toThrow();
  });

  it("round-trips through the shared parser the helper uses (build ⇄ parse)", () => {
    const url = buildLaunchDeepLink(SAMPLE);
    const parsed = parseLaunchDeepLink(url);
    expect(parsed).toEqual(SAMPLE);
  });

  it("round-trips without cwd", () => {
    const noCwd = { relay: SAMPLE.relay, session: SAMPLE.session, token: SAMPLE.token };
    const parsed = parseLaunchDeepLink(buildLaunchDeepLink(noCwd));
    expect(parsed).toEqual(noCwd);
  });
});

describe("redactDeepLinkToken", () => {
  it("replaces the token value with *** and never leaks the secret", () => {
    const url = buildLaunchDeepLink(SAMPLE);
    const redacted = redactDeepLinkToken(url);
    expect(redacted).toContain("token=***");
    // The raw token (and its url-encoded form) must NOT appear anywhere in the log line.
    expect(redacted).not.toContain(SAMPLE.token);
    expect(redacted).not.toContain(encodeURIComponent(SAMPLE.token));
    // Non-secret params survive for debugging.
    expect(redacted).toContain(`session=${SAMPLE.session}`);
  });
});
