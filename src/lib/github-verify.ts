/**
 * Pure classifier for GitHub repo reachability checks (the "link any repo"
 * allow-with-warning verification, states V1–V6 from the approved UX design
 * at docs/design-github-link-any-repo.html).
 *
 * Kept separate from the GitHub HTTP client (src/lib/github.ts) and the
 * server action (src/actions/github.ts) so the owner/repo → state mapping is
 * unit-testable without mocking fetch or Supabase.
 */

export type RepoAccessState =
  | "no_connection"
  | "ok_public"
  | "ok_private"
  | "not_found_or_no_access"
  | "unreachable";

export interface ClassifyRepoAccessInput {
  /** Does the current user have a GitHub OAuth connection? */
  hasConnection: boolean;
  /** HTTP status returned by GET /repos/{owner}/{repo}, when a request was made. */
  httpStatus?: number;
  /** repo.private from a 200 response. Ignored for any other status. */
  isPrivate?: boolean;
  /**
   * Set when the request itself failed (network error, timeout/abort) rather
   * than returning a non-2xx HTTP response. Always maps to "unreachable".
   */
  error?: boolean;
}

/**
 * Maps a reachability attempt to one of the design's V-states. Never throws —
 * any unexpected/unmapped HTTP status degrades to "unreachable" rather than
 * surfacing an error, per FR-8 (no unhandled rejection, no hard failure on a
 * verification-only check).
 */
export function classifyRepoAccess({
  hasConnection,
  httpStatus,
  isPrivate,
  error,
}: ClassifyRepoAccessInput): RepoAccessState {
  // V1 — no GitHub connection. Checked first: no API call is made in this case,
  // so httpStatus/error are irrelevant.
  if (!hasConnection) return "no_connection";

  // Network error, timeout, or abort — never a repo-state signal.
  if (error) return "unreachable";

  if (httpStatus === 200) {
    return isPrivate ? "ok_private" : "ok_public";
  }

  // GitHub returns 404 for both "doesn't exist" and "private repo this token
  // can't see" — it deliberately doesn't distinguish the two to avoid leaking
  // private-repo existence. V4 states both possibilities rather than asserting
  // non-existence.
  if (httpStatus === 404) return "not_found_or_no_access";

  // 403 here is GitHub's rate-limit / secondary-rate-limit signal for this
  // endpoint (abuse detection), not a repo-access decision — treat as V6.
  if (httpStatus === 403) return "unreachable";

  // 5xx (GitHub down) and any other unmapped status also degrade to V6.
  return "unreachable";
}
