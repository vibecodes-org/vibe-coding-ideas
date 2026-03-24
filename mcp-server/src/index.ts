import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { supabase, BOT_USER_ID, OWNER_USER_ID } from "./supabase";
import { registerTools } from "./register-tools";
import { instrumentServer } from "./instrument";
import type { McpContext } from "./context";

const server = new McpServer(
  { name: "vibecodes", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// Session-level mutable identity
// Can be overridden via VIBECODES_BOT_ID env var or set_agent_identity tool
let activeBotId: string | null = process.env.VIBECODES_BOT_ID || null;

export function setActiveBotId(botId: string | null) {
  activeBotId = botId;
}

export function getActiveBotId(): string | null {
  return activeBotId;
}

const getContext = (): McpContext => ({
  supabase,
  userId: activeBotId || BOT_USER_ID,
  // ownerUserId = the real human behind the bot session.
  // VIBECODES_OWNER_ID overrides for local dev so tools like list_agents and
  // get_agent_mentions can discover agents the human created via the web UI.
  // Falls back to BOT_USER_ID when a bot identity is active (mirrors remote MCP).
  ownerUserId: OWNER_USER_ID || (activeBotId ? BOT_USER_ID : undefined),
});

const instrumentedServer = instrumentServer(server, getContext, (entry) => {
  supabase
    .from("mcp_tool_log")
    .insert(entry)
    .then(({ error }) => {
      if (error) console.error("[MCP Tool Log] Insert failed:", error.message);
    });
}, "stdio", (ownerUserId) => {
  // Fire-and-forget: mark first MCP connection (idempotent — only sets when NULL)
  supabase
    .from("users")
    .update({ mcp_connected_at: new Date().toISOString() })
    .eq("id", ownerUserId)
    .is("mcp_connected_at", null)
    .then(({ error }) => {
      if (error) console.error("[MCP Connect] Update failed:", error.message);
    });
});

registerTools(instrumentedServer, getContext, setActiveBotId);

// --- Start server ---

async function main() {
  // If no explicit bot ID from env var, read persisted identity from DB
  if (!process.env.VIBECODES_BOT_ID) {
    const { data } = await supabase
      .from("users")
      .select("active_bot_id")
      .eq("id", BOT_USER_ID)
      .maybeSingle();

    if (data?.active_bot_id) {
      // Verify the bot is still active
      const { data: bot } = await supabase
        .from("bot_profiles")
        .select("id, is_active")
        .eq("id", data.active_bot_id)
        .maybeSingle();

      if (bot?.is_active) {
        setActiveBotId(bot.id);
        console.error(`Restored persisted bot identity: ${bot.id}`);
      }
    }
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("VibeCodes MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
