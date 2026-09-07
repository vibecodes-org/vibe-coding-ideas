/**
 * Loopback-aware redirect_uri matching for the MCP OAuth flow (RFC 8252 §7.3).
 *
 * Native OAuth clients redirect to a loopback address on the user's own machine.
 * Different clients spell that address differently, and the port is ephemeral:
 *   - Claude Code registers  http://localhost:<port>/callback
 *   - Codex registers        http://127.0.0.1:<port>/callback/<server-callback-id>
 *
 * Two things make a naive exact-string match wrong here:
 *
 *  1. HOST FORM. `localhost`, `127.0.0.1` and `::1` are the same destination.
 *     Our hosting platform also normalizes `127.0.0.1` -> `localhost` in the
 *     *incoming* authorize query string, while /register stores the raw body
 *     value — so a client that registered `127.0.0.1` (Codex) never matched and
 *     got "redirect_uri not registered for this client".
 *
 *  2. PORT. Codex (and any RFC 8252 client) may bind a fresh OS-chosen port on
 *     each login while reusing its saved client registration. The spec REQUIRES
 *     the authorization server to allow any port for a loopback redirect.
 *
 * So for loopback redirects we match on scheme + path + query and ignore the
 * host form and the port. The path still must match exactly — for Codex that
 * path carries the per-server callback id, which is the real binding. For any
 * non-loopback redirect we fall back to exact (normalized) matching, so this
 * does not widen where a code can be sent on the public internet.
 */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

/**
 * A comparison key. Loopback redirects collapse to scheme + path + query (host
 * form and port dropped). Everything else is the URL normalized by the parser,
 * applied symmetrically to both sides so exact matching is preserved.
 * Unparseable input falls back to the raw string.
 */
export function redirectUriKey(uri: string): string {
  try {
    const u = new URL(uri);
    if (isLoopbackHost(u.hostname)) {
      return `loopback|${u.protocol}|${u.pathname}|${u.search}`;
    }
    return `${u.protocol}//${u.host}${u.pathname}${u.search}`;
  } catch {
    return uri;
  }
}

/**
 * The exact registered redirect_uri that matches `provided` (loopback-aware),
 * or null if none match. Returns the *registered* string so callers can honour
 * the host form the client's own callback server is bound to.
 */
export function matchRegisteredRedirectUri(
  registered: readonly string[] | null | undefined,
  provided: string | null | undefined
): string | null {
  if (!registered || registered.length === 0 || !provided) return null;
  const target = redirectUriKey(provided);
  for (const r of registered) {
    if (redirectUriKey(r) === target) return r;
  }
  return null;
}

/** Whether `provided` matches any registered redirect_uri (loopback-aware). */
export function redirectUriMatches(
  registered: readonly string[] | null | undefined,
  provided: string | null | undefined
): boolean {
  return matchRegisteredRedirectUri(registered, provided) !== null;
}

/**
 * The URL to actually send the browser back to. We keep the host form the
 * client REGISTERED (that is what its local callback server binds — changing
 * Claude's `localhost` to `127.0.0.1` could break it), but adopt the port from
 * the current request, since loopback ports are ephemeral and the live listener
 * is the one in this request. Non-loopback redirects are returned unchanged.
 */
export function resolveRedirectTarget(
  registeredUri: string,
  providedUri: string
): string {
  try {
    const registered = new URL(registeredUri);
    const provided = new URL(providedUri);
    if (
      isLoopbackHost(registered.hostname) &&
      isLoopbackHost(provided.hostname) &&
      provided.port !== registered.port
    ) {
      registered.port = provided.port;
    }
    return registered.toString();
  } catch {
    return registeredUri;
  }
}
