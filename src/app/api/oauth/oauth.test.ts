import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";

// --- Mock setup ---

 
const {
  mockFrom,
  mockAuthGetUser,
  mockAuthRefreshSession,
  mockAdminGetUserById,
  mockAdminGenerateLink,
  mockAuthVerifyOtp,
  makeChain,
} = vi.hoisted(() => {
  const mockFrom = vi.fn();
  const mockAuthGetUser = vi.fn();
  const mockAuthRefreshSession = vi.fn();
  const mockAdminGetUserById = vi.fn();
  const mockAdminGenerateLink = vi.fn();
  const mockAuthVerifyOtp = vi.fn();

  function makeChain(result: { data: unknown; error: unknown } = { data: null, error: null }) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {};
    const methods = [
      "select", "insert", "update", "delete", "eq", "neq",
      "single", "maybeSingle", "order", "limit",
    ];
    for (const m of methods) {
      chain[m] = vi.fn().mockReturnValue(chain);
    }
    // Make the chain awaitable — resolves to result when awaited at any point
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    chain.then = (resolve: any, reject: any) =>
      Promise.resolve(result).then(resolve, reject);
    return chain;
  }

  return {
    mockFrom,
    mockAuthGetUser,
    mockAuthRefreshSession,
    mockAdminGetUserById,
    mockAdminGenerateLink,
    mockAuthVerifyOtp,
    makeChain,
  };
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: mockFrom,
    auth: {
      getUser: mockAuthGetUser,
      refreshSession: mockAuthRefreshSession,
      verifyOtp: mockAuthVerifyOtp,
      admin: {
        getUserById: mockAdminGetUserById,
        generateLink: mockAdminGenerateLink,
      },
    },
  })),
}));

// --- Imports (after mock) ---

import { POST as registerPOST } from "./register/route";
import { GET as authorizeGET } from "./authorize/route";
import { POST as tokenPOST } from "./token/route";
import { POST as codePOST } from "./code/route";

// --- PKCE test helpers ---

const CODE_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CODE_CHALLENGE = crypto
  .createHash("sha256")
  .update(CODE_VERIFIER)
  .digest("base64url");

function makeAuthCode(overrides: Record<string, unknown> = {}) {
  return {
    code: "test-auth-code",
    client_id: "test-client-id",
    redirect_uri: "http://localhost:3000/callback",
    code_challenge: CODE_CHALLENGE,
    code_challenge_method: "S256",
    supabase_access_token: "sb-access-token",
    supabase_refresh_token: "sb-refresh-token",
    scope: "mcp:tools",
    expires_at: new Date(Date.now() + 600_000).toISOString(),
    used: false,
    user_id: "test-user-id",
    ...overrides,
  };
}

function makeTokenRequest(fields: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return new Request("http://localhost/api/oauth/token", {
    method: "POST",
    body: formData,
  });
}

/** Mock the per-client session mint (admin magic-link flow) succeeding. */
function mockSuccessfulMint(
  session = { access_token: "minted-token", refresh_token: "minted-refresh", expires_in: 3600 }
) {
  mockAdminGetUserById.mockResolvedValue({
    data: { user: { id: "test-user-id", email: "user@test.com" } },
    error: null,
  });
  mockAdminGenerateLink.mockResolvedValue({
    data: { properties: { email_otp: "123456" } },
    error: null,
  });
  mockAuthVerifyOtp.mockResolvedValue({
    data: { session },
    error: null,
  });
}

// --- Tests ---

beforeEach(() => {
  mockFrom.mockReset();
  mockAuthGetUser.mockReset();
  mockAuthRefreshSession.mockReset();
  mockAdminGetUserById.mockReset();
  mockAdminGenerateLink.mockReset();
  mockAuthVerifyOtp.mockReset();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
  process.env.NEXT_PUBLIC_APP_URL = "https://test.vibecodes.app";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
});

// ==================== /api/oauth/register ====================

