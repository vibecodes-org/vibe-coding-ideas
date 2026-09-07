import { describe, it, expect } from "vitest";
import {
  redirectUriKey,
  matchRegisteredRedirectUri,
  redirectUriMatches,
  resolveRedirectTarget,
} from "./oauth-redirect";

describe("redirectUriMatches — loopback host forms", () => {
  it("matches Codex's 127.0.0.1 against a stored localhost registration", () => {
    // The platform normalizes the incoming 127.0.0.1 -> localhost, but this also
    // covers the raw case: the two host forms are the same destination.
    expect(
      redirectUriMatches(
        ["http://localhost:50302/callback"],
        "http://127.0.0.1:50302/callback"
      )
    ).toBe(true);
  });

  it("matches a stored 127.0.0.1 registration against a localhost request", () => {
    // This is the exact production bug: Codex REGISTERED 127.0.0.1, the platform
    // handed the authorize route `localhost`, and the old exact match rejected it.
    expect(
      redirectUriMatches(
        ["http://127.0.0.1:50302/callback/yK54i-mBbfFu"],
        "http://localhost:50302/callback/yK54i-mBbfFu"
      )
    ).toBe(true);
  });

  it("treats ::1 as loopback too", () => {
    expect(
      redirectUriMatches(
        ["http://127.0.0.1:8080/callback"],
        "http://[::1]:8080/callback"
      )
    ).toBe(true);
  });
});

describe("redirectUriMatches — loopback ports are ephemeral", () => {
  it("matches when the live listener uses a different port than was registered", () => {
    // Codex may reuse a saved registration but bind a fresh OS-chosen port.
    expect(
      redirectUriMatches(
        ["http://127.0.0.1:50302/callback/abc"],
        "http://127.0.0.1:61999/callback/abc"
      )
    ).toBe(true);
  });

  it("still requires the path to match (the per-server callback id binds it)", () => {
    expect(
      redirectUriMatches(
        ["http://127.0.0.1:50302/callback/abc"],
        "http://127.0.0.1:50302/callback/DIFFERENT"
      )
    ).toBe(false);
  });

  it("requires the scheme to match", () => {
    expect(
      redirectUriMatches(
        ["http://127.0.0.1:50302/callback"],
        "https://127.0.0.1:50302/callback"
      )
    ).toBe(false);
  });
});

describe("redirectUriMatches — non-loopback stays strict", () => {
  it("does not ignore host or port for public URLs", () => {
    expect(
      redirectUriMatches(
        ["https://app.example.com/callback"],
        "https://evil.example.com/callback"
      )
    ).toBe(false);
    expect(
      redirectUriMatches(
        ["https://app.example.com:443/callback"],
        "https://app.example.com:8443/callback"
      )
    ).toBe(false);
  });

  it("matches an exact public URL", () => {
    expect(
      redirectUriMatches(
        ["https://claude.ai/api/mcp/auth_callback"],
        "https://claude.ai/api/mcp/auth_callback"
      )
    ).toBe(true);
  });

  it("distinguishes query strings", () => {
    expect(
      redirectUriMatches(
        ["https://app.example.com/cb?a=1"],
        "https://app.example.com/cb?a=2"
      )
    ).toBe(false);
  });
});

describe("redirectUriMatches — edge cases", () => {
  it("returns false for empty / missing inputs", () => {
    expect(redirectUriMatches([], "http://127.0.0.1/cb")).toBe(false);
    expect(redirectUriMatches(null, "http://127.0.0.1/cb")).toBe(false);
    expect(redirectUriMatches(["http://127.0.0.1/cb"], null)).toBe(false);
    expect(redirectUriMatches(["http://127.0.0.1/cb"], "")).toBe(false);
  });

  it("falls back to raw compare for unparseable values", () => {
    expect(redirectUriKey("not a url")).toBe("not a url");
    expect(redirectUriMatches(["not a url"], "not a url")).toBe(true);
  });

  it("matches the first of several registered uris", () => {
    expect(
      matchRegisteredRedirectUri(
        ["https://a.example.com/cb", "http://127.0.0.1:1/callback"],
        "http://localhost:2/callback"
      )
    ).toBe("http://127.0.0.1:1/callback");
  });
});

describe("resolveRedirectTarget — where the browser is sent back", () => {
  it("keeps the registered host form and adopts the live port (Codex)", () => {
    // Registered 127.0.0.1:50302, live listener on 61999 -> bounce to 127.0.0.1:61999.
    expect(
      resolveRedirectTarget(
        "http://127.0.0.1:50302/callback/abc",
        "http://localhost:61999/callback/abc"
      )
    ).toBe("http://127.0.0.1:61999/callback/abc");
  });

  it("leaves a matching-port Codex redirect on 127.0.0.1", () => {
    expect(
      resolveRedirectTarget(
        "http://127.0.0.1:50302/callback/abc",
        "http://localhost:50302/callback/abc"
      )
    ).toBe("http://127.0.0.1:50302/callback/abc");
  });

  it("does not rewrite Claude's localhost redirect", () => {
    expect(
      resolveRedirectTarget(
        "http://localhost:53826/callback",
        "http://localhost:53826/callback"
      )
    ).toBe("http://localhost:53826/callback");
  });

  it("returns non-loopback redirects unchanged", () => {
    expect(
      resolveRedirectTarget(
        "https://app.example.com/cb",
        "https://app.example.com/cb"
      )
    ).toBe("https://app.example.com/cb");
  });
});
