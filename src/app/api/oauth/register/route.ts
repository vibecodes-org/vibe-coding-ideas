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

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { redirect_uris, client_name } = body;

    if (!redirect_uris || !Array.isArray(redirect_uris) || redirect_uris.length === 0) {
      return jsonResponse(
        { error: "invalid_client_metadata", error_description: "redirect_uris is required" },
        400
      );
    }

    const clientSecret = crypto.randomBytes(32).toString("hex");
    const supabase = getServiceClient();

    const { data, error } = await supabase
      .from("mcp_oauth_clients")
      .insert({
        client_secret: clientSecret,
        redirect_uris,
        client_name: client_name || null,
      })
      .select("client_id")
      .single();

    if (error) {
      return jsonResponse(
        { error: "server_error", error_description: error.message },
        500
      );
    }

    return jsonResponse({
      client_id: data.client_id,
      client_secret: clientSecret,
      redirect_uris,
      client_name: client_name || undefined,
      token_endpoint_auth_method: "client_secret_post",
    }, 201);
  } catch {
    return jsonResponse(
      { error: "invalid_request", error_description: "Invalid JSON body" },
      400
    );
  }
}
