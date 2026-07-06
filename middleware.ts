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
     * - api/terminal (terminal session mint - does its own supabase.auth.getUser();
     *   the edge-middleware -> nodejs response bridge intermittently loses the
     *   route's response after a function instance recycles, surfacing as
     *   "No response is returned from route handler" 500s. Three production
     *   outages: Jul 1, Jul 3, Jul 6 2026 — card b6e5c728. Excluded routes
     *   (api/mcp, api/oauth) have never shown the error.)
     * - oauth (OAuth consent pages - handle their own auth)
     * - callback (auth callback - exchanges code for session, no getUser needed)
     */
    "/((?!_next/static|_next/image|favicon.ico|sw\\.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$|\\.well-known|api/mcp|api/oauth|api/terminal|oauth|callback|monitoring|ingest).*)",
  ],
};
