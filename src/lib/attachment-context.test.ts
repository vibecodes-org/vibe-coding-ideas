import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  classifyAttachment,
  buildAttachmentPromptBlock,
  encodeAttachmentUsageHeader,
  getAttachmentContext,
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

  it("classifies files over 1MB as too_large regardless of type", () => {
    expect(
      classifyAttachment({ file_name: "notes.md", file_size: 1_048_577, content_type: "text/markdown" })
    ).toBe("too_large");
  });

  it("treats exactly 1MB as within budget (only strictly-over is too_large)", () => {
    expect(
      classifyAttachment({ file_name: "notes.md", file_size: 1_048_576, content_type: "text/markdown" })
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

  it("AC-2: truncates a single file at the 8,000 char budget with a marker", () => {
    const longContent = "x".repeat(10_000);
    const result = buildAttachmentPromptBlock([
      candidate({ id: "a1", name: "big.pdf", content: longContent }),
    ]);

    expect(result.usage.used).toEqual([{ id: "a1", name: "big.pdf", truncated: true }]);
    expect(result.promptBlock).toContain("[... truncated ...]");
    // 8000 chars of content + the marker text, nothing more of the original.
    expect(result.promptBlock).not.toContain("x".repeat(10_000));
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

  it("AC-5: 4 eligible 8k files (newest-first) — first 3 included, 4th omitted:over_budget + marker", () => {
    const eightK = "y".repeat(8_000);
    const result = buildAttachmentPromptBlock([
      candidate({ id: "1", name: "newest.md", content: eightK }),
      candidate({ id: "2", name: "second.md", content: eightK }),
      candidate({ id: "3", name: "third.md", content: eightK }),
      candidate({ id: "4", name: "oldest.md", content: eightK }),
    ]);

    expect(result.usage.used.map((u) => u.id)).toEqual(["1", "2", "3"]);
    expect(result.usage.omitted).toEqual([{ id: "4", name: "oldest.md", reason: "over_budget" }]);
    expect(result.promptBlock).toContain("[1 more attachment(s) omitted: oldest.md]");
  });

  it("AC-6: zero candidates → empty prompt block and empty usage arrays", () => {
    const result = buildAttachmentPromptBlock([]);
    expect(result.promptBlock).toBe("");
    expect(result.usage).toEqual({ used: [], omitted: [] });
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
});
