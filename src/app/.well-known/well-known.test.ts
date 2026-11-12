import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GET as getAuthServerMetadata } from "./oauth-authorization-server/route";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://test.vibecodes.app");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function makeRequest(url: string) {
  return new Request(url);
}

describe("/.well-known/oauth-authorization-server", () => {
  it("returns complete OAuth server metadata", async () => {
    const response = await getAuthServerMetadata(
      makeRequest("https://test.vibecodes.app/.well-known/oauth-authorization-server")
    );
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toEqual({
      issuer: "https://test.vibecodes.app",
      authorization_endpoint: "https://test.vibecodes.app/api/oauth/authorize",
      token_endpoint: "https://test.vibecodes.app/api/oauth/token",
      registration_endpoint: "https://test.vibecodes.app/api/oauth/register",
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["client_secret_post"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["mcp:tools"],
      authorization_response_iss_parameter_supported: true,
    });
  });

  it("falls back to request origin when NEXT_PUBLIC_APP_URL is not set", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    const response = await getAuthServerMetadata(
      makeRequest("https://fallback.example.com/.well-known/oauth-authorization-server")
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.issuer).toBe("https://fallback.example.com");
    expect(body.authorization_endpoint).toBe("https://fallback.example.com/api/oauth/authorize");
  });
});

describe("/.well-known/oauth-protected-resource", () => {
  it("returns protected resource metadata from mcp-handler", async () => {
    // protectedResourceHandler reads config at module load time, so we
    // test the response structure rather than exact URL values
    const { GET } = await import("./oauth-protected-resource/route");
    const response = GET(
      makeRequest("https://test.vibecodes.app/.well-known/oauth-protected-resource")
    );
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toHaveProperty("resource");
    expect(body).toHaveProperty("authorization_servers");
    expect(Array.isArray(body.authorization_servers)).toBe(true);
    expect(body.authorization_servers.length).toBeGreaterThan(0);
  });
});
