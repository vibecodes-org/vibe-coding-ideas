import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  classifyAttachment,
  buildAttachmentPromptBlock,
  encodeAttachmentUsageHeader,
  getAttachmentContext,
  appendAttachmentBlock,
  MAX_DOWNLOAD_BYTES,
  PER_FILE_CHAR_BUDGET,
  TOTAL_CHAR_BUDGET,
  type AttachmentCandidate,
} from "./attachment-context";

vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("unpdf", () => ({
  extractText: vi.fn(),
  getDocumentProxy: vi.fn(),
}));

import { extractText, getDocumentProxy } from "unpdf";
import { logger } from "@/lib/logger";

const mockExtractText = vi.mocked(extractText);
const mockGetDocumentProxy = vi.mocked(getDocumentProxy);

// ── classifyAttachment (FR-2 filter rules) ──────────────────────────────

describe("classifyAttachment", () => {
  it("classifies markdown by content type", () => {
    expect(
      classifyAttachment({ file_name: "notes.md", file_size: 100, content_type: "text/markdown" })
    ).toBe("text");
  });

  it("classifies html by extension when content type is generic", () => {
    expect(
      classifyAttachment({ file_name: "page.html", file_size: 100, content_type: "application/octet-stream" })
    ).toBe("text");
  });

  it("classifies a text-layer PDF as pdf", () => {
    expect(
      classifyAttachment({ file_name: "doc.pdf", file_size: 100, content_type: "application/pdf" })
    ).toBe("pdf");
  });

  it("classifies images as unsupported_type", () => {
    expect(
      classifyAttachment({ file_name: "photo.png", file_size: 100, content_type: "image/png" })
    ).toBe("unsupported_type");
  });

  it("classifies svg as unsupported_type", () => {
    expect(
      classifyAttachment({ file_name: "icon.svg", file_size: 100, content_type: "image/svg+xml" })
    ).toBe("unsupported_type");
  });

  it("classifies files over the size limit as too_large regardless of type", () => {
    expect(
      classifyAttachment({
        file_name: "notes.md",
        file_size: MAX_DOWNLOAD_BYTES + 1,
        content_type: "text/markdown",
      })
    ).toBe("too_large");
  });

  it("treats exactly the size limit as within budget (only strictly-over is too_large)", () => {
    expect(
      classifyAttachment({
        file_name: "notes.md",
        file_size: MAX_DOWNLOAD_BYTES,
        content_type: "text/markdown",
      })
    ).toBe("text");
  });
});

// ── buildAttachmentPromptBlock (pure budgeting/formatting) ──────────────

function candidate(overrides: Partial<AttachmentCandidate>): AttachmentCandidate {
  return { id: "id", name: "file.md", content: "hello", skipReason: null, ...overrides };
}

