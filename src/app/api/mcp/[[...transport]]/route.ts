import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { registerTools } from "../../../../../mcp-server/src/register-tools";
import { instrumentServer } from "../../../../../mcp-server/src/instrument";
import { resolveActiveBotId } from "../../../../../mcp-server/src/bot-identity";
import { logger } from "@/lib/logger";
import { getAttachmentContext } from "@/lib/attachment-context";
import type { McpContext } from "../../../../../mcp-server/src/context";
import type { Database } from "@/types/database";

// Service-role client for fire-and-forget logging (bypasses RLS)
const serviceClient = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// In-memory JWT cache for API key sessions: userId → { accessToken, expiresAt (Unix s) }
const apiKeySessionCache = new Map<string, { accessToken: string; expiresAt: number }>();

/**
 * Exchange a validated user_id (from a vbc_ API key lookup) for a real Supabase
 * session JWT. Uses generateLink + verifyOtp so the JWT is properly signed and
 * RLS-enforced, without requiring the user's password.  Results are cached for
 * ~1 hour to avoid a round-trip on every MCP tool call.
 */
async function getSessionForApiKey(userId: string): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  const cached = apiKeySessionCache.get(userId);
  // Reuse cached token if it has more than 60 s remaining
  if (cached && cached.expiresAt > now + 60) {
    return cached.accessToken;
  }

  // Resolve the user's email (needed for magic-link OTP flow)
  const { data: { user }, error: userError } =
    await serviceClient.auth.admin.getUserById(userId);
  if (userError || !user?.email) {
    logger.error("API key session: could not resolve user", { userId, error: userError?.message });
    return null;
  }

  // Generate a one-time magic-link token (no email is sent)
  const { data: linkData, error: linkError } =
    await serviceClient.auth.admin.generateLink({ type: "magiclink", email: user.email });
  if (linkError || !linkData.properties?.email_otp) {
    logger.error("API key session: generateLink failed", { error: linkError?.message });
    return null;
  }

  // Exchange the OTP for a real signed Supabase JWT via the anon client
  const anonClient = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data: sessionData, error: otpError } = await anonClient.auth.verifyOtp({
    email: user.email,
    token: linkData.properties.email_otp,
    type: "magiclink",
  });
  if (otpError || !sessionData.session) {
    logger.error("API key session: verifyOtp failed", { error: otpError?.message });
    return null;
  }

  const { access_token, expires_in } = sessionData.session;
  apiKeySessionCache.set(userId, { accessToken: access_token, expiresAt: now + (expires_in ?? 3600) });
  return access_token;
}

/**
 * Derive a per-connection key from the caller's JWT so concurrent MCP
 * connections (same user account, different Claude Code sessions) get isolated
 * agent identities.
 *
 * The OAuth token endpoint mints a DEDICATED Supabase session per MCP client
 * (api/oauth/token — mintSessionForUser), so the `session_id` claim uniquely
 * identifies the connection and is stable across that client's token refreshes.
 * (Before that change, all of a user's clients shared one browser-derived
 * session — and even identical token strings — so neither the claim nor a
 * token hash could discriminate them.) Falls back to a hash of the raw token
 * for credentials without the claim.
 */
function sessionKeyFromToken(token: string): string {
  const payload = decodeJwtPayload(token);
  const sid = payload?.session_id;
  if (typeof sid === "string" && sid.length > 0) return sid;
  return createHash("sha256").update(token).digest("hex");
}

