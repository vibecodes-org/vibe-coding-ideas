/**
 * Shared "open a task attachment" logic for the Files tab
 * (`task-attachments-section.tsx`) and the clickable attachment links
 * rendered by `Markdown` (`markdown.tsx`).
 *
 * Both callers mint a short-lived signed URL from the `task-attachments`
 * bucket and open it in a new tab. They differ only in intent:
 *   - `downloadAttachment` always forces a download (Files tab behaviour,
 *     unchanged since before this module existed).
 *   - `openAttachment` opens inline-viewable types (images, PDF, HTML,
 *     plain text) in the browser, and falls back to a forced download for
 *     everything else — used by the new attachment links.
 *
 * `window.open` is called only after the signed URL resolves (mirrors the
 * pre-existing `handleDownload` pattern) — calling it synchronously inside
 * the click handler before the await would be blocked as a popup by some
 * browsers, and this keeps both code paths identical in that respect.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

const TASK_ATTACHMENTS_BUCKET = "task-attachments";

/** Content types opened inline (viewable in a browser tab) rather than downloaded. */
function isInlineContentType(contentType: string): boolean {
  return (
    contentType.startsWith("image/") ||
    contentType === "application/pdf" ||
    contentType === "text/html" ||
    contentType === "text/plain"
  );
}

export interface OpenableAttachment {
  storage_path: string;
  file_name: string;
  content_type: string;
}

async function mintSignedUrl(
  supabase: SupabaseClient<Database>,
  attachment: OpenableAttachment,
  forceDownload: boolean
): Promise<string> {
  const bucket = supabase.storage.from(TASK_ATTACHMENTS_BUCKET);

  const { data, error } = forceDownload
    ? await bucket.createSignedUrl(attachment.storage_path, 60, { download: attachment.file_name })
    : await bucket.createSignedUrl(attachment.storage_path, 300);

  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? "Failed to create signed URL");
  }

  return data.signedUrl;
}

/**
 * Opens an attachment in a new tab. Inline-viewable types (image/*, PDF,
 * HTML, plain text) open in the browser; everything else forces a download.
 * Throws on failure so callers can surface a toast.
 */
export async function openAttachment(
  supabase: SupabaseClient<Database>,
  attachment: OpenableAttachment
): Promise<void> {
  const forceDownload = !isInlineContentType(attachment.content_type);
  const url = await mintSignedUrl(supabase, attachment, forceDownload);
  window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * Always forces a download, regardless of content type. Used by the Files
 * tab download button — behaviour is unchanged from before this module
 * existed (byte-identical for the user: a download always starts).
 * Throws on failure so callers can surface a toast.
 */
export async function downloadAttachment(
  supabase: SupabaseClient<Database>,
  attachment: OpenableAttachment
): Promise<void> {
  const url = await mintSignedUrl(supabase, attachment, true);
  window.open(url, "_blank", "noopener,noreferrer");
}
