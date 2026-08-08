import { describe, it, expect } from "vitest";
import {
  mintClaimToken,
  mintWorkToken,
  hashClaimToken,
  verifyClaimToken,
} from "./claim-token";

describe("mintClaimToken", () => {
  it("returns a ct_-prefixed token and its sha256 hash", () => {
    const { token, hash } = mintClaimToken();
    expect(token).toMatch(/^ct_[0-9a-f]{48}$/);
    expect(hash).toBe(hashClaimToken(token));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("mints unique tokens", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => mintClaimToken().token));
    expect(tokens.size).toBe(50);
  });

  it("never returns the plaintext as the hash", () => {
    const { token, hash } = mintClaimToken();
    expect(hash).not.toContain(token);
  });
});

describe("mintWorkToken", () => {
  it("returns a wt_-prefixed token and its sha256 hash", () => {
    const { token, hash } = mintWorkToken();
    expect(token).toMatch(/^wt_[0-9a-f]{48}$/);
    expect(hash).toBe(hashClaimToken(token));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("mints unique tokens", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => mintWorkToken().token));
    expect(tokens.size).toBe(50);
  });

  it("is discriminable from a claim token by prefix alone", () => {
    const { token: workToken } = mintWorkToken();
    const { token: claimToken } = mintClaimToken();
    expect(workToken.startsWith("wt_")).toBe(true);
    expect(workToken.startsWith("ct_")).toBe(false);
    expect(claimToken.startsWith("ct_")).toBe(true);
    expect(claimToken.startsWith("wt_")).toBe(false);
  });

  it("verifies against verifyClaimToken like any other minted token (shared primitive)", () => {
    const { token, hash } = mintWorkToken();
    expect(verifyClaimToken(hash, token)).toBe(true);
    // A claim token's plaintext never verifies against a work token's hash.
    const { token: claimToken } = mintClaimToken();
    expect(verifyClaimToken(hash, claimToken)).toBe(false);
  });
});

describe("verifyClaimToken", () => {
  it("accepts the minted token against its stored hash", () => {
    const { token, hash } = mintClaimToken();
    expect(verifyClaimToken(hash, token)).toBe(true);
  });

  it("rejects a different token", () => {
    const { hash } = mintClaimToken();
    const { token: other } = mintClaimToken();
    expect(verifyClaimToken(hash, other)).toBe(false);
  });

  it("rejects when no token is presented", () => {
    const { hash } = mintClaimToken();
    expect(verifyClaimToken(hash, undefined)).toBe(false);
    expect(verifyClaimToken(hash, null)).toBe(false);
    expect(verifyClaimToken(hash, "")).toBe(false);
  });

  it("rejects when the step has no stored hash (unclaimed / reset / pre-migration)", () => {
    const { token } = mintClaimToken();
    expect(verifyClaimToken(null, token)).toBe(false);
    expect(verifyClaimToken(undefined, token)).toBe(false);
  });

  it("rejects malformed stored hashes without throwing", () => {
    const { token } = mintClaimToken();
    expect(verifyClaimToken("not-hex-and-wrong-length", token)).toBe(false);
  });
});

