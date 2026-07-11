/**
 * Inline viewer proxy for text-family task attachments (text/html, text/plain,
 * and other text/* subtypes).
 *
 * Supabase Storage intentionally serves `text/html` objects as plain text
 * (no charset, forced download-adjacent behaviour) on the shared storage
 * domain as an anti-phishing measure — signed URLs can never inline-render
 * HTML. This route re-serves the object's bytes from our own origin with an
 * explicit `Content-Type` (plus a sandboxed CSP) so the browser renders it
 * instead of downloading/showing raw source.
 *
 * Images and PDFs are unaffected by the Storage restriction and keep using
 * signed URLs directly (see `src/lib/attachment-open.ts`) — this route is
 * only for the text family.
 */
import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

const TASK_ATTACHMENTS_BUCKET = "task-attachments";

function isTextFamily(contentType: string): boolean {
  return contentType === "text/html" || contentType.startsWith("text/");
}

/** RFC 5987 encoding so filenames with non-ASCII/quote/control chars can't break the header. */
function contentDispositionHeader(fileName: string): string {
  const asciiFallback = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "'");
  return `inline; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return Response.json({ error: "Missing id" }, { status: 400 });
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    // RLS (`board_task_attachments` "Team members can view" policy) decides
    // visibility — a row that exists but the user can't see comes back null,
    // same as a row that doesn't exist. Both are reported as 404.
    const { data: attachment, error: attachmentError } = await supabase
      .from("board_task_attachments")
      .select("id, file_name, content_type, storage_path")
      .eq("id", id)
      .maybeSingle();

    if (attachmentError || !attachment) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    if (!isTextFamily(attachment.content_type)) {
      return Response.json(
        { error: "This attachment type is not served by the inline viewer" },
        { status: 400 }
      );
    }

    // User-session client — storage RLS on the task-attachments bucket
    // already permits team members to read (the Files tab mints signed
    // URLs client-side with this same session), so no service-role key is
    // needed here.
    const { data: blob, error: downloadError } = await supabase.storage
      .from(TASK_ATTACHMENTS_BUCKET)
      .download(attachment.storage_path);

    if (downloadError || !blob) {
      logger.error("Attachment view: storage download failed", {
        attachmentId: attachment.id,
        error: downloadError?.message,
      });
      return Response.json({ error: "Failed to load attachment" }, { status: 404 });
    }

    return new Response(blob, {
      status: 200,
      headers: {
        "Content-Type": `${attachment.content_type}; charset=utf-8`,
        "Content-Security-Policy": "sandbox",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": contentDispositionHeader(attachment.file_name),
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (err) {
    logger.error("Attachment view API error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return Response.json({ error: "An unexpected error occurred" }, { status: 500 });
  }
}
