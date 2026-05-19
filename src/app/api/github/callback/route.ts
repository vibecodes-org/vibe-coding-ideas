export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { encrypt } from "@/lib/encryption";
import { exchangeCodeForToken, getAuthedUser } from "@/lib/github";
import { logger } from "@/lib/logger";
import type { Database } from "@/types/database";

const STATE_TTL_MS = 10 * 60 * 1000;

function getServiceClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function errorRedirect(returnTo: string, code: string) {
  const url = new URL(returnTo, process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000");
  url.searchParams.set("github", code);
  redirect(url.toString());
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const githubError = url.searchParams.get("error");

  // The user cancelled on github.com or github returned an error — bounce home.
  if (githubError) {
    logger.info("GitHub OAuth cancelled or errored", { error: githubError });
    redirect("/?github=cancelled");
  }

  if (!code || !state) {
    return new Response("Missing code or state", { status: 400 });
  }

  const service = getServiceClient();

  // Validate the state belongs to a recent connect attempt
  const { data: stateRow } = await service
    .from("github_oauth_states")
    .select("state, user_id, return_to, created_at")
    .eq("state", state)
    .maybeSingle();

  if (!stateRow) {
    logger.warn("Invalid GitHub OAuth state", { state: state.slice(0, 8) });
    return new Response("Invalid state", { status: 400 });
  }

  // Single-use: delete the state row regardless of what happens next
  await service.from("github_oauth_states").delete().eq("state", state);

  if (Date.now() - new Date(stateRow.created_at).getTime() > STATE_TTL_MS) {
    logger.warn("Expired GitHub OAuth state");
    return new Response("State expired — please retry", { status: 400 });
  }

  // Confirm the user finishing the round-trip is the same one who started it
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.id !== stateRow.user_id) {
    logger.warn("GitHub OAuth state user mismatch");
    return new Response("Session mismatch", { status: 403 });
  }

  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    logger.error("GitHub OAuth credentials are not configured");
    return new Response("GitHub integration is not configured", { status: 503 });
  }

  // Exchange code for token
  let token: string;
  let scope: string;
  try {
    const result = await exchangeCodeForToken(code, clientId, clientSecret);
    token = result.access_token;
    scope = result.scope;
  } catch (err) {
    logger.warn("GitHub token exchange failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return errorRedirect(stateRow.return_to, "exchange_failed");
  }

  // Fetch the GitHub user so we have an authoritative login/avatar
  let githubUser;
  try {
    githubUser = await getAuthedUser(token);
  } catch (err) {
    logger.warn("GitHub /user fetch failed after token exchange", {
      error: err instanceof Error ? err.message : String(err),
    });
    return errorRedirect(stateRow.return_to, "user_fetch_failed");
  }

  const scopes = scope ? scope.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const encryptedToken = encrypt(token);

  // Upsert connection — service role bypasses RLS (which only allows SELECT/DELETE for the user)
  const { error: upsertErr } = await service.from("user_github_connections").upsert(
    {
      user_id: user.id,
      github_user_id: githubUser.id,
      github_login: githubUser.login,
      github_avatar_url: githubUser.avatar_url,
      encrypted_access_token: encryptedToken,
      scopes,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  if (upsertErr) {
    logger.error("Failed to persist github connection", { error: upsertErr.message });
    return errorRedirect(stateRow.return_to, "persist_failed");
  }

  // Auto-update stored github_username if it has drifted from the OAuth identity.
  // Per Design Review Q3 decision — the OAuth callback is authoritative.
  await service
    .from("users")
    .update({ github_username: githubUser.login })
    .eq("id", user.id)
    .neq("github_username", githubUser.login);

  logger.info("github_connected", { userId: user.id, githubLogin: githubUser.login });

  // Bounce back to where they came from, with a marker the client can use to
  // refresh state / fire a toast.
  const back = new URL(stateRow.return_to, process.env.NEXT_PUBLIC_APP_URL ?? url.origin);
  back.searchParams.set("github", "connected");
  redirect(back.toString());
}