describe("POST /api/oauth/register", () => {
  it("registers a client with valid redirect_uris", async () => {
    const chain = makeChain({
      data: { client_id: "generated-uuid" },
      error: null,
    });
    mockFrom.mockReturnValue(chain);

    const request = new Request("http://localhost/api/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        redirect_uris: ["http://localhost:3000/callback"],
        client_name: "Test Client",
      }),
    });

    const response = await registerPOST(request);
    expect(response.status).toBe(201);

    const body = await response.json();
    expect(body.client_id).toBe("generated-uuid");
    expect(body.client_secret).toMatch(/^[0-9a-f]{64}$/);
    expect(body.redirect_uris).toEqual(["http://localhost:3000/callback"]);
    expect(body.client_name).toBe("Test Client");
    expect(body.token_endpoint_auth_method).toBe("client_secret_post");
  });

  it("rejects missing redirect_uris", async () => {
    const request = new Request("http://localhost/api/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_name: "No URIs" }),
    });

    const response = await registerPOST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("invalid_client_metadata");
  });

  it("rejects empty redirect_uris array", async () => {
    const request = new Request("http://localhost/api/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ redirect_uris: [] }),
    });

    const response = await registerPOST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("invalid_client_metadata");
  });

  it("rejects non-array redirect_uris", async () => {
    const request = new Request("http://localhost/api/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ redirect_uris: "not-an-array" }),
    });

    const response = await registerPOST(request);
    expect(response.status).toBe(400);
  });

  it("returns 500 on database error", async () => {
    const chain = makeChain({
      data: null,
      error: { message: "DB insert failed" },
    });
    mockFrom.mockReturnValue(chain);

    const request = new Request("http://localhost/api/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        redirect_uris: ["http://localhost:3000/callback"],
      }),
    });

    const response = await registerPOST(request);
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("server_error");
  });

  it("returns 400 on invalid JSON body", async () => {
    const request = new Request("http://localhost/api/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });

    const response = await registerPOST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("invalid_request");
  });
});

// ==================== /api/oauth/authorize ====================

