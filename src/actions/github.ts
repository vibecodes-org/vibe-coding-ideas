"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/encryption";
import {
  createOwnRepo,
  getRepo,
  GithubApiError,
  listOwnRepos,
  parseRepoUrl,
  revokeGrant,
  toRepoName,
  type GithubRepo,
} from "@/lib/github";
import { classifyRepoAccess, type RepoAccessState } from "@/lib/github-verify";
import { logger } from "@/lib/logger";
import type { Database } from "@/types/database";

export type LinkSource = "browse" | "create" | "manual";

export interface GithubConnectionInfo {
  github_login: string;
  github_avatar_url: string | null;
  scopes: string[];
  connected_at: string;
}

export interface RepoSummary {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  is_private: boolean;
  description: string | null;
  pushed_at: string;
  language: string | null;
  owner_avatar_url: string;
}

function getServiceClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function requireUserAndConnection() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const service = getServiceClient();
  const { data: connection } = await service
    .from("user_github_connections")
    .select("user_id, github_login, github_avatar_url, encrypted_access_token, scopes, connected_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!connection) throw new Error("Not connected to GitHub");

  return { user, supabase, service, connection };
}

async function dropConnection(userId: string) {
  const service = getServiceClient();
  await service.from("user_github_connections").delete().eq("user_id", userId);
}

async function handleGithubError<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof GithubApiError && err.status === 401) {
      logger.warn("Stored GitHub token rejected — auto-disconnecting", { userId });
      await dropConnection(userId);
      throw new Error("Your GitHub connection expired — please reconnect");
    }
    throw err;
  }
}

function toSummary(r: GithubRepo): RepoSummary {
  return {
    id: r.id,
    name: r.name,
    full_name: r.full_name,
    html_url: r.html_url,
    is_private: r.private,
    description: r.description,
    pushed_at: r.pushed_at,
    language: r.language,
    owner_avatar_url: r.owner.avatar_url,
  };
}

/** Fetch the current user's GitHub connection (sans token). */
export async function getGithubConnection(): Promise<GithubConnectionInfo | null> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const service = getServiceClient();
  const { data } = await service
    .from("user_github_connections")
    .select("github_login, github_avatar_url, scopes, connected_at")
    .eq("user_id", user.id)
    .maybeSingle();

  return data ?? null;
}

/** Tear down the current user's GitHub connection. Best-effort token revoke. */
export async function disconnectGithub(): Promise<void> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const service = getServiceClient();
  const { data: connection } = await service
    .from("user_github_connections")
    .select("encrypted_access_token")
    .eq("user_id", user.id)
    .maybeSingle();

  if (connection) {
    try {
      const token = decrypt(connection.encrypted_access_token);
      const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
      const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
      if (clientId && clientSecret) {
        await revokeGrant(token, clientId, clientSecret);
      }
    } catch (err) {
      // Best-effort — never block disconnect on revocation failure
      logger.warn("GitHub token revoke failed", {
        userId: user.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await dropConnection(user.id);
  logger.info("github_disconnected", { userId: user.id });
  revalidatePath(`/profile/${user.id}`);
}

/**
 * List the current user's own repos. Paginated via `page` (1-based).
 * Returns at most 100 per call.
 */
export async function listMyGithubRepos(page = 1): Promise<RepoSummary[]> {
  const { user, connection } = await requireUserAndConnection();

  const token = decrypt(connection.encrypted_access_token);
  const repos = await handleGithubError(user.id, () => listOwnRepos(token, { page }));
  return repos.map(toSummary);
}

interface CreateRepoInput {
  name: string;
  description?: string;
  isPrivate: boolean;
  initReadme: boolean;
}

/** Create a new repo under the current user and return its summary. */
export async function createGithubRepo(input: CreateRepoInput): Promise<RepoSummary> {
  const { user, connection } = await requireUserAndConnection();

  const name = toRepoName(input.name);
  if (!name) throw new Error("Repository name is required");

  const token = decrypt(connection.encrypted_access_token);
  const repo = await handleGithubError(user.id, () =>
    createOwnRepo(token, {
      name,
      description: input.description?.trim() || undefined,
      isPrivate: input.isPrivate,
      autoInit: input.initReadme,
    })
  );

  logger.info("github_repo_created", { userId: user.id, repo: repo.full_name });
  return toSummary(repo);
}

/**
 * Persist a github_url on an idea. Returns the normalised URL we stored.
 * Caller indicates `source` for telemetry (browse / create / manual).
 *
 * Validates manual URLs against parseRepoUrl so we don't store junk.
 */
export async function linkRepoToIdea(
  ideaId: string,
  rawUrl: string,
  source: LinkSource
): Promise<string> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  let url: string;
  if (source === "manual") {
    const parsed = parseRepoUrl(rawUrl);
    if (!parsed) throw new Error("Not a valid GitHub repository URL");
    url = parsed;
  } else {
    // browse / create paths supply a github.com html_url straight from the API
    if (!rawUrl.startsWith("https://github.com/")) {
      throw new Error("Invalid repo URL");
    }
    url = rawUrl;
  }

  const { error } = await supabase
    .from("ideas")
    .update({ github_url: url })
    .eq("id", ideaId);

  if (error) throw new Error(error.message);

  logger.info("github_repo_linked", { userId: user.id, ideaId, source });
  revalidatePath(`/ideas/${ideaId}`);
  return url;
}

export interface RepoAccessCheck {
  state: RepoAccessState;
  owner: string;
  repo: string;
}

/**
 * Repo reachability check for the "Paste URL" tab (V1–V6 in the approved UX
 * design). Allow-with-warning: the result only informs the verification
 * panel, it never blocks saving (Save gating on the client only reacts to
 * malformed-URL, which is checked before this is ever called).
 *
 * Never calls GitHub when the user has no connection (V1) — no new scopes
 * are requested, and we reuse the user's existing token. Any failure
 * (timeout, rate-limit, network error, unexpected status) resolves to
 * "unreachable" rather than throwing, per FR-8.
 */
export async function verifyRepoAccess(url: string): Promise<RepoAccessCheck> {
  const parsed = parseRepoUrl(url);
  if (!parsed) throw new Error("Not a valid GitHub repository URL");

  const match = parsed.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)$/);
  if (!match) throw new Error("Not a valid GitHub repository URL");
  const [, owner, repo] = match;

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const service = getServiceClient();
  const { data: connection } = await service
    .from("user_github_connections")
    .select("encrypted_access_token")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!connection) {
    return { state: "no_connection", owner, repo };
  }

  let httpStatus: number | undefined;
  let isPrivate: boolean | undefined;
  let hadError = false;

  try {
    const token = decrypt(connection.encrypted_access_token);
    const repoData = await getRepo(token, owner, repo);
    httpStatus = 200;
    isPrivate = repoData.private;
  } catch (err) {
    if (err instanceof GithubApiError) {
      httpStatus = err.status;
    } else {
      // Network error, timeout/abort — no HTTP status to classify.
      hadError = true;
      logger.warn("verifyRepoAccess request failed", {
        userId: user.id,
        owner,
        repo,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const state = classifyRepoAccess({ hasConnection: true, httpStatus, isPrivate, error: hadError });
  return { state, owner, repo };
}
