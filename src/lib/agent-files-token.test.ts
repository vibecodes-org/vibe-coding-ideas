import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { AGENT_FILES_TTL_SECONDS, mintAgentFilesToken, verifyAgentFilesToken } from "./agent-files-token";

const SECRET = "test-secret-value";
const NOW = 1_800_000_000;
const claims = { sub: "user-1", idea: "idea-1" };

function b64url(buf: Buffer | string) {
  return Buffer.from(buf).toString("base64url");
}

describe("agent-files token", () => {
  it("round-trips the user and idea", () => {
    const token = mintAgentFilesToken(claims, SECRET, NOW);
    expect(verifyAgentFilesToken(token, SECRET, NOW + 10)).toEqual({ ok: true, sub: "user-1", idea: "idea-1" });
  });

  it("lasts five minutes", () => {
    expect(AGENT_FILES_TTL_SECONDS).toBe(300);
    const token = mintAgentFilesToken(claims, SECRET, NOW);
    expect(verifyAgentFilesToken(token, SECRET, NOW + 299).ok).toBe(true);
    expect(verifyAgentFilesToken(token, SECRET, NOW + 301)).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a tampered payload", () => {
    const [payload, sig] = mintAgentFilesToken(claims, SECRET, NOW).split(".");
    const forged = b64url(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), idea: "other" }));
    expect(verifyAgentFilesToken(`${forged}.${sig}`, SECRET, NOW)).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("rejects a token signed with another secret", () => {
    const token = mintAgentFilesToken(claims, "other-secret", NOW);
    expect(verifyAgentFilesToken(token, SECRET, NOW)).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("rejects a token signed with the raw secret rather than the derived key", () => {
    const payload = b64url(JSON.stringify({ ...claims, purpose: "agent-files", iat: NOW, exp: NOW + 300 }));
    const sig = b64url(createHmac("sha256", SECRET).update(payload).digest());
    expect(verifyAgentFilesToken(`${payload}.${sig}`, SECRET, NOW)).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("rejects a validly signed token with another purpose (a terminal session token shape)", () => {
    const key = createHmac("sha256", SECRET).update("vibecodes-agent-files-v1").digest();
    const payload = b64url(JSON.stringify({ ...claims, purpose: "browser", iat: NOW, exp: NOW + 300 }));
    const sig = b64url(createHmac("sha256", key).update(payload).digest());
    expect(verifyAgentFilesToken(`${payload}.${sig}`, SECRET, NOW)).toEqual({ ok: false, reason: "wrong-purpose" });
  });

  it("rejects malformed input", () => {
    for (const bad of ["", "abc", "a.b.c", ".", "a."]) {
      expect(verifyAgentFilesToken(bad, SECRET, NOW).ok).toBe(false);
    }
  });

  it("refuses to mint or verify with a blank secret", () => {
    expect(() => mintAgentFilesToken(claims, "   ", NOW)).toThrow(/not configured/);
    expect(verifyAgentFilesToken("a.b", "", NOW)).toEqual({ ok: false, reason: "no-secret" });
  });

  it("trims the secret the way the env is read", () => {
    const token = mintAgentFilesToken(claims, `  ${SECRET}\n`, NOW);
    expect(verifyAgentFilesToken(token, SECRET, NOW).ok).toBe(true);
  });
});