const handler = createMcpHandler(
  (server) => {
    const instrumentedServer = instrumentServer(
      server,
      async (extra) => {
        const authInfo = extra.authInfo;
        if (!authInfo) throw new Error("Authentication required");
        const realUserId = authInfo.extra?.userId as string;
        // Resolve identity per request (source of truth: mcp_agent_sessions,
        // scoped to this connection) so tool-log attribution matches the acting
        // agent. Not cached — see resolveActiveBotId.
        const sessionId = sessionKeyFromToken(authInfo.token);
        const activeBotId = await resolveActiveBotId(serviceClient, realUserId, sessionId);
        return {
          supabase: serviceClient,
          userId: activeBotId ?? realUserId,
          ownerUserId: realUserId,
          sessionId,
        } as McpContext;
      },
      (entry) => {
        serviceClient
          .from("mcp_tool_log")
          .insert(entry)
          .then(({ error }) => {
            if (error) logger.error("MCP tool log insert failed", { error: error.message });
          });
      },
      "remote",
      (ownerUserId) => {
        // Fire-and-forget: mark first MCP connection (idempotent — only sets when NULL)
        serviceClient
          .from("users")
          .update({ mcp_connected_at: new Date().toISOString() })
          .eq("id", ownerUserId)
          .is("mcp_connected_at", null)
          .then(({ error }) => {
            if (error) logger.error("MCP connect update failed", { error: error.message });
          });
      }
    );

    registerTools(
      instrumentedServer,
      async (extra) => {
        const authInfo = extra.authInfo;
        if (!authInfo) {
          throw new Error("Authentication required");
        }

        const realUserId = authInfo.extra?.userId as string;
        const token = authInfo.token;

        // Per-request Supabase client with user's JWT — RLS enforced
        const supabase = createClient<Database>(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          {
            global: {
              headers: { Authorization: `Bearer ${token}` },
            },
          }
        );

        // Resolve the active bot identity on EVERY tool call, scoped to this
        // connection (mcp_agent_sessions, keyed by user + session). No in-memory
        // cache: serverless instances fan out across requests, and concurrent
        // connections for the same user must not share identity. set_agent_identity
        // persists here; complete_step reads it back.
        const sessionId = sessionKeyFromToken(token);
        const activeBotId = await resolveActiveBotId(supabase, realUserId, sessionId);

        return {
          supabase,
          userId: activeBotId ?? realUserId,
          ownerUserId: realUserId,
          sessionId,
        } satisfies McpContext;
      },
      // Identity is resolved from the DB per request, so there is no in-memory
      // state to update here. set_agent_identity persists to mcp_agent_sessions.
      () => {},
      // Full parity attachment reader (incl. PDF text extraction) for
      // get_idea_enhancement_prompt — the remote transport runs inside the
      // Next app, so the real getAttachmentContext (with unpdf) is available.
      getAttachmentContext
    );
  },
  {
    serverInfo: { name: "vibecodes", version: "1.0.0" },
  },
  {
    streamableHttpEndpoint: "/api/mcp",
  }
);

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = Buffer.from(parts[1], "base64url").toString("utf-8");
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

const verifyToken = async (_req: Request, bearerToken?: string) => {
  if (!bearerToken) return undefined;

  // API key path — keys generated via the VibeCodes "MCP API Keys" settings panel
  if (bearerToken.startsWith("vbc_")) {
    const keyHash = createHash("sha256").update(bearerToken).digest("hex");
    const { data: keyRow } = await serviceClient
      .from("user_api_keys")
      .select("user_id, expires_at")
      .eq("key_hash", keyHash)
      .maybeSingle();

    if (!keyRow) return undefined;
    if (keyRow.expires_at && new Date(keyRow.expires_at) < new Date()) return undefined;

    // Fire-and-forget: record last used time
    serviceClient
      .from("user_api_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("key_hash", keyHash)
      .then(({ error }) => {
        if (error) logger.error("API key last_used_at update failed", { error: error.message });
      });

    // Exchange the API key for a real Supabase JWT so the registerTools context
    // builder can attach it as Authorization: Bearer and get RLS enforcement.
    const realJwt = await getSessionForApiKey(keyRow.user_id);
    if (!realJwt) return undefined;

    // Use the JWT's own expiry so mcp-handler knows when to re-authenticate
    const jwtPayload = decodeJwtPayload(realJwt);
    const jwtExp = jwtPayload?.exp as number | undefined;

    return {
      token: realJwt,
      clientId: "vibecodes-apikey",
      scopes: ["mcp:tools"],
      extra: { userId: keyRow.user_id },
      expiresAt: jwtExp ?? Math.floor(Date.now() / 1000) + 3600,
    };
  }

  // Decode JWT to check expiry without an API call
  const payload = decodeJwtPayload(bearerToken);
  if (!payload) return undefined;

  const exp = payload.exp as number | undefined;
  const sub = payload.sub as string | undefined;

  // Fast-reject expired tokens (no Supabase round-trip needed)
  if (exp && exp < Date.now() / 1000) return undefined;

  // Validate token with Supabase Auth (confirms signature + session validity)
  const supabase = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(bearerToken);

  if (error || !user) return undefined;

  return {
    token: bearerToken,
    clientId: "vibecodes",
    scopes: ["mcp:tools"],
    extra: { userId: user.id },
    // Tell mcp-handler when this token expires so it can return 401 proactively
    expiresAt: exp ?? Math.floor(Date.now() / 1000) + 3600,
  };
};

const authHandler = withMcpAuth(handler, verifyToken, {
  required: true,
  resourceMetadataPath: "/.well-known/oauth-protected-resource",
});

export { authHandler as GET, authHandler as POST, authHandler as DELETE };