describe("buildAttachmentPromptBlock", () => {
  it("AC-1: includes a used markdown file's content under a delimiter", () => {
    const result = buildAttachmentPromptBlock([
      candidate({ id: "a1", name: "notes.md", content: "Some notes content" }),
    ]);

    expect(result.promptBlock).toContain("## notes.md");
    expect(result.promptBlock).toContain("Some notes content");
    expect(result.usage.used).toEqual([{ id: "a1", name: "notes.md", truncated: false }]);
    expect(result.usage.omitted).toEqual([]);
  });

  it("AC-2: truncates a single file at the per-file char budget with a marker", () => {
    const longContent = "x".repeat(PER_FILE_CHAR_BUDGET + 2_000);
    const result = buildAttachmentPromptBlock([
      candidate({ id: "a1", name: "big.pdf", content: longContent }),
    ]);

    expect(result.usage.used).toEqual([{ id: "a1", name: "big.pdf", truncated: true }]);
    expect(result.promptBlock).toContain("[... truncated ...]");
    // Cut to the per-file budget + marker — no run longer than the budget survives.
    expect(result.promptBlock).not.toContain("x".repeat(PER_FILE_CHAR_BUDGET + 1));
  });

  it("AC-3: a read_error candidate (e.g. scanned PDF) is omitted and doesn't affect the prompt", () => {
    const result = buildAttachmentPromptBlock([
      candidate({ id: "a1", name: "scanned.pdf", content: null, skipReason: "read_error" }),
    ]);

    expect(result.promptBlock).toBe("");
    expect(result.usage.used).toEqual([]);
    expect(result.usage.omitted).toEqual([{ id: "a1", name: "scanned.pdf", reason: "read_error" }]);
  });

  it("AC-4: unsupported_type and too_large candidates are omitted with the right reasons", () => {
    const result = buildAttachmentPromptBlock([
      candidate({ id: "a1", name: "photo.png", content: null, skipReason: "unsupported_type" }),
      candidate({ id: "a2", name: "huge.md", content: null, skipReason: "too_large" }),
    ]);

    expect(result.usage.omitted).toEqual(
      expect.arrayContaining([
        { id: "a1", name: "photo.png", reason: "unsupported_type" },
        { id: "a2", name: "huge.md", reason: "too_large" },
      ])
    );
  });

  it("AC-5: eligible files past the total budget (newest-first) are omitted:over_budget + marker", () => {
    // Each file is exactly the per-file budget (so it fills without truncation);
    // one more than fits in the total budget overflows to over_budget.
    const perFile = "y".repeat(PER_FILE_CHAR_BUDGET);
    const fit = Math.floor(TOTAL_CHAR_BUDGET / PER_FILE_CHAR_BUDGET);
    const candidates = Array.from({ length: fit + 1 }, (_, i) =>
      candidate({ id: String(i + 1), name: `f${i + 1}.md`, content: perFile })
    );

    const result = buildAttachmentPromptBlock(candidates);

    expect(result.usage.used.map((u) => u.id)).toEqual(
      Array.from({ length: fit }, (_, i) => String(i + 1))
    );
    const overflowName = `f${fit + 1}.md`;
    expect(result.usage.omitted).toEqual([
      { id: String(fit + 1), name: overflowName, reason: "over_budget" },
    ]);
    expect(result.promptBlock).toContain(`[1 more attachment(s) omitted: ${overflowName}]`);
  });

  it("AC-6: zero candidates → empty prompt block and empty usage arrays", () => {
    const result = buildAttachmentPromptBlock([]);
    expect(result.promptBlock).toBe("");
    expect(result.usage).toEqual({ used: [], omitted: [] });
  });

  it("Task 4a: truncates at a code-point boundary, never splitting a surrogate pair", () => {
    // "A" + budget-many emoji (each a surrogate pair) — a raw.slice() at the
    // char budget would land mid-pair for roughly half of these.
    const longContent = "A" + "\u{1F600}".repeat(PER_FILE_CHAR_BUDGET);
    const result = buildAttachmentPromptBlock([
      candidate({ id: "a1", name: "emoji.md", content: longContent }),
    ]);

    expect(result.usage.used).toEqual([{ id: "a1", name: "emoji.md", truncated: true }]);
    expect(result.promptBlock).toContain("[... truncated ...]");

    const sectionStart = result.promptBlock.indexOf("## emoji.md\n") + "## emoji.md\n".length;
    const markerStart = result.promptBlock.indexOf("\n\n[... truncated ...]");
    const truncatedContent = result.promptBlock.slice(sectionStart, markerStart);

    // A lone surrogate makes encodeURIComponent throw a URIError — this is a
    // cheap, reliable way to assert the cut never severed a pair.
    expect(() => encodeURIComponent(truncatedContent)).not.toThrow();
    // Cut to exactly the per-file budget in code points (not code units).
    expect(Array.from(truncatedContent)).toHaveLength(PER_FILE_CHAR_BUDGET);
  });

  it("orders sections in the order candidates are given (newest-first is the caller's contract)", () => {
    const result = buildAttachmentPromptBlock([
      candidate({ id: "1", name: "b.md", content: "B content" }),
      candidate({ id: "2", name: "a.md", content: "A content" }),
    ]);

    const bIndex = result.promptBlock.indexOf("## b.md");
    const aIndex = result.promptBlock.indexOf("## a.md");
    expect(bIndex).toBeGreaterThanOrEqual(0);
    expect(aIndex).toBeGreaterThan(bIndex);
  });
});

