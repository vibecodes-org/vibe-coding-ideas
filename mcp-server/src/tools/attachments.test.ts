import { describe, it, expect, vi } from "vitest";
import type { McpContext } from "../context";
import { downloadAttachment, downloadAttachmentSchema } from "./attachments";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER_ID = "00000000-0000-4000-a000-000000000001";
const ATTACHMENT_ID = "00000000-0000-4000-a000-000000000050";
const TASK_ID = "00000000-0000-4000-a000-000000000010";
const IDEA_ID = "00000000-0000-4000-a000-000000000040";
const SIGNED_URL = "https://storage.example.com/signed/file.txt?token=abc";

function createChain(resolveWith: unknown = null) {
  const chain: Record<string, unknown> = {};

  for (const m of ["order", "limit", "range", "or", "filter", "delete"]) {
    chain[m] = vi.fn(() => chain);
  }

  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.insert = vi.fn(() => chain);
  chain.update = vi.fn(() => chain);

  chain.single = vi.fn(() =>
    Promise.resolve({ data: resolveWith, error: null })
  );
  chain.maybeSingle = vi.fn(() =>
    Promise.resolve({ data: resolveWith, error: null })
  );

  chain.then = (resolve: (val: unknown) => void) =>
    Promise.resolve({
      data: Array.isArray(resolveWith) ? resolveWith : [],
      error: null,
    }).then(resolve);

  return chain;
}

function makeAttachment(overrides: Record<string, unknown> = {}) {
  return {
    id: ATTACHMENT_ID,
    file_name: "notes.md",
    file_size: 256,
    content_type: "text/markdown",
    storage_path: `${IDEA_ID}/${TASK_ID}/abc.md`,
    ...overrides,
  };
}

function buildContext(opts: {
  attachment?: Record<string, unknown> | null;
  signedUrl?: string | null;
  signedUrlError?: { message: string } | null;
}): McpContext {
  const att = opts.attachment === null ? null : (opts.attachment ?? makeAttachment());
  const attachmentChain = createChain(att);

  const storageMock = {
    from: vi.fn(() => ({
      createSignedUrl: vi.fn(() =>
        Promise.resolve({
          data: opts.signedUrl !== undefined
            ? (opts.signedUrl ? { signedUrl: opts.signedUrl } : null)
            : { signedUrl: SIGNED_URL },
          error: opts.signedUrlError ?? null,
        })
      ),
    })),
  };

  const fromFn = vi.fn(() => attachmentChain);

  return {
    supabase: {
      from: fromFn,
      storage: storageMock,
    } as unknown as McpContext["supabase"],
    userId: USER_ID,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("downloadAttachment", () => {
  const params = downloadAttachmentSchema.parse({
    attachment_id: ATTACHMENT_ID,
    task_id: TASK_ID,
    idea_id: IDEA_ID,
  });

  it("returns text content inline for text-based files", async () => {
    const ctx = buildContext({ attachment: makeAttachment({ content_type: "text/markdown" }) });

    // Mock global fetch for the signed URL download
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        text: () => Promise.resolve("# Hello World\n\nThis is a test."),
      } as Response)
    );

    try {
      const result = await downloadAttachment(ctx, params);

      expect(result).toHaveProperty("content");
      expect(result).not.toHaveProperty("url");
      expect(result.content).toBe("# Hello World\n\nThis is a test.");
      expect(result.file_name).toBe("notes.md");
      expect(result.content_type).toBe("text/markdown");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns signed URL for binary files", async () => {
    const ctx = buildContext({
      attachment: makeAttachment({
        file_name: "screenshot.png",
        content_type: "image/png",
        file_size: 1024000,
      }),
    });

    const result = await downloadAttachment(ctx, params);

    expect(result).toHaveProperty("url");
    expect(result).not.toHaveProperty("content");
    expect(result.url).toBe(SIGNED_URL);
    expect(result.file_name).toBe("screenshot.png");
    expect(result.content_type).toBe("image/png");
  });

  it("throws when attachment not found", async () => {
    const ctx = buildContext({ attachment: null });

    await expect(downloadAttachment(ctx, params)).rejects.toThrow(
      `Attachment not found: ${ATTACHMENT_ID}`
    );
  });

  it("returns URL for PDF files", async () => {
    const ctx = buildContext({
      attachment: makeAttachment({
        file_name: "spec.pdf",
        content_type: "application/pdf",
      }),
    });

    const result = await downloadAttachment(ctx, params);

    expect(result).toHaveProperty("url");
    expect(result).not.toHaveProperty("content");
  });

  it("returns content inline for CSV files", async () => {
    const ctx = buildContext({
      attachment: makeAttachment({
        file_name: "data.csv",
        content_type: "text/csv",
      }),
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        text: () => Promise.resolve("name,age\nAlice,30\nBob,25"),
      } as Response)
    );

    try {
      const result = await downloadAttachment(ctx, params);

      expect(result).toHaveProperty("content");
      expect(result.content).toBe("name,age\nAlice,30\nBob,25");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
