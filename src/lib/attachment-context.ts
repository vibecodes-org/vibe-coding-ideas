/**
 * Reads an idea's text-bearing attachments (Markdown, HTML, plain text, CSV,
 * JSON, and text-layer PDFs) and turns them into a prompt block the "Enhance
 * with AI" flows can inject, plus a usage receipt the UI can surface.
 *
 * Split into a pure function (`buildAttachmentPromptBlock`) that does
 * classification/budgeting/formatting from already-resolved content, and a
 * thin IO wrapper (`getAttachmentContext`) that queries `idea_attachments`,
 * downloads eligible files, and runs PDF text extraction. The pure function
 * is what AC-10's unit tests exercise directly — no Supabase mocking needed.
 */
import { extractText, getDocumentProxy } from "unpdf";
import { logger } from "@/lib/logger";
import { MAX_IDEA_ATTACHMENTS } from "@/lib/validation";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

const IDEA_ATTACHMENTS_BUCKET = "idea-attachments";

/** Files larger than this are never downloaded, regardless of type. */
const MAX_DOWNLOAD_BYTES = 1_048_576; // 1 MB
const PER_FILE_CHAR_BUDGET = 8_000;
const TOTAL_CHAR_BUDGET = 24_000;
const TRUNCATION_MARKER = "\n\n[... truncated ...]";

/** Content types eligible as plain text (in addition to the extension check below). */
const TEXT_CONTENT_TYPES = new Set([
  "text/markdown",
  "text/html",
  "text/plain",
  "text/csv",
  "application/json",
]);
const TEXT_EXTENSIONS = new Set(["md", "markdown", "txt", "csv", "json", "html", "htm"]);

export interface EnhanceAttachmentUsage {
  used: Array<{ id: string; name: string; truncated: boolean }>;
  omitted: Array<{
    id: string;
    name: string;
    reason: "too_large" | "unsupported_type" | "over_budget" | "read_error";
  }>;
}

export interface AttachmentContextResult {
  promptBlock: string;
  usage: EnhanceAttachmentUsage;
}

const EMPTY_RESULT: AttachmentContextResult = {
  promptBlock: "",
  usage: { used: [], omitted: [] },
};

function getExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf(".");
  return lastDot > 0 ? fileName.slice(lastDot + 1).toLowerCase() : "";
}

type Classification = "text" | "pdf" | "unsupported_type" | "too_large";

/** FR-2 filter rules. Size is checked first — it overrides type eligibility for any type. */
export function classifyAttachment(att: {
  file_name: string;
  file_size: number;
  content_type: string;
}): Classification {
  if (att.file_size > MAX_DOWNLOAD_BYTES) return "too_large";

  const ext = getExtension(att.file_name);
  if (att.content_type === "application/pdf" || ext === "pdf") return "pdf";
  if (TEXT_CONTENT_TYPES.has(att.content_type) || TEXT_EXTENSIONS.has(ext)) return "text";
  return "unsupported_type";
}

/** A pre-classified attachment with its content already resolved (or a reason it wasn't). */
export interface AttachmentCandidate {
  id: string;
  name: string;
  /** Resolved text content. Must be non-null when skipReason is null. */
  content: string | null;
  /** Non-budget skip reason determined before/during read. Null means eligible for the prompt. */
  skipReason: "too_large" | "unsupported_type" | "read_error" | null;
}

/**
 * Pure budgeting + formatting step: given candidates in newest-first order,
 * decide which fit the per-file/total char budget, truncate as needed, and
 * build the prompt block + usage receipt. No IO.
 */
export function buildAttachmentPromptBlock(
  candidates: AttachmentCandidate[]
): AttachmentContextResult {
  const used: EnhanceAttachmentUsage["used"] = [];
  const omitted: EnhanceAttachmentUsage["omitted"] = [];
  const sections: string[] = [];
  let totalChars = 0;
  let budgetExhausted = false;

  for (const candidate of candidates) {
    if (candidate.skipReason) {
      omitted.push({ id: candidate.id, name: candidate.name, reason: candidate.skipReason });
      continue;
    }

    const raw = candidate.content ?? "";
    const truncated = raw.length > PER_FILE_CHAR_BUDGET;
    const fileText = truncated ? raw.slice(0, PER_FILE_CHAR_BUDGET) + TRUNCATION_MARKER : raw;

    if (budgetExhausted || totalChars + fileText.length > TOTAL_CHAR_BUDGET) {
      budgetExhausted = true;
      omitted.push({ id: candidate.id, name: candidate.name, reason: "over_budget" });
      continue;
    }

    totalChars += fileText.length;
    used.push({ id: candidate.id, name: candidate.name, truncated });
    sections.push(`## ${candidate.name}\n${fileText}`);
  }

  if (used.length === 0) {
    // Nothing to inject — byte parity for callers, but the usage receipt
    // (e.g. all-omitted) still reflects what happened.
    return { promptBlock: "", usage: { used, omitted } };
  }

  let promptBlock = `\n\n---\n**Attached Files:**\n\n${sections.join("\n\n")}`;

  const budgetOmitted = omitted.filter((o) => o.reason === "over_budget");
  if (budgetOmitted.length > 0) {
    const names = budgetOmitted.map((o) => o.name).join(", ");
    promptBlock += `\n\n[${budgetOmitted.length} more attachment(s) omitted: ${names}]`;
  }

  return { promptBlock, usage: { used, omitted } };
}