// ── encodeAttachmentUsageHeader (N2 header clamp) ────────────────────────

describe("encodeAttachmentUsageHeader", () => {
  it("returns null when there is nothing to report", () => {
    expect(encodeAttachmentUsageHeader({ used: [], omitted: [] })).toBeNull();
  });

  it("encodes a normal usage receipt", () => {
    const encoded = encodeAttachmentUsageHeader({
      used: [{ id: "1", name: "notes.md", truncated: false }],
      omitted: [],
    });
    expect(encoded).not.toBeNull();
    const decoded = JSON.parse(decodeURIComponent(encoded!));
    expect(decoded.used[0].name).toBe("notes.md");
  });

  it("clamps filenames longer than ~100 chars", () => {
    const longName = "a".repeat(300) + ".md";
    const encoded = encodeAttachmentUsageHeader({
      used: [{ id: "1", name: longName, truncated: false }],
      omitted: [],
    });
    const decoded = JSON.parse(decodeURIComponent(encoded!));
    expect(decoded.used[0].name.length).toBeLessThanOrEqual(100);
  });

  it("falls back to counts-only if even the clamped payload is oversized", () => {
    const used = Array.from({ length: 500 }, (_, i) => ({
      id: `id-${i}`,
      name: "x".repeat(100),
      truncated: false,
    }));
    const encoded = encodeAttachmentUsageHeader({ used, omitted: [] });
    const decoded = JSON.parse(decodeURIComponent(encoded!));
    expect(decoded).toEqual({ usedCount: 500, omittedCount: 0 });
  });

  // ── AC-6: all-omitted still emits the header (powers the amber warning) ──

  it("AC-6: used empty + omitted non-empty still returns a non-null header", () => {
    const encoded = encodeAttachmentUsageHeader({
      used: [],
      omitted: [{ id: "a1", name: "photo.png", reason: "unsupported_type" }],
    });

    expect(encoded).not.toBeNull();
    const decoded = JSON.parse(decodeURIComponent(encoded!));
    expect(decoded.used).toEqual([]);
    expect(decoded.omitted).toEqual([{ id: "a1", name: "photo.png", reason: "unsupported_type" }]);
  });

  // ── Task 4b: byte/encoded-length-aware filename clamp ────────────────────

  it("Task 4b: retains per-file detail for CJK filenames that would previously trigger fallback", () => {
    // 70 CJK chars is under the old 100-code-unit cap (so it went through
    // unclamped), but encodes to ~630 chars each — 10 of them blew past
    // HEADER_MAX_ENCODED_LENGTH under the old code-unit-only clamp.
    const cjkName = "測".repeat(70);
    const used = Array.from({ length: 10 }, (_, i) => ({
      id: `attachment-id-${i}`,
      name: cjkName,
      truncated: false,
    }));

    const encoded = encodeAttachmentUsageHeader({ used, omitted: [] });

    expect(encoded).not.toBeNull();
    const decoded = JSON.parse(decodeURIComponent(encoded!));
    // Still the detailed shape, not the counts-only fallback.
    expect(Array.isArray(decoded.used)).toBe(true);
    expect(decoded.used).toHaveLength(10);
    expect(decoded.usedCount).toBeUndefined();
  });

  it("Task 4b: modest CJK filenames (~20 chars, 10 attachments) retain full per-file detail", () => {
    const cjkName = "測".repeat(20);
    const used = Array.from({ length: 10 }, (_, i) => ({
      id: `attachment-id-${i}`,
      name: cjkName,
      truncated: false,
    }));

    const encoded = encodeAttachmentUsageHeader({ used, omitted: [] });

    const decoded = JSON.parse(decodeURIComponent(encoded!));
    expect(decoded.used).toHaveLength(10);
    expect(decoded.used[0].name).toBe(cjkName); // untouched — well within budget
  });

  it("Task 4b: a genuinely oversized CJK payload still falls back to counts-only", () => {
    const used = Array.from({ length: 500 }, (_, i) => ({
      id: `id-${i}`,
      name: "測".repeat(50),
      truncated: false,
    }));
    const encoded = encodeAttachmentUsageHeader({ used, omitted: [] });
    const decoded = JSON.parse(decodeURIComponent(encoded!));
    expect(decoded).toEqual({ usedCount: 500, omittedCount: 0 });
  });
});

