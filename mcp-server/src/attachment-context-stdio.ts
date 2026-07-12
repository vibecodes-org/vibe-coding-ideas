/**
 * stdio (local) attachment-context provider for the `get_idea_enhancement_prompt`
 * MCP tool. Text/markdown/html/csv/json only — no PDF text extraction, since
 * `unpdf` isn't (and shouldn't become) a mcp-server dependency: the stdio
 * server is a separately-bundled package and the remote transport (running
 * inside the Next app) already gets full parity via `getAttachmentContext`
 * (src/lib/attachment-context.ts). See docs/mcp-idea-enhance-tool-dx.html
 * section 7, Q4.
 *
 * PDFs are reported as omitted with reason "pdf_unsupported_on_stdio" (never
 * silently dropped) so the connected agent can explain the gap — e.g. "connect
 * via the remote MCP server to include the PDF" — instead of quietly
 * generating a worse enhancement.
 *
 * Mirrors the pure budgeting/formatting logic in src/lib/attachment-context.ts
 * (same caps, same truncation marker, same prompt-block format) without
 * importing that file — importing it would drag `unpdf` into the mcp-server
 * build, which has no node_modules for that dependency.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/types/database";
import { MAX_IDEA_ATTACHMENTS, ENHANCE_ATTACHMENT_MAX_MB } from "../../src/lib/validation";

const IDEA_ATTACHMENTS_BUCKET = "idea-attachments";

const MAX_DOWNLOAD_BYTES = ENHANCE_ATTACHMENT_MAX_MB * 1_048_576; // 5 MB
const PER_FILE_CHAR_BUDGET = 60_000;
const TOTAL_CHAR_BUDGET = 600_000;
const TRUNCATION_MARKER = "\n\n[... truncated ...]";

const TEXT_CONTENT_TYPES = new Set([
  "text/markdown",
  "text/html",
  "text/plain",
  "text/csv",
  "application/json",
]);
const TEXT_EXTENSIONS = new Set(["md", "markdown", "txt", "csv", "json", "html", "htm"]);

export interface StdioAttachmentUsage {
  used: Array<{ id: string; name: string; truncated: boolean }>;
  omitted: Array<{
    id: string;
    name: string;
    reason: "too_large" | "unsupported_type" | "over_budget" | "read_error" | "pdf_unsupported_on_stdio";
  }>;
}

export interface StdioAttachmentContextResult {
  promptBlock: string;
  usage: StdioAttachmentUsage;
}

const EMPTY_RESULT: StdioAttachmentContextResult = {
  promptBlock: "",
  usage: { used: [], omitted: [] },
};

function getExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf(".");
  return lastDot > 0 ? fileName.slice(lastDot + 1).toLowerCase() : "";
}

type Classification = "text" | "pdf" | "unsupported_type" | "too_large";

function classifyAttachment(att: {
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

/**
 * Fetch the idea's attachments, download/read eligible text files, and build
 * the same `\n\n---\n**Attached Files:**...` prompt block format as the web
 * app. Never throws — any failure (query error, download error, read error)
 * degrades to "omit this file" or, for a top-level failure, to the empty
 * result. Mirrors getAttachmentContext's never-throw contract.
 */
export async function getStdioAttachmentContext(
  supabase: SupabaseClient<Database>,
  ideaId: string
): Promise<StdioAttachmentContextResult> {
  try {
    const { data: attachments, error } = await supabase
      .from("idea_attachments")
      .select("id, file_name, file_size, content_type, storage_path")
      .eq("idea_id", ideaId)
      .order("created_at", { ascending: false })
      .limit(MAX_IDEA_ATTACHMENTS);

    if (error || !attachments || attachments.length === 0) return EMPTY_RESULT;

    const used: StdioAttachmentUsage["used"] = [];
    const omitted: StdioAttachmentUsage["omitted"] = [];
    const sections: string[] = [];
    let totalChars = 0;
    let budgetExhausted = false;

    for (const att of attachments) {
      const classification = classifyAttachment(att);

      if (classification === "too_large") {
        omitted.push({ id: att.id, name: att.file_name, reason: "too_large" });
        continue;
      }
      if (classification === "pdf") {
        omitted.push({ id: att.id, name: att.file_name, reason: "pdf_unsupported_on_stdio" });
        continue;
      }
      if (classification === "unsupported_type") {
        omitted.push({ id: att.id, name: att.file_name, reason: "unsupported_type" });
        continue;
      }

      try {
        const { data: blob, error: downloadError } = await supabase.storage
          .from(IDEA_ATTACHMENTS_BUCKET)
          .download(att.storage_path);

        if (downloadError || !blob) {
          throw downloadError ?? new Error("Empty download response");
        }

        const raw = await blob.text();
        let truncated = false;
        let fileText = raw;
        if (raw.length > PER_FILE_CHAR_BUDGET) {
          const codePoints = Array.from(raw);
          truncated = codePoints.length > PER_FILE_CHAR_BUDGET;
          fileText = truncated
            ? codePoints.slice(0, PER_FILE_CHAR_BUDGET).join("") + TRUNCATION_MARKER
            : raw;
        }

        if (budgetExhausted || totalChars + fileText.length > TOTAL_CHAR_BUDGET) {
          budgetExhausted = true;
          omitted.push({ id: att.id, name: att.file_name, reason: "over_budget" });
          continue;
        }

        totalChars += fileText.length;
        used.push({ id: att.id, name: att.file_name, truncated });
        sections.push(`## ${att.file_name}\n${fileText}`);
      } catch {
        omitted.push({ id: att.id, name: att.file_name, reason: "read_error" });
      }
    }

    if (used.length === 0) {
      return { promptBlock: "", usage: { used, omitted } };
    }

    let promptBlock = `\n\n---\n**Attached Files:**\n\n${sections.join("\n\n")}`;

    const budgetOmitted = omitted.filter((o) => o.reason === "over_budget");
    if (budgetOmitted.length > 0) {
      const names = budgetOmitted.map((o) => o.name).join(", ");
      promptBlock += `\n\n[${budgetOmitted.length} more attachment(s) omitted: ${names}]`;
    }

    return { promptBlock, usage: { used, omitted } };
  } catch {
    return EMPTY_RESULT;
  }
}
