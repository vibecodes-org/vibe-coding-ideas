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

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      code,
      client_id,
      redirect_uri,
      code_challenge,
      code_challenge_method,
      scope,
      supabase_access_token,
      supabase_refresh_token,
    } = body;

    if (!code || !client_id || !redirect_uri || !code_challenge || !supabase_access_token || !supabase_refresh_token) {
      return jsonResponse(
        { error: "Missing required fields" },
        400
      );
    }

    // Verify the access token to get the user ID
    const supabase = getServiceClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser(supabase_access_token);

    if (userError || !user) {
      return jsonResponse(
        { error: "Invalid access token" },
        401
      );
    }

    // Store the authorization code
    const { error } = await supabase
      .from("mcp_oauth_codes")
      .insert({
        code,
        client_id,
        user_id: user.id,
        redirect_uri,
        code_challenge,
        code_challenge_method: code_challenge_method || "S256",
        supabase_access_token,
        supabase_refresh_token,
        scope: scope || "",
      });

    if (error) {
      return jsonResponse(
        { error: "Failed to store authorization code" },
        500
      );
    }

    return jsonResponse({ success: true });
  } catch {
    return jsonResponse(
      { error: "Invalid request body" },
      400
    );
  }
}