// ── appendAttachmentBlock (Task 2: shared append, locks route/ai.ts parity) ─

describe("appendAttachmentBlock", () => {
  it("concatenates the prompt block onto the user prompt", () => {
    expect(appendAttachmentBlock("Base prompt", "\n\n---\nAttached")).toBe(
      "Base prompt\n\n---\nAttached"
    );
  });

  it("is byte-parity with the original prompt when promptBlock is empty (AC-6)", () => {
    expect(appendAttachmentBlock("Base prompt", "")).toBe("Base prompt");
  });

  it("produces the same result the two call sites (route.ts, ai.ts) rely on staying identical", () => {
    // Both src/app/api/ai/enhance/route.ts and enhanceIdeaWithContext in
    // src/actions/ai.ts call `appendAttachmentBlock(userPrompt, attachmentPromptBlock)`
    // with the same getAttachmentContext().promptBlock — since they now share
    // this one function, they're structurally incapable of diverging.
    const sharedPromptBlock = buildAttachmentPromptBlock([
      { id: "a1", name: "notes.md", content: "Some notes", skipReason: null },
    ]).promptBlock;

    const routeResult = appendAttachmentBlock("Route user prompt", sharedPromptBlock);
    const actionResult = appendAttachmentBlock("Route user prompt", sharedPromptBlock);

    expect(routeResult).toBe(actionResult);
    expect(routeResult).toBe("Route user prompt" + sharedPromptBlock);
  });
});

// ── getAttachmentContext (IO wrapper) ────────────────────────────────────

function makeSupabaseMock(opts: {
  attachments?: Array<{
    id: string;
    file_name: string;
    file_size: number;
    content_type: string;
    storage_path: string;
  }>;
  queryError?: { message: string };
  downloadBlob?: Blob;
  downloadError?: { message: string } | null;
}) {
  const limit = vi.fn().mockResolvedValue({
    data: opts.attachments ?? [],
    error: opts.queryError ?? null,
  });
  const order = vi.fn(() => ({ limit }));
  const eq = vi.fn(() => ({ order }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));

  const download = vi.fn().mockResolvedValue({
    data: opts.downloadBlob ?? null,
    error: opts.downloadError ?? null,
  });
  const storageFrom = vi.fn(() => ({ download }));

  return {
    from,
    storage: { from: storageFrom },
    _download: download,
  } as unknown as Parameters<typeof getAttachmentContext>[0] & { _download: typeof download };
}