/**
 * IO wrapper: fetch the idea's attachments, download/extract eligible ones,
 * and hand off to the pure budgeting step. Never throws — any failure
 * (query error, download error, extraction error) degrades to "omit this
 * file" or, for a top-level failure, to the empty result.
 */
export async function getAttachmentContext(
  supabase: SupabaseClient<Database>,
  ideaId: string
): Promise<AttachmentContextResult> {
  try {
    const { data: attachments, error } = await supabase
      .from("idea_attachments")
      .select("id, file_name, file_size, content_type, storage_path")
      .eq("idea_id", ideaId)
      .order("created_at", { ascending: false })
      .limit(MAX_IDEA_ATTACHMENTS);

    if (error) {
      logger.warn("Failed to list idea attachments for AI context", {
        ideaId,
        error: error.message,
      });
      return EMPTY_RESULT;
    }

    if (!attachments || attachments.length === 0) {
      return EMPTY_RESULT;
    }

    const candidates: AttachmentCandidate[] = [];

    // Sequential is fine — every downloaded file is capped at 1MB (N5).
    for (const att of attachments) {
      const classification = classifyAttachment(att);

      if (classification === "too_large" || classification === "unsupported_type") {
        candidates.push({
          id: att.id,
          name: att.file_name,
          content: null,
          skipReason: classification,
        });
        continue;
      }

      try {
        const { data: blob, error: downloadError } = await supabase.storage
          .from(IDEA_ATTACHMENTS_BUCKET)
          .download(att.storage_path);

        if (downloadError || !blob) {
          throw downloadError ?? new Error("Empty download response");
        }

        let text: string;
        if (classification === "pdf") {
          const buf = new Uint8Array(await blob.arrayBuffer());
          const pdf = await getDocumentProxy(buf);
          const result = await extractText(pdf, { mergePages: true });
          text = result.text;

          if (!text || !text.trim()) {
            // Scanned / image-only PDF — expected, not exceptional.
            candidates.push({
              id: att.id,
              name: att.file_name,
              content: null,
              skipReason: "read_error",
            });
            continue;
          }
        } else {
          text = await blob.text();
        }

        candidates.push({ id: att.id, name: att.file_name, content: text, skipReason: null });
      } catch (err) {
        logger.warn("Failed to read idea attachment for AI context", {
          ideaId,
          attachmentId: att.id,
          fileName: att.file_name,
          error: err instanceof Error ? err.message : String(err),
        });
        candidates.push({
          id: att.id,
          name: att.file_name,
          content: null,
          skipReason: "read_error",
        });
      }
    }

    return buildAttachmentPromptBlock(candidates);
  } catch (err) {
    logger.warn("Attachment context lookup failed; continuing without attachments", {
      ideaId,
      error: err instanceof Error ? err.message : String(err),
    });
    return EMPTY_RESULT;
  }
}

const HEADER_FILENAME_CAP = 100;
/** Conservative ceiling to stay under common single-header size limits (~8KB). */
const HEADER_MAX_ENCODED_LENGTH = 6_000;

/**
 * Serialize a usage receipt for the `X-Attachment-Usage` response header
 * (N2): cap filenames to keep the header small, and fall back to counts-only
 * if it's still oversized. Returns null when there's nothing to report
 * (zero attachments on the idea) so callers can omit the header entirely.
 */
export function encodeAttachmentUsageHeader(usage: EnhanceAttachmentUsage): string | null {
  if (usage.used.length === 0 && usage.omitted.length === 0) return null;

  const clampName = (name: string) =>
    name.length > HEADER_FILENAME_CAP ? name.slice(0, HEADER_FILENAME_CAP) : name;

  const clamped: EnhanceAttachmentUsage = {
    used: usage.used.map((u) => ({ ...u, name: clampName(u.name) })),
    omitted: usage.omitted.map((o) => ({ ...o, name: clampName(o.name) })),
  };

  const encoded = encodeURIComponent(JSON.stringify(clamped));
  if (encoded.length <= HEADER_MAX_ENCODED_LENGTH) return encoded;

  // Still too large (e.g. many long unicode filenames) — degrade to counts
  // rather than drop the header. A less-detailed but always-honest receipt.
  return encodeURIComponent(
    JSON.stringify({ usedCount: usage.used.length, omittedCount: usage.omitted.length })
  );
}
