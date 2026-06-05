import { describe, it, expect } from "vitest";
import {
  mintClaimToken,
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

