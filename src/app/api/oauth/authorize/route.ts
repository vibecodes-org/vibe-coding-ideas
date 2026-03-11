export const dynamic = "force-dynamic";

import { createClient } from "@supabase/supabase-js";
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

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const clientId = url.searchParams.get("client_id");
    const redirectUri = url.searchParams.get("redirect_uri");
    const codeChallenge = url.searchParams.get("code_challenge");
    const codeChallengeMethod = url.searchParams.get("code_challenge_method");
    const state = url.searchParams.get("state");
    const scope = url.searchParams.get("scope") || "";

    if (!clientId || !redirectUri || !codeChallenge || !state) {
      return jsonResponse(
        { error: "invalid_request", error_description: "Missing required parameters: client_id, redirect_uri, code_challenge, state" },
        400
      );
    }

    if (codeChallengeMethod && codeChallengeMethod !== "S256") {
      return jsonResponse(
        { error: "invalid_request", error_description: "Only S256 code_challenge_method is supported" },
        400
      );
    }

    // Validate client_id and redirect_uri
    const supabase = getServiceClient();
    const { data: client, error } = await supabase
      .from("mcp_oauth_clients")
      .select("client_id, redirect_uris")
      .eq("client_id", clientId)
      .maybeSingle();

    if (error || !client) {
      return jsonResponse(
        { error: "invalid_client", error_description: "Unknown client_id" },
        400
      );
    }

    if (!client.redirect_uris.includes(redirectUri)) {
      return jsonResponse(
        { error: "invalid_request", error_description: "redirect_uri not registered for this client" },
        400
      );
    }

    // Redirect to the consent/login page with all OAuth params
    if (!process.env.NEXT_PUBLIC_APP_URL) {
      return jsonResponse(
        { error: "server_error", error_description: "NEXT_PUBLIC_APP_URL is not configured" },
        500
      );
    }
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL;
    const loginUrl = new URL(`${baseUrl}/oauth/authorize`);
    loginUrl.searchParams.set("client_id", clientId);
    loginUrl.searchParams.set("redirect_uri", redirectUri);
    loginUrl.searchParams.set("code_challenge", codeChallenge);
    loginUrl.searchParams.set("code_challenge_method", codeChallengeMethod || "S256");
    loginUrl.searchParams.set("state", state);
    loginUrl.searchParams.set("scope", scope);

    return new Response(null, {
      status: 307,
      headers: { Location: loginUrl.toString() },
    });
  } catch {
    return jsonResponse(
      { error: "server_error", error_description: "Internal server error" },
      500
    );
  }
}
