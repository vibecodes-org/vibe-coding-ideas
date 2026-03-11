export const dynamic = "force-dynamic";

import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import type { Database } from "@/types/database";

function getServiceClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function base64URLEncode(buffer: Buffer): string {
  return buffer.toString("base64url");
}

function sha256(input: string): Buffer {
  return crypto.createHash("sha256").update(input).digest();
}

export async function POST(request: Request) {
  try {
    const body = await request.formData();
    const grantType = body.get("grant_type") as string;

    if (grantType === "authorization_code") {
      return await handleAuthorizationCode(body);
    }

    if (grantType === "refresh_token") {
      return await handleRefreshToken(body);
    }

    return jsonResponse(
      { error: "unsupported_grant_type", error_description: "Supported: authorization_code, refresh_token" },
      400
    );
  } catch {
    return jsonResponse(
      { error: "server_error", error_description: "Internal server error" },
      500
    );
  }
}

async function handleAuthorizationCode(body: FormData) {
  const code = body.get("code") as string;
  const codeVerifier = body.get("code_verifier") as string;
  const clientId = body.get("client_id") as string;
  const redirectUri = body.get("redirect_uri") as string;

  if (!code || !codeVerifier || !clientId) {
    return jsonResponse(
      { error: "invalid_request", error_description: "Missing required parameters" },
      400
    );
  }

  const supabase = getServiceClient();

  // Look up the authorization code
  const { data: authCode, error } = await supabase
    .from("mcp_oauth_codes")
    .select("*")
    .eq("code", code)
    .maybeSingle();

  if (error || !authCode) {
    return jsonResponse(
      { error: "invalid_grant", error_description: "Invalid authorization code" },
      400
    );
  }

  // Check not expired
  if (new Date(authCode.expires_at) < new Date()) {
    return jsonResponse(
      { error: "invalid_grant", error_description: "Authorization code expired" },
      400
    );
  }

  // Check not used
  if (authCode.used) {
    return jsonResponse(
      { error: "invalid_grant", error_description: "Authorization code already used" },
      400
    );
  }

  // Verify client_id matches
  if (authCode.client_id !== clientId) {
    return jsonResponse(
      { error: "invalid_grant", error_description: "client_id mismatch" },
      400
    );
  }

  // Verify redirect_uri if stored
  if (redirectUri && authCode.redirect_uri !== redirectUri) {
    return jsonResponse(
      { error: "invalid_grant", error_description: "redirect_uri mismatch" },
      400
    );
  }

  // Verify PKCE: SHA256(code_verifier) === code_challenge
  const computedChallenge = base64URLEncode(sha256(codeVerifier));
  if (computedChallenge !== authCode.code_challenge) {
    return jsonResponse(
      { error: "invalid_grant", error_description: "PKCE verification failed" },
      400
    );
  }

  // Mark as used
  await supabase
    .from("mcp_oauth_codes")
    .update({ used: true })
    .eq("code", code);

  // Refresh the session to get fresh tokens with full TTL
  const anonClient = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data: refreshed, error: refreshError } = await anonClient.auth.refreshSession({
    refresh_token: authCode.supabase_refresh_token,
  });

  if (refreshError || !refreshed.session) {
    return jsonResponse(
      { error: "invalid_grant", error_description: "Session expired — please re-authenticate" },
      400
    );
  }

  return jsonResponse({
    access_token: refreshed.session.access_token,
    token_type: "bearer",
    expires_in: refreshed.session.expires_in,
    refresh_token: refreshed.session.refresh_token,
    scope: authCode.scope || "mcp:tools",
  });
}

async function handleRefreshToken(body: FormData) {
  const refreshToken = body.get("refresh_token") as string;
  const clientId = body.get("client_id") as string;

  if (!refreshToken || !clientId) {
    return jsonResponse(
      { error: "invalid_request", error_description: "Missing refresh_token or client_id" },
      400
    );
  }

  // Verify client exists
  const supabase = getServiceClient();
  const { data: client } = await supabase
    .from("mcp_oauth_clients")
    .select("client_id")
    .eq("client_id", clientId)
    .maybeSingle();

  if (!client) {
    return jsonResponse(
      { error: "invalid_client", error_description: "Unknown client_id" },
      400
    );
  }

  // Use Supabase to refresh the session
  const anonClient = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data: session, error } = await anonClient.auth.refreshSession({
    refresh_token: refreshToken,
  });

  if (error || !session.session) {
    return jsonResponse(
      { error: "invalid_grant", error_description: "Failed to refresh session" },
      400
    );
  }

  return jsonResponse({
    access_token: session.session.access_token,
    token_type: "bearer",
    expires_in: session.session.expires_in,
    refresh_token: session.session.refresh_token,
    scope: "mcp:tools",
  });
}
