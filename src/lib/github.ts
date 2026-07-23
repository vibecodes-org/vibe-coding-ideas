/**
 * GitHub API client used by the OAuth callback, server actions, and tests.
 *
 * Wraps the small slice of github.com REST we need: exchange code → token,
 * read the authed user, list and create personal repos, revoke a grant.
 *
 * All functions throw `GithubApiError` on non-2xx responses so callers can
 * surface a useful message; 401 specifically signals the stored token is no
 * longer valid and the connection should be auto-disconnected.
 */

const GITHUB_API = "https://api.github.com";
const GITHUB_OAUTH = "https://github.com/login/oauth";

export const GITHUB_SCOPES = ["repo", "read:user"] as const;

export class GithubApiError extends Error {
  status: number;
  rateLimitResetAt: number | null;

  constructor(message: string, status: number, rateLimitResetAt: number | null = null) {
    super(message);
    this.name = "GithubApiError";
    this.status = status;
    this.rateLimitResetAt = rateLimitResetAt;
  }
}

export interface GithubUser {
  id: number;
  login: string;
  avatar_url: string;
}

export interface GithubRepo {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  private: boolean;
  description: string | null;
  pushed_at: string;
  language: string | null;
  owner: {
    login: string;
    avatar_url: string;
  };
}

interface FetchOptions {
  method?: "GET" | "POST" | "DELETE";
  token?: string;
  body?: unknown;
  basicAuth?: { user: string; pass: string };
  signal?: AbortSignal;
}

async function githubFetch<T>(path: string, opts: FetchOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "VibeCodes",
  };

  if (opts.token) {
    headers.Authorization = `Bearer ${opts.token}`;
  } else if (opts.basicAuth) {
    const encoded = Buffer.from(`${opts.basicAuth.user}:${opts.basicAuth.pass}`).toString("base64");
    headers.Authorization = `Basic ${encoded}`;
  }
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const url = path.startsWith("http") ? path : `${GITHUB_API}${path}`;
  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });

  if (res.status === 204) {
    return undefined as T;
  }

  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;

  if (!res.ok) {
    const resetHeader = res.headers.get("x-ratelimit-reset");
    const resetAt = resetHeader ? parseInt(resetHeader, 10) * 1000 : null;
    const message =
      (data && typeof data === "object" && "message" in data && typeof data.message === "string"
        ? data.message
        : `GitHub API error ${res.status}`);
    throw new GithubApiError(message, res.status, resetAt);
  }

  return data as T;
}

/**
 * Exchange the OAuth code for an access token. Called once from the callback
 * route. Uses the token-exchange endpoint at github.com (not api.github.com).
 */
