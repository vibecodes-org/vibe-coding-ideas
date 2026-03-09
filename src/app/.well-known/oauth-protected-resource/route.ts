import { protectedResourceHandler } from "mcp-handler";
import { NextResponse } from "next/server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

const handler = protectedResourceHandler({
  authServerUrls: [
    process.env.NEXT_PUBLIC_APP_URL || "https://vibecodes.co.uk",
  ],
});

export { handler as GET };

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
