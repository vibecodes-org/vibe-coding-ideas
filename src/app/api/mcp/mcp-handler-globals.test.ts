// @vitest-environment node
//
// Regression pin for card b6e5c728 — globalThis.Response poisoning.
//
// mcp-handler@1.0.7 (via @modelcontextprotocol/sdk@1.25.2 → @hono/node-server
// getRequestListener) REPLACED globalThis.Response/Request when the MCP route
// module loaded. Next's `res instanceof Response` check (app-route module) then
// rejected Response.json()/NextResponse.json() from OTHER routes sharing the
// function instance → empty 500 "No response is returned from route handler".
// Victims in production: /api/terminal/session and the three /api/ai/* routes.
//
// mcp-handler@1.1.0 uses the SDK's web-standard transport (no hono, no global
// mutation). This test imports and INVOKES the handler — the mutation happened
// at transport construction, not just import — and asserts the globals survive.
// The ordered e2e in e2e/auth/middleware.spec.ts is the full-stack pin.
import { describe, it, expect } from "vitest";

describe("mcp-handler global object poisoning (card b6e5c728)", () => {
  it("importing and invoking createMcpHandler leaves globalThis.Response/Request untouched", async () => {
    const OriginalResponse = globalThis.Response;
    const OriginalRequest = globalThis.Request;

    const { createMcpHandler } = await import("mcp-handler");
    const handler = createMcpHandler(
      (server) => {
        server.tool("noop", "does nothing", {}, async () => ({
          content: [{ type: "text" as const, text: "ok" }],
        }));
      },
      { serverInfo: { name: "poison-pin", version: "0.0.0" } },
      { streamableHttpEndpoint: "/api/mcp" }
    );

    // Drive a real request through the transport — the old hono-based transport
    // only swapped the globals once getRequestListener() ran.
    const res = await handler(
      new OriginalRequest("http://localhost/api/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "poison-pin", version: "0.0.0" },
          },
        }),
      })
    );

    // The poisoning symptom, distilled: the handler must not have replaced the
    // global constructors, and its own response must still satisfy the SAME
    // `instanceof Response` check Next.js applies to every route's return value.
    expect(globalThis.Response).toBe(OriginalResponse);
    expect(globalThis.Request).toBe(OriginalRequest);
    expect(res).toBeInstanceOf(OriginalResponse);
  });
});
