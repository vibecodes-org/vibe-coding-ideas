"use server";

import { logger } from "@/lib/logger";

/**
 * TEMPORARY diagnostic endpoint — captures client-side errors (esp. React #185)
 * and writes them to the server logger so they surface in Vercel runtime logs.
 * Remove once the board drag-drop crash is fully diagnosed.
 */
export async function logClientError(data: {
  message: string;
  stack?: string;
  digest?: string;
  url?: string;
  userAgent?: string;
  source?: string;
}) {
  logger.error("client_error_diag", {
    msg: data.message?.slice(0, 4000) ?? "",
    stack: data.stack?.slice(0, 4000),
    digest: data.digest,
    url: data.url,
    ua: data.userAgent?.slice(0, 300),
    source: data.source ?? "unknown",
  });
}
