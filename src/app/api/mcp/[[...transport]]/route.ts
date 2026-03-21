import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { createClient } from "@supabase/supabase-js";
import { registerTools } from "../../../../../mcp-server/src/register-tools";
import { instrumentServer } from "../../../../../mcp-server/src/instrument";
import type { McpContext } from "../../../../../mcp-server/src/context";
import type { Database } from "@/types/database";

// Service-role client for fire-and-forget logging (bypasses RLS)
const serviceClient = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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
            if (error) console.error("[MCP Tool Log] Insert failed:", error.message);
          });
      },
      "remote"
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
