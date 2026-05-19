export const dynamic = "force-dynamic";

import { randomBytes } from "crypto";
import { redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { buildAuthorizeUrl, safeReturnTo } from "@/lib/github";
import { logger } from "@/lib/logger";
import type { Database } from "@/types/database";

function getServiceClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response("Not authenticated", { status: 401 });
  }

  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  if (!clientId) {
    logger.error("GITHUB_OAUTH_CLIENT_ID is not set");
    return new Response("GitHub integration is not configured", { status: 503 });
  }

  const url = new URL(request.url);
  const returnTo = safeReturnTo(url.searchParams.get("return_to"));

  const state = randomBytes(32).toString("hex");

  const service = getServiceClient();
  const { error: insertErr } = await service.from("github_oauth_states").insert({
    state,
    user_id: user.id,
    return_to: returnTo,
  });
  if (insertErr) {
    logger.error("Failed to persist OAuth state", { error: insertErr.message });
    return new Response("Could not start GitHub connect", { status: 500 });
  }

  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL ?? url.origin}/api/github/callback`;
  const authorizeUrl = buildAuthorizeUrl({ clientId, redirectUri, state });

  redirect(authorizeUrl);
}
