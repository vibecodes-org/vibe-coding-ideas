import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     * - .well-known (OAuth discovery endpoints)
     * - api/mcp (MCP endpoint - has its own auth via withMcpAuth)
     * - api/oauth (OAuth endpoints - handle their own auth)
     * - api/terminal (terminal session mint - does its own supabase.auth.getUser().
     *   Kept excluded as hygiene. NOTE: the "No response is returned from route
     *   handler" 500s (three production outages: Jul 1, Jul 3, Jul 6 2026 — card
     *   b6e5c728) were NOT caused by the middleware bridge as first suspected.
     *   Root cause: mcp-handler@1.0.7 → @modelcontextprotocol/sdk@1.25.2 →
     *   @hono/node-server getRequestListener() replaced globalThis.Response at
     *   module load of api/mcp/[[...transport]]/route.ts, so Next's
     *   `res instanceof Response` check rejected Response.json()/NextResponse.json()
     *   responses from OTHER routes sharing the function instance. Fixed by
     *   bumping mcp-handler to 1.1.0 (web-standard transport, no global mutation).)
     * - oauth (OAuth consent pages - handle their own auth)
     * - callback (auth callback - exchanges code for session, no getUser needed)
     */
    "/((?!_next/static|_next/image|favicon.ico|sw\\.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$|\\.well-known|api/mcp|api/oauth|api/terminal|oauth|callback|monitoring|ingest).*)",
  ],
};
