// Telling "this person has no session" apart from "we couldn't ASK whether
// they have a session" (card 42453a7d).
//
// `supabase.auth.getUser()` returns `{ data: { user: null }, error }` for BOTH
// cases, and every call site in this codebase used to destructure only `data`
// and treat a null user as "not authenticated". That is wrong — and provably
// so: production logs for 18/19 Aug 2026 show outbound fetches from these
// functions intermittently failing (`TypeError: fetch failed`, `write
// ETIMEDOUT`) in the exact window where the terminal mint route was refusing
// callers with 401 "Not authenticated" while the SAME browser's page requests
// were being served 200 seconds either side. A transient auth-service blip
// must not be reported to the user as "you're logged out".
//
// Shape-based on purpose (name + status), not `instanceof`: the error object
// crosses a bundling boundary and there may be more than one copy of
// @supabase/auth-js in the graph, which makes `instanceof` an unreliable
// runtime test. See auth-error.test.ts for the full truth table.

/** The subset of a Supabase AuthError this decision needs. */
export interface AuthErrorLike {
  name?: string;
  status?: number;
  message?: string;
}

/**
 * True when the auth check itself could not be completed — network failure,
 * timeout, or a 5xx from the auth service. The caller should answer 503 ("try
 * again"), never 401 ("you're not logged in").
 *
 * False for a genuine, answered "no session" (AuthSessionMissingError, an
 * expired/rotated token, a 4xx) and for `null`/`undefined` — those mean the
 * question WAS answered and the answer was no.
 */
export function isAuthCheckUnavailable(error: AuthErrorLike | null | undefined): boolean {
  if (!error) return false;
  if (error.name === "AuthRetryableFetchError") return true;
  // A missing/zero status is what a thrown-fetch failure surfaces as; a 5xx is
  // the auth service failing to answer. Both are "ask again later".
  if (typeof error.status !== "number" || error.status === 0) return true;
  return error.status >= 500;
}