export async function exchangeCodeForToken(
  code: string,
  clientId: string,
  clientSecret: string
): Promise<{ access_token: string; scope: string }> {
  const res = await fetch(`${GITHUB_OAUTH}/access_token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "VibeCodes",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
  });

  if (!res.ok) {
    throw new GithubApiError(`Token exchange failed (${res.status})`, res.status);
  }

  const data = (await res.json()) as { access_token?: string; scope?: string; error?: string; error_description?: string };
  if (data.error || !data.access_token) {
    throw new GithubApiError(data.error_description ?? data.error ?? "Token exchange returned no token", 400);
  }

  return { access_token: data.access_token, scope: data.scope ?? "" };
}

/** Fetch the authenticated user — used by the callback to bind connection identity. */
export async function getAuthedUser(token: string): Promise<GithubUser> {
  return githubFetch<GithubUser>("/user", { token });
}

/**
 * List repos owned by the authenticated user, sorted by pushed_at desc.
 * Paginated; defaults to first 100. Pass `page` to lazy-load more.
 */
export async function listOwnRepos(
  token: string,
  options: { page?: number; perPage?: number } = {}
): Promise<GithubRepo[]> {
  const page = options.page ?? 1;
  const perPage = options.perPage ?? 100;
  return githubFetch<GithubRepo[]>(
    `/user/repos?affiliation=owner&sort=pushed&direction=desc&per_page=${perPage}&page=${page}`,
    { token }
  );
}

/** Create a repo under the authenticated user. */
export async function createOwnRepo(
  token: string,
  input: { name: string; description?: string; isPrivate: boolean; autoInit: boolean }
): Promise<GithubRepo> {
  return githubFetch<GithubRepo>("/user/repos", {
    method: "POST",
    token,
    body: {
      name: input.name,
      description: input.description ?? undefined,
      private: input.isPrivate,
      auto_init: input.autoInit,
    },
  });
}

/**
 * Fetch a single repo by owner/repo — used by the repo-reachability
 * verification (V1–V6, see docs/design-github-link-any-repo.html). Applies a
 * client-side timeout via AbortSignal.timeout since GitHub gives no SLA on
 * this endpoint and the caller must never hang the verification UI.
 *
 * Throws GithubApiError on any non-2xx response (404 = not found or private
 * + inaccessible to this token; 403 = rate-limited). Throws a plain
 * DOMException("AbortError") on timeout — callers should treat any non-
 * GithubApiError rejection as "unreachable".
 */
export async function getRepo(
  token: string,
  owner: string,
  repo: string,
  options: { timeoutMs?: number } = {}
): Promise<GithubRepo> {
  return githubFetch<GithubRepo>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
    token,
    signal: AbortSignal.timeout(options.timeoutMs ?? 5000),
  });
}

/**
 * Best-effort token revocation. The OAuth app credentials are required for
 * Basic auth; failures are logged by callers but never block disconnect.
 */
export async function revokeGrant(
  accessToken: string,
  clientId: string,
  clientSecret: string
): Promise<void> {
  await githubFetch<void>(`/applications/${clientId}/grant`, {
    method: "DELETE",
    basicAuth: { user: clientId, pass: clientSecret },
    body: { access_token: accessToken },
  });
}

/**
 * Sanitise a free-form string into a valid GitHub repo name. Rules:
 * - lowercase
 * - non-alphanumerics → "-"
 * - collapse repeated dashes
 * - strip leading/trailing dashes
 * - cap at 100 chars (GitHub's hard limit)
 *
 * Returns an empty string for inputs with no usable characters; callers should
 * treat that as "no default" and let the user type their own name.
 */
export function toRepoName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "")
    .slice(0, 100);
}

/**
 * Validate that a string looks like a GitHub repo URL — used for the manual
 * URL escape hatch. Accepts https://github.com/owner/repo with optional
 * trailing slash. Returns the normalised URL or null.
 */
export function parseRepoUrl(input: string): string | null {
  const trimmed = input.trim().replace(/\.git$/, "").replace(/\/$/, "");
  const match = trimmed.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)$/);
  if (!match) return null;
  return `https://github.com/${match[1]}/${match[2]}`;
}

/**
 * Build the GitHub OAuth authorize URL.
 */
export function buildAuthorizeUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
  scopes?: readonly string[];
}): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    scope: (opts.scopes ?? GITHUB_SCOPES).join(" "),
    state: opts.state,
    allow_signup: "true",
  });
  return `${GITHUB_OAUTH}/authorize?${params.toString()}`;
}

/**
 * Validate a return_to path. We never trust user input as an open redirect
 * target — only same-origin paths (starting with `/`, no scheme/host) are
 * allowed. Returns a safe default if the input is suspicious.
 */
export function safeReturnTo(input: string | null | undefined, fallback = "/"): string {
  if (!input || typeof input !== "string") return fallback;
  // Reject anything that looks like a scheme, protocol-relative URL, or backslash
  if (/^[a-z][a-z0-9+.-]*:/i.test(input)) return fallback;
  if (input.startsWith("//") || input.startsWith("\\")) return fallback;
  if (!input.startsWith("/")) return fallback;
  return input;
}