describe("getAttachmentContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("AC-10 (empty-list null parity): returns empty result when the idea has no attachments", async () => {
    const supabase = makeSupabaseMock({ attachments: [] });
    const result = await getAttachmentContext(supabase, "idea-1");
    expect(result).toEqual({ promptBlock: "", usage: { used: [], omitted: [] } });
  });

  it("AC-9: a query error degrades to empty result and logs a warning, never throws", async () => {
    const supabase = makeSupabaseMock({ queryError: { message: "network blip" } });
    const result = await getAttachmentContext(supabase, "idea-1");
    expect(result).toEqual({ promptBlock: "", usage: { used: [], omitted: [] } });
    expect(logger.warn).toHaveBeenCalled();
  });

  it("downloads and includes a markdown attachment as text", async () => {
    const blob = { text: vi.fn().mockResolvedValue("# Hello\nMarkdown body") } as unknown as Blob;
    const supabase = makeSupabaseMock({
      attachments: [
        {
          id: "a1",
          file_name: "notes.md",
          file_size: 100,
          content_type: "text/markdown",
          storage_path: "idea-1/a1.md",
        },
      ],
      downloadBlob: blob,
    });

    const result = await getAttachmentContext(supabase, "idea-1");

    expect(result.usage.used).toEqual([{ id: "a1", name: "notes.md", truncated: false }]);
    expect(result.promptBlock).toContain("Markdown body");
  });

  it("AC-4: skips images without ever calling storage.download", async () => {
    const supabase = makeSupabaseMock({
      attachments: [
        {
          id: "a1",
          file_name: "photo.png",
          file_size: 100,
          content_type: "image/png",
          storage_path: "idea-1/a1.png",
        },
      ],
    });

    const result = await getAttachmentContext(supabase, "idea-1");

    expect(result.usage.omitted).toEqual([{ id: "a1", name: "photo.png", reason: "unsupported_type" }]);
    expect(supabase._download).not.toHaveBeenCalled();
  });

  it("AC-9: a download failure is logged and the file is skipped as read_error", async () => {
    const supabase = makeSupabaseMock({
      attachments: [
        {
          id: "a1",
          file_name: "notes.md",
          file_size: 100,
          content_type: "text/markdown",
          storage_path: "idea-1/a1.md",
        },
      ],
      downloadError: { message: "storage offline" },
    });

    const result = await getAttachmentContext(supabase, "idea-1");

    expect(result.usage.omitted).toEqual([{ id: "a1", name: "notes.md", reason: "read_error" }]);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("AC-2/AC-3: extracts text-layer PDFs and marks empty-extraction PDFs as read_error", async () => {
    const pdfBlob = { arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)) } as unknown as Blob;
    const supabase = makeSupabaseMock({
      attachments: [
        {
          id: "a1",
          file_name: "readable.pdf",
          file_size: 500,
          content_type: "application/pdf",
          storage_path: "idea-1/a1.pdf",
        },
        {
          id: "a2",
          file_name: "scanned.pdf",
          file_size: 500,
          content_type: "application/pdf",
          storage_path: "idea-1/a2.pdf",
        },
      ],
      downloadBlob: pdfBlob,
    });

    mockGetDocumentProxy.mockResolvedValue({} as never);
    mockExtractText
      .mockResolvedValueOnce({ totalPages: 1, text: "Extracted PDF text" })
      .mockResolvedValueOnce({ totalPages: 1, text: "   " });

    const result = await getAttachmentContext(supabase, "idea-1");

    expect(result.usage.used).toEqual([{ id: "a1", name: "readable.pdf", truncated: false }]);
    expect(result.usage.omitted).toEqual([{ id: "a2", name: "scanned.pdf", reason: "read_error" }]);
    expect(result.promptBlock).toContain("Extracted PDF text");
  });

  it("AC-6: an idea whose only attachment is all-omitted (a PNG) → empty prompt, non-empty omitted, non-null header", async () => {
    const supabase = makeSupabaseMock({
      attachments: [
        {
          id: "a1",
          file_name: "photo.png",
          file_size: 100,
          content_type: "image/png",
          storage_path: "idea-1/a1.png",
        },
      ],
    });

    const result = await getAttachmentContext(supabase, "idea-1");

    // Prompt is byte-parity with "no attachments" ...
    expect(result.promptBlock).toBe("");
    // ... but the usage receipt still says something was skipped ...
    expect(result.usage.omitted).toEqual([{ id: "a1", name: "photo.png", reason: "unsupported_type" }]);
    expect(result.usage.used).toEqual([]);
    // ... and the header is still emitted so the UI can render the
    // all-omitted amber warning (never suppressed just because used is empty).
    expect(encodeAttachmentUsageHeader(result.usage)).not.toBeNull();
  });

  // ── Task 3: unpdf throw-path hardening ──────────────────────────────────

  it("Task 3: getDocumentProxy throwing degrades that file to read_error and doesn't stop the batch", async () => {
    const pdfBlob = { arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)) } as unknown as Blob;
    const mdBlob = { text: vi.fn().mockResolvedValue("Markdown body") } as unknown as Blob;
    const supabase = makeSupabaseMock({
      attachments: [
        {
          id: "a1",
          file_name: "broken.pdf",
          file_size: 500,
          content_type: "application/pdf",
          storage_path: "idea-1/a1.pdf",
        },
        {
          id: "a2",
          file_name: "notes.md",
          file_size: 100,
          content_type: "text/markdown",
          storage_path: "idea-1/a2.md",
        },
      ],
    });
    // Newest-first order means a1 (pdf) downloads first, then a2 (md).
    supabase._download
      .mockResolvedValueOnce({ data: pdfBlob, error: null })
      .mockResolvedValueOnce({ data: mdBlob, error: null });
    mockGetDocumentProxy.mockRejectedValue(new Error("boom"));

    const result = await getAttachmentContext(supabase, "idea-1");

    expect(result.usage.omitted).toEqual([{ id: "a1", name: "broken.pdf", reason: "read_error" }]);
    expect(result.usage.used).toEqual([{ id: "a2", name: "notes.md", truncated: false }]);
    expect(result.promptBlock).toContain("Markdown body");
    expect(logger.warn).toHaveBeenCalled();
  });

  it("Task 3: extractText throwing degrades that file to read_error and doesn't stop the batch", async () => {
    const pdfBlob = { arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)) } as unknown as Blob;
    const mdBlob = { text: vi.fn().mockResolvedValue("Markdown body") } as unknown as Blob;
    const supabase = makeSupabaseMock({
      attachments: [
        {
          id: "a1",
          file_name: "broken.pdf",
          file_size: 500,
          content_type: "application/pdf",
          storage_path: "idea-1/a1.pdf",
        },
        {
          id: "a2",
          file_name: "notes.md",
          file_size: 100,
          content_type: "text/markdown",
          storage_path: "idea-1/a2.md",
        },
      ],
    });
    supabase._download
      .mockResolvedValueOnce({ data: pdfBlob, error: null })
      .mockResolvedValueOnce({ data: mdBlob, error: null });
    mockGetDocumentProxy.mockResolvedValue({} as never);
    mockExtractText.mockRejectedValue(new Error("boom"));

    const result = await getAttachmentContext(supabase, "idea-1");

    expect(result.usage.omitted).toEqual([{ id: "a1", name: "broken.pdf", reason: "read_error" }]);
    expect(result.usage.used).toEqual([{ id: "a2", name: "notes.md", truncated: false }]);
    expect(result.promptBlock).toContain("Markdown body");
    expect(logger.warn).toHaveBeenCalled();
  });

  it("Task 3: blob.text() throwing for a text file degrades to read_error and doesn't stop the batch", async () => {
    const brokenBlob = { text: vi.fn().mockRejectedValue(new Error("boom")) } as unknown as Blob;
    const mdBlob = { text: vi.fn().mockResolvedValue("Markdown body") } as unknown as Blob;
    const supabase = makeSupabaseMock({
      attachments: [
        {
          id: "a1",
          file_name: "broken.txt",
          file_size: 100,
          content_type: "text/plain",
          storage_path: "idea-1/a1.txt",
        },
        {
          id: "a2",
          file_name: "notes.md",
          file_size: 100,
          content_type: "text/markdown",
          storage_path: "idea-1/a2.md",
        },
      ],
    });
    supabase._download
      .mockResolvedValueOnce({ data: brokenBlob, error: null })
      .mockResolvedValueOnce({ data: mdBlob, error: null });

    const result = await getAttachmentContext(supabase, "idea-1");

    expect(result.usage.omitted).toEqual([{ id: "a1", name: "broken.txt", reason: "read_error" }]);
    expect(result.usage.used).toEqual([{ id: "a2", name: "notes.md", truncated: false }]);
    expect(result.promptBlock).toContain("Markdown body");
    expect(logger.warn).toHaveBeenCalled();
  });
});
