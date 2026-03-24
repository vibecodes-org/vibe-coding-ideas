import type { McpContext } from "./context";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMcpServer = { tool: (...args: any[]) => any };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ServerExtra = { authInfo?: any; [key: string]: any };

export interface ToolLogEntry {
  tool_name: string;
  user_id: string;
  owner_user_id: string | null;
  duration_ms: number;
  is_error: boolean;
  mode: "stdio" | "remote";
  idea_id: string | null;
}

type LogFn = (entry: ToolLogEntry) => void;

/**
 * Optional callback to mark a user's first MCP connection.
 * Called with the owner user ID (the real human, not the bot identity)
 * after each successful tool call. Implementations should be idempotent
 * (only set mcp_connected_at when it's currently NULL).
 */
type McpConnectFn = (ownerUserId: string) => void;

/**
 * Extract idea_id from tool arguments if present.
 * Most VibeCodes MCP tools accept idea_id as a parameter.
 */
function extractIdeaId(args: Record<string, unknown>): string | null {
  const id = args.idea_id;
  if (typeof id === "string" && id.length > 0) return id;
  return null;
}

/**
 * Wraps an MCP server to instrument all tool calls with timing and logging.
 * The wrapper intercepts `server.tool()` registrations and wraps each handler
 * to measure duration, capture success/failure, and fire-and-forget log entries.
 *
 * @param server The MCP server to wrap
 * @param getContext Function to get the current McpContext (for user identity)
 * @param logFn Fire-and-forget logging function
 * @param mode "stdio" or "remote"
 * @param mcpConnectFn Optional callback to mark first MCP connection for the owner user
 */
export function instrumentServer(
  server: AnyMcpServer,
  getContext: (extra: ServerExtra) => McpContext | Promise<McpContext>,
  logFn: LogFn,
  mode: "stdio" | "remote",
  mcpConnectFn?: McpConnectFn
): AnyMcpServer {
  const originalTool = server.tool.bind(server);

  return {
    ...server,
    tool: (
      name: string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...rest: any[]
    ) => {
      // server.tool() can be called with 3 or 4 args:
      // tool(name, description, schema, handler)  — 4 args
      // tool(name, schema, handler)                — 3 args
      // We need to wrap the last argument (the handler)
      const handler = rest[rest.length - 1] as (
        args: Record<string, unknown>,
        extra: ServerExtra
      ) => Promise<unknown>;

      const wrappedHandler = async (
        args: Record<string, unknown>,
        extra: ServerExtra
      ) => {
        const start = Date.now();
        let ctx: McpContext | null = null;

        try {
          // Get context for identity — but don't fail if context resolution fails
          try {
            ctx = await getContext(extra);
          } catch {
            // Context resolution failed — still execute the tool
          }

          const result = await handler(args, extra);
          const durationMs = Date.now() - start;

          // Fire-and-forget log
          if (ctx) {
            try {
              logFn({
                tool_name: name,
                user_id: ctx.userId,
                owner_user_id: ctx.ownerUserId ?? null,
                duration_ms: durationMs,
                is_error: !!(result && typeof result === "object" && "isError" in result && result.isError),
                mode,
                idea_id: extractIdeaId(args),
              });
            } catch {
              // Never let logging break tool execution
            }

            // Fire-and-forget: mark first MCP connection for the owner user
            if (mcpConnectFn) {
              const ownerId = ctx.ownerUserId ?? ctx.userId;
              try {
                mcpConnectFn(ownerId);
              } catch {
                // Never let connection tracking break tool execution
              }
            }
          }

          return result;
        } catch (e) {
          const durationMs = Date.now() - start;

          if (ctx) {
            try {
              logFn({
                tool_name: name,
                user_id: ctx.userId,
                owner_user_id: ctx.ownerUserId ?? null,
                duration_ms: durationMs,
                is_error: true,
                mode,
                idea_id: extractIdeaId(args),
              });
            } catch {
              // Never let logging break tool execution
            }
          }

          throw e;
        }
      };

      // Replace the handler (last arg) with the wrapped version
      const newRest = [...rest];
      newRest[newRest.length - 1] = wrappedHandler;
      return originalTool(name, ...newRest);
    },
  };
}
