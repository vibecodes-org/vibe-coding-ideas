import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { supabase, BOT_USER_ID, OWNER_USER_ID } from "./supabase";
import { registerTools } from "./register-tools";
import { instrumentServer } from "./instrument";
import { getStdioAttachmentContext } from "./attachment-context-stdio";
import { SERVER_INSTRUCTIONS } from "./steering-copy";
import type { McpContext } from "./context";

const server = new McpServer(
  { name: "vibecodes-local", version: "1.0.0" },
  { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS }
);

// Ambient identity retired (docs/agent-voice-comments-design.html §4.1):
// stdio no longer reads or restores a persisted active-bot slot at runtime.
// The install's agent identity is now a STATIC, config-time value — set once
// via VIBECODES_BOT_ID and never changed for the life of the process — so it
// can't drift the way a runtime-mutable identity could. Attribution for
// workflow work still flows from claim_next_step's tokens, exactly as on the
// remote transport.
const STDIO_SESSION_ID = `stdio:${BOT_USER_ID}`;
const CONFIGURED_BOT_ID: string | null = process.env.VIBECODES_BOT_ID || null;

export function getActiveBotId(): string | null {
  return CONFIGURED_BOT_ID;
}

const getContext = (): McpContext => ({
  supabase,
  userId: CONFIGURED_BOT_ID || BOT_USER_ID,
  // ownerUserId = the real human behind the bot session.
  // VIBECODES_OWNER_ID overrides for local dev so tools like list_agents and
  // get_agent_mentions can discover agents the human created via the web UI.
  // Falls back to BOT_USER_ID when a bot identity is configured (mirrors remote MCP).
  ownerUserId: OWNER_USER_ID || (CONFIGURED_BOT_ID ? BOT_USER_ID : undefined),
  sessionId: STDIO_SESSION_ID,
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

// set_agent_identity is a Phase A deprecation stub — there is no
// identity-change state left for this callback to update.
registerTools(instrumentedServer, getContext, () => {}, getStdioAttachmentContext);

// --- Start server ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("VibeCodes MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