describe("GET /api/oauth/authorize", () => {
  it("redirects to consent page with all params", async () => {
    const chain = makeChain({
      data: {
        client_id: "test-client-id",
        redirect_uris: ["http://localhost:3000/callback"],
      },
      error: null,
    });
    mockFrom.mockReturnValue(chain);

    const url = new URL("http://localhost/api/oauth/authorize");
    url.searchParams.set("client_id", "test-client-id");
    url.searchParams.set("redirect_uri", "http://localhost:3000/callback");
    url.searchParams.set("code_challenge", "test-challenge");
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("state", "test-state");
    url.searchParams.set("scope", "mcp:tools");

    const request = new Request(url.toString());
    const response = await authorizeGET(request);

    expect(response.status).toBe(307);
    const location = response.headers.get("location")!;
    expect(location).toContain("/oauth/authorize");
    expect(location).toContain("client_id=test-client-id");
    expect(location).toContain("state=test-state");
    expect(location).toContain("code_challenge=test-challenge");
    expect(location).toContain("code_challenge_method=S256");
  });

  it("rejects missing required params", async () => {
    const request = new Request(
      "http://localhost/api/oauth/authorize?client_id=x"
    );
    const response = await authorizeGET(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("invalid_request");
    expect(body.error_description).toContain("Missing required parameters");
  });

  it("rejects unsupported code_challenge_method", async () => {
    const url = new URL("http://localhost/api/oauth/authorize");
    url.searchParams.set("client_id", "test-client-id");
    url.searchParams.set("redirect_uri", "http://localhost:3000/callback");
    url.searchParams.set("code_challenge", "test-challenge");
    url.searchParams.set("code_challenge_method", "plain");
    url.searchParams.set("state", "test-state");

    const request = new Request(url.toString());
    const response = await authorizeGET(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error_description).toContain("S256");
  });

  it("rejects unknown client_id", async () => {
    const chain = makeChain({ data: null, error: null });
    mockFrom.mockReturnValue(chain);

    const url = new URL("http://localhost/api/oauth/authorize");
    url.searchParams.set("client_id", "unknown-client");
    url.searchParams.set("redirect_uri", "http://localhost:3000/callback");
    url.searchParams.set("code_challenge", "test-challenge");
    url.searchParams.set("state", "test-state");

    const request = new Request(url.toString());
    const response = await authorizeGET(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("invalid_client");
  });

  it("rejects unregistered redirect_uri", async () => {
    const chain = makeChain({
      data: {
        client_id: "test-client-id",
        redirect_uris: ["http://other-domain.com/callback"],
      },
      error: null,
    });
    mockFrom.mockReturnValue(chain);

    const url = new URL("http://localhost/api/oauth/authorize");
    url.searchParams.set("client_id", "test-client-id");
    url.searchParams.set("redirect_uri", "http://localhost:3000/callback");
    url.searchParams.set("code_challenge", "test-challenge");
    url.searchParams.set("state", "test-state");

    const request = new Request(url.toString());
    const response = await authorizeGET(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error_description).toContain("redirect_uri not registered");
  });

  it("defaults code_challenge_method to S256 in redirect", async () => {
    const chain = makeChain({
      data: {
        client_id: "test-client-id",
        redirect_uris: ["http://localhost:3000/callback"],
      },
      error: null,
    });
    mockFrom.mockReturnValue(chain);

    const url = new URL("http://localhost/api/oauth/authorize");
    url.searchParams.set("client_id", "test-client-id");
    url.searchParams.set("redirect_uri", "http://localhost:3000/callback");
    url.searchParams.set("code_challenge", "test-challenge");
    // No code_challenge_method — should default to S256
    url.searchParams.set("state", "test-state");

    const request = new Request(url.toString());
    const response = await authorizeGET(request);

    expect(response.status).toBe(307);
    const location = response.headers.get("location")!;
    expect(location).toContain("code_challenge_method=S256");
  });
});

// ==================== /api/oauth/token (authorization_code) ====================

describe("POST /api/oauth/token (authorization_code)", () => {
  it("exchanges valid authorization code with PKCE and returns freshly minted tokens", async () => {
    const authCode = makeAuthCode();
    const codeChain = makeChain({ data: authCode, error: null });
    const updateChain = makeChain({ data: null, error: null });
    mockFrom.mockReturnValueOnce(codeChain).mockReturnValueOnce(updateChain);

    mockSuccessfulMint({
      access_token: "fresh-access-token",
      refresh_token: "fresh-refresh-token",
      expires_in: 3600,
    });

    const request = makeTokenRequest({
      grant_type: "authorization_code",
      code: "test-auth-code",
      code_verifier: CODE_VERIFIER,
      client_id: "test-client-id",
      redirect_uri: "http://localhost:3000/callback",
    });

    const response = await tokenPOST(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.access_token).toBe("fresh-access-token");
    expect(body.token_type).toBe("bearer");
    expect(body.refresh_token).toBe("fresh-refresh-token");
    expect(body.expires_in).toBe(3600);
    expect(body.scope).toBe("mcp:tools");
  });

  it("returns error if session minting fails instead of stale tokens", async () => {
    const authCode = makeAuthCode();
    const codeChain = makeChain({ data: authCode, error: null });
    const updateChain = makeChain({ data: null, error: null });
    mockFrom.mockReturnValueOnce(codeChain).mockReturnValueOnce(updateChain);

    // Mint fails at the OTP-exchange stage
    mockAdminGetUserById.mockResolvedValue({
      data: { user: { id: "test-user-id", email: "user@test.com" } },
      error: null,
    });
    mockAdminGenerateLink.mockResolvedValue({
      data: { properties: { email_otp: "123456" } },
      error: null,
    });
    mockAuthVerifyOtp.mockResolvedValue({
      data: { session: null },
      error: { message: "OTP exchange failed" },
    });

    const request = makeTokenRequest({
      grant_type: "authorization_code",
      code: "test-auth-code",
      code_verifier: CODE_VERIFIER,
      client_id: "test-client-id",
      redirect_uri: "http://localhost:3000/callback",
    });

    const response = await tokenPOST(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toBe("invalid_grant");
    expect(body.error_description).toContain("re-authenticate");
  });

  it("rejects missing required params", async () => {
    const request = makeTokenRequest({
      grant_type: "authorization_code",
      code: "test-code",
      // Missing code_verifier and client_id
    });

    const response = await tokenPOST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("invalid_request");
  });

  it("rejects invalid authorization code", async () => {
    const chain = makeChain({ data: null, error: null });
    mockFrom.mockReturnValue(chain);

    const request = makeTokenRequest({
      grant_type: "authorization_code",
      code: "nonexistent-code",
      code_verifier: CODE_VERIFIER,
      client_id: "test-client-id",
    });

    const response = await tokenPOST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("invalid_grant");
    expect(body.error_description).toContain("Invalid authorization code");
  });

  it("rejects expired authorization code", async () => {
    const authCode = makeAuthCode({
      expires_at: new Date(Date.now() - 60_000).toISOString(), // expired 1 min ago
    });
    const chain = makeChain({ data: authCode, error: null });
    mockFrom.mockReturnValue(chain);

    const request = makeTokenRequest({
      grant_type: "authorization_code",
      code: "test-auth-code",
      code_verifier: CODE_VERIFIER,
      client_id: "test-client-id",
    });

    const response = await tokenPOST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error_description).toContain("expired");
  });

  it("rejects already-used authorization code", async () => {
    const authCode = makeAuthCode({ used: true });
    const chain = makeChain({ data: authCode, error: null });
    mockFrom.mockReturnValue(chain);

    const request = makeTokenRequest({
      grant_type: "authorization_code",
      code: "test-auth-code",
      code_verifier: CODE_VERIFIER,
      client_id: "test-client-id",
    });

    const response = await tokenPOST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error_description).toContain("already used");
  });

  it("rejects client_id mismatch", async () => {
    const authCode = makeAuthCode({ client_id: "other-client" });
    const chain = makeChain({ data: authCode, error: null });
    mockFrom.mockReturnValue(chain);

    const request = makeTokenRequest({
      grant_type: "authorization_code",
      code: "test-auth-code",
      code_verifier: CODE_VERIFIER,
      client_id: "test-client-id",
    });

    const response = await tokenPOST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error_description).toContain("client_id mismatch");
  });

  it("rejects redirect_uri mismatch", async () => {
    const authCode = makeAuthCode({
      redirect_uri: "http://other-domain.com/callback",
    });
    const chain = makeChain({ data: authCode, error: null });
    mockFrom.mockReturnValue(chain);

    const request = makeTokenRequest({
      grant_type: "authorization_code",
      code: "test-auth-code",
      code_verifier: CODE_VERIFIER,
      client_id: "test-client-id",
      redirect_uri: "http://localhost:3000/callback",
    });

    const response = await tokenPOST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error_description).toContain("redirect_uri mismatch");
  });

  it("rejects invalid PKCE code_verifier", async () => {
    const authCode = makeAuthCode();
    const chain = makeChain({ data: authCode, error: null });
    mockFrom.mockReturnValue(chain);

    const request = makeTokenRequest({
      grant_type: "authorization_code",
      code: "test-auth-code",
      code_verifier: "wrong-verifier-value",
      client_id: "test-client-id",
    });

    const response = await tokenPOST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error_description).toContain("PKCE verification failed");
  });

  it("marks authorization code as used after successful exchange", async () => {
    const authCode = makeAuthCode();
    const codeChain = makeChain({ data: authCode, error: null });
    const updateChain = makeChain({ data: null, error: null });
    mockFrom.mockReturnValueOnce(codeChain).mockReturnValueOnce(updateChain);
    mockSuccessfulMint();

    const request = makeTokenRequest({
      grant_type: "authorization_code",
      code: "test-auth-code",
      code_verifier: CODE_VERIFIER,
      client_id: "test-client-id",
    });

    await tokenPOST(request);

    // Verify the update chain was used to mark code as used
    expect(updateChain.update).toHaveBeenCalledWith({ used: true });
    expect(updateChain.eq).toHaveBeenCalledWith("code", "test-auth-code");
  });

  it("mints a NEW per-client session — never refreshes the user's browser session", async () => {
    const authCode = makeAuthCode();
    const codeChain = makeChain({ data: authCode, error: null });
    const updateChain = makeChain({ data: null, error: null });
    mockFrom.mockReturnValueOnce(codeChain).mockReturnValueOnce(updateChain);
    mockSuccessfulMint();

    const response = await tokenPOST(
      makeTokenRequest({
        grant_type: "authorization_code",
        code: "test-auth-code",
        code_verifier: CODE_VERIFIER,
        client_id: "test-client-id",
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.access_token).toBe("minted-token");
    expect(body.refresh_token).toBe("minted-refresh");
    expect(body.expires_in).toBe(3600);

    // Regression guard: concurrent MCP clients must not share the user's
    // browser session — exchanging a code mints a dedicated session instead of
    // refreshing authCode.supabase_refresh_token. (Shared sessions made all of
    // a user's connections converge on identical tokens, so per-connection
    // agent identity could not work.)
    expect(mockAuthRefreshSession).not.toHaveBeenCalled();
    expect(mockAdminGetUserById).toHaveBeenCalledWith("test-user-id");
    expect(mockAdminGenerateLink).toHaveBeenCalled();
    expect(mockAuthVerifyOtp).toHaveBeenCalled();
  });

  it("returns invalid_grant when session minting fails", async () => {
    const authCode = makeAuthCode();
    const codeChain = makeChain({ data: authCode, error: null });
    const updateChain = makeChain({ data: null, error: null });
    mockFrom.mockReturnValueOnce(codeChain).mockReturnValueOnce(updateChain);

    // Mint fails at the first step (user lookup)
    mockAdminGetUserById.mockResolvedValue({ data: { user: null }, error: { message: "not found" } });

    const response = await tokenPOST(
      makeTokenRequest({
        grant_type: "authorization_code",
        code: "test-auth-code",
        code_verifier: CODE_VERIFIER,
        client_id: "test-client-id",
      })
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("invalid_grant");
  });
});

// ==================== /api/oauth/token (refresh_token) ====================

describe("POST /api/oauth/token (refresh_token)", () => {
  it("refreshes token successfully with expires_in", async () => {
    const clientChain = makeChain({
      data: { client_id: "test-client-id" },
      error: null,
    });
    mockFrom.mockReturnValue(clientChain);

    mockAuthRefreshSession.mockResolvedValue({
      data: {
        session: {
          access_token: "new-access-token",
          refresh_token: "new-refresh-token",
          expires_in: 3600,
        },
      },
      error: null,
    });

    const request = makeTokenRequest({
      grant_type: "refresh_token",
      refresh_token: "old-refresh-token",
      client_id: "test-client-id",
    });

    const response = await tokenPOST(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.access_token).toBe("new-access-token");
    expect(body.token_type).toBe("bearer");
    expect(body.refresh_token).toBe("new-refresh-token");
    expect(body.expires_in).toBe(3600);
    expect(body.scope).toBe("mcp:tools");
  });

  it("rejects missing refresh_token or client_id", async () => {
    const request = makeTokenRequest({
      grant_type: "refresh_token",
      // Missing refresh_token and client_id
    });

    const response = await tokenPOST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("invalid_request");
  });

  it("rejects unknown client_id", async () => {
    const chain = makeChain({ data: null, error: null });
    mockFrom.mockReturnValue(chain);

    const request = makeTokenRequest({
      grant_type: "refresh_token",
      refresh_token: "some-token",
      client_id: "unknown-client",
    });

    const response = await tokenPOST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("invalid_client");
  });

  it("returns error when Supabase refresh fails", async () => {
    const clientChain = makeChain({
      data: { client_id: "test-client-id" },
      error: null,
    });
    mockFrom.mockReturnValue(clientChain);

    mockAuthRefreshSession.mockResolvedValue({
      data: { session: null },
      error: { message: "Token expired" },
    });

    const request = makeTokenRequest({
      grant_type: "refresh_token",
      refresh_token: "expired-token",
      client_id: "test-client-id",
    });

    const response = await tokenPOST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("invalid_grant");
  });
});

// ==================== /api/oauth/token (unsupported) ====================

describe("POST /api/oauth/token (unsupported grant_type)", () => {
  it("rejects unsupported grant_type", async () => {
    const request = makeTokenRequest({
      grant_type: "client_credentials",
    });

    const response = await tokenPOST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("unsupported_grant_type");
  });
});

// ==================== /api/oauth/code ====================

describe("POST /api/oauth/code", () => {
  it("stores authorization code successfully", async () => {
    mockAuthGetUser.mockResolvedValue({
      data: { user: { id: "test-user-id" } },
      error: null,
    });

    const chain = makeChain({ data: null, error: null });
    mockFrom.mockReturnValue(chain);

    const request = new Request("http://localhost/api/oauth/code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: "auth-code-123",
        client_id: "test-client-id",
        redirect_uri: "http://localhost:3000/callback",
        code_challenge: CODE_CHALLENGE,
        code_challenge_method: "S256",
        scope: "mcp:tools",
        supabase_access_token: "valid-token",
        supabase_refresh_token: "valid-refresh",
      }),
    });

    const response = await codePOST(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.success).toBe(true);

    // Verify the code was stored with correct user_id
    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "auth-code-123",
        client_id: "test-client-id",
        user_id: "test-user-id",
        code_challenge: CODE_CHALLENGE,
      })
    );
  });

  it("rejects missing required fields", async () => {
    const request = new Request("http://localhost/api/oauth/code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: "auth-code-123",
        // Missing other required fields
      }),
    });

    const response = await codePOST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("Missing required fields");
  });

  it("rejects invalid access token", async () => {
    mockAuthGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: "Invalid token" },
    });

    const request = new Request("http://localhost/api/oauth/code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: "auth-code-123",
        client_id: "test-client-id",
        redirect_uri: "http://localhost:3000/callback",
        code_challenge: CODE_CHALLENGE,
        supabase_access_token: "invalid-token",
        supabase_refresh_token: "some-refresh",
      }),
    });

    const response = await codePOST(request);
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toContain("Invalid access token");
  });

  it("returns 500 on database error", async () => {
    mockAuthGetUser.mockResolvedValue({
      data: { user: { id: "test-user-id" } },
      error: null,
    });

    const chain = makeChain({
      data: null,
      error: { message: "Insert failed" },
    });
    mockFrom.mockReturnValue(chain);

    const request = new Request("http://localhost/api/oauth/code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: "auth-code-123",
        client_id: "test-client-id",
        redirect_uri: "http://localhost:3000/callback",
        code_challenge: CODE_CHALLENGE,
        supabase_access_token: "valid-token",
        supabase_refresh_token: "valid-refresh",
      }),
    });

    const response = await codePOST(request);
    expect(response.status).toBe(500);
  });

  it("returns 400 on invalid JSON body", async () => {
    const request = new Request("http://localhost/api/oauth/code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });

    const response = await codePOST(request);
    expect(response.status).toBe(400);
  });
});
