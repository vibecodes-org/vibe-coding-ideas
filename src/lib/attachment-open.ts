/**
 * Shared "open a task attachment" logic for the Files tab
 * (`task-attachments-section.tsx`) and the clickable attachment links
 * rendered by `Markdown` (`markdown.tsx`).
 *
 * `downloadAttachment` always forces a download (Files tab behaviour,
 * unchanged since before this module existed) via a short-lived signed URL.
 *
 * `openAttachment` picks one of three strategies per content type (see
 * `attachmentOpenStrategy`):
 *   - "proxy": text/* (including text/html) — Supabase Storage intentionally
 *     serves `text/html` objects as plain/raw text on the shared storage
 *     domain (anti-phishing), so a signed URL can never inline-render HTML.
 *     Instead we open `/api/attachments/view?id=` — our own route that
 *     downloads the object server-side (RLS-checked) and re-serves it with
 *     an explicit Content-Type. Opened synchronously (no await) so it can't
 *     be blocked as a popup.
 *   - "inline": images and PDF — mint a 5-minute signed URL and open it
 *     directly; the browser renders these natively regardless of Storage's
 *     text/* restriction.
 *   - "download": everything else — forced download via a signed URL, same
 *     as `downloadAttachment`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

const TASK_ATTACHMENTS_BUCKET = "task-attachments";

export type AttachmentOpenStrategy = "proxy" | "inline" | "download";

/**
 * Pure decision function: which strategy `openAttachment` uses for a given
 * content type. Exported standalone so it's testable without mocking
 * `window.open`/Supabase.
 */
export function attachmentOpenStrategy(contentType: string): AttachmentOpenStrategy {
  if (contentType.startsWith("text/")) return "proxy";
  if (contentType.startsWith("image/") || contentType === "application/pdf") return "inline";
  return "download";
}

export interface OpenableAttachment {
  id: string;
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
 * Opens an attachment in a new tab, picking the strategy from
 * `attachmentOpenStrategy`: text/* attachments open our inline-viewer proxy
 * route (synchronously, no signed URL needed); images/PDF open a 5-minute
 * inline signed URL; everything else forces a download.
 * Throws on failure (signed-URL branches only) so callers can surface a toast.
 */
export async function openAttachment(
  supabase: SupabaseClient<Database>,
  attachment: OpenableAttachment
): Promise<void> {
  const strategy = attachmentOpenStrategy(attachment.content_type);

  if (strategy === "proxy") {
    // Synchronous — no await before window.open, so popup blockers can't
    // intervene. The route itself performs the RLS-checked download.
    window.open(
      `/api/attachments/view?id=${encodeURIComponent(attachment.id)}`,
      "_blank",
      "noopener,noreferrer"
    );
    return;
  }

  const url = await mintSignedUrl(supabase, attachment, strategy === "download");
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
