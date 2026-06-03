import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { registerTools } from "../../../../../mcp-server/src/register-tools";
import { instrumentServer } from "../../../../../mcp-server/src/instrument";
import { logger } from "@/lib/logger";
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

const handler = createMcpHandler(
  (server) => {
    // Per-connection mutable bot identity (set by set_bot_identity tool)
    let activeBotId: string | null = null;
    let identityInitialized = false;

    const instrumentedServer = instrumentServer(
      server,
      async (extra) => {
        const authInfo = extra.authInfo;
        if (!authInfo) throw new Error("Authentication required");
        const realUserId = authInfo.extra?.userId as string;
        // Lightweight context just for identity — not the full per-request client
        return { supabase: serviceClient, userId: activeBotId || realUserId, ownerUserId: realUserId } as McpContext;
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

        // Lazily read persisted bot identity on first tool call
        if (!identityInitialized) {
          identityInitialized = true;
          const { data } = await supabase
            .from("users")
            .select("active_bot_id")
            .eq("id", realUserId)
            .maybeSingle();

          if (data?.active_bot_id) {
            const { data: bot } = await supabase
              .from("bot_profiles")
              .select("id, is_active")
              .eq("id", data.active_bot_id)
              .maybeSingle();

            if (bot?.is_active) {
              activeBotId = bot.id;
            }
          }
        }

        return {
          supabase,
          userId: activeBotId || realUserId,
          ownerUserId: realUserId,
        } satisfies McpContext;
      },
      (botId) => {
        activeBotId = botId;
      }
    );
  },
  {
    serverInfo: { name: "vibecodes-remote", version: "1.0.0" },
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
