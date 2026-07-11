import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  openAttachment,
  downloadAttachment,
  attachmentOpenStrategy,
  type OpenableAttachment,
} from "./attachment-open";

function createStorageMock(signedUrl: string | null, error: { message: string } | null = null) {
  const createSignedUrl = vi.fn().mockResolvedValue({
    data: signedUrl ? { signedUrl } : null,
    error,
  });
  const supabase = {
    storage: {
      from: vi.fn(() => ({ createSignedUrl })),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return { supabase, createSignedUrl };
}

describe("attachmentOpenStrategy", () => {
  it.each([
    ["text/html", "proxy"],
    ["text/plain", "proxy"],
    ["text/markdown", "proxy"],
    ["image/png", "inline"],
    ["image/jpeg", "inline"],
    ["application/pdf", "inline"],
    ["application/zip", "download"],
    ["application/msword", "download"],
    ["application/octet-stream", "download"],
  ])("classifies %s as %s", (contentType, expected) => {
    expect(attachmentOpenStrategy(contentType)).toBe(expected);
  });
});

describe("openAttachment / downloadAttachment", () => {
  let openSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
  });

  afterEach(() => {
    openSpy.mockRestore();
  });

  const imageAttachment: OpenableAttachment = {
    id: "id-image",
    storage_path: "idea/task/photo.png",
    file_name: "photo.png",
    content_type: "image/png",
  };
  const pdfAttachment: OpenableAttachment = {
    id: "id-pdf",
    storage_path: "idea/task/report.pdf",
    file_name: "report.pdf",
    content_type: "application/pdf",
  };
  const htmlAttachment: OpenableAttachment = {
    id: "id-html",
    storage_path: "idea/task/page.html",
    file_name: "page.html",
    content_type: "text/html",
  };
  const textAttachment: OpenableAttachment = {
    id: "id-text",
    storage_path: "idea/task/notes.txt",
    file_name: "notes.txt",
    content_type: "text/plain",
  };
  const zipAttachment: OpenableAttachment = {
    id: "id-zip",
    storage_path: "idea/task/bundle.zip",
    file_name: "bundle.zip",
    content_type: "application/zip",
  };
  const docxAttachment: OpenableAttachment = {
    id: "id-docx",
    storage_path: "idea/task/plan.docx",
    file_name: "plan.docx",
    content_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };

  it.each([
    ["image/*", imageAttachment],
    ["application/pdf", pdfAttachment],
  ])("openAttachment mints a 5-minute inline signed URL for %s", async (_label, attachment) => {
    const { supabase, createSignedUrl } = createStorageMock("https://signed.example/inline");
    await openAttachment(supabase, attachment);

    expect(createSignedUrl).toHaveBeenCalledWith(attachment.storage_path, 300);
    expect(window.open).toHaveBeenCalledWith("https://signed.example/inline", "_blank", "noopener,noreferrer");
  });

  it.each([
    ["text/html", htmlAttachment],
    ["text/plain", textAttachment],
  ])("openAttachment opens the inline-viewer proxy route for %s, without minting a signed URL", (_label, attachment) => {
    const { supabase, createSignedUrl } = createStorageMock("https://signed.example/unused");

    // No await: the proxy branch is synchronous so popup blockers can't intervene.
    openAttachment(supabase, attachment);

    expect(createSignedUrl).not.toHaveBeenCalled();
    expect(window.open).toHaveBeenCalledWith(
      `/api/attachments/view?id=${attachment.id}`,
      "_blank",
      "noopener,noreferrer"
    );
  });

  it("openAttachment encodes the attachment id in the proxy URL", () => {
    const { supabase } = createStorageMock("https://signed.example/unused");
    const attachment: OpenableAttachment = { ...htmlAttachment, id: "id with spaces/slash" };

    openAttachment(supabase, attachment);

    expect(window.open).toHaveBeenCalledWith(
      "/api/attachments/view?id=id%20with%20spaces%2Fslash",
      "_blank",
      "noopener,noreferrer"
    );
  });

  it("openAttachment forces a download for non-inline, non-text content types", async () => {
    const { supabase, createSignedUrl } = createStorageMock("https://signed.example/zip");
    await openAttachment(supabase, zipAttachment);

    expect(createSignedUrl).toHaveBeenCalledWith(zipAttachment.storage_path, 60, {
      download: zipAttachment.file_name,
    });
    expect(window.open).toHaveBeenCalledWith("https://signed.example/zip", "_blank", "noopener,noreferrer");
  });

  it("openAttachment forces a download for docx", async () => {
    const { supabase, createSignedUrl } = createStorageMock("https://signed.example/docx");
    await openAttachment(supabase, docxAttachment);

    expect(createSignedUrl).toHaveBeenCalledWith(docxAttachment.storage_path, 60, {
      download: docxAttachment.file_name,
    });
    expect(window.open).toHaveBeenCalledWith("https://signed.example/docx", "_blank", "noopener,noreferrer");
  });

  it("downloadAttachment always forces a download, even for inline-eligible types", async () => {
    const { supabase, createSignedUrl } = createStorageMock("https://signed.example/pdf-download");
    await downloadAttachment(supabase, pdfAttachment);

    expect(createSignedUrl).toHaveBeenCalledWith(pdfAttachment.storage_path, 60, {
      download: pdfAttachment.file_name,
    });
    expect(window.open).toHaveBeenCalledWith("https://signed.example/pdf-download", "_blank", "noopener,noreferrer");
  });

  it("downloadAttachment forces a download for text/html too (Files tab download button)", async () => {
    const { supabase, createSignedUrl } = createStorageMock("https://signed.example/html-download");
    await downloadAttachment(supabase, htmlAttachment);

    expect(createSignedUrl).toHaveBeenCalledWith(htmlAttachment.storage_path, 60, {
      download: htmlAttachment.file_name,
    });
    expect(window.open).toHaveBeenCalledWith("https://signed.example/html-download", "_blank", "noopener,noreferrer");
  });

  it("calls window.open only after the signed URL resolves (inline branch)", async () => {
    const order: string[] = [];
    const createSignedUrl = vi.fn().mockImplementation(async () => {
      order.push("mint");
      return { data: { signedUrl: "https://signed.example/order" }, error: null };
    });
    openSpy.mockImplementation(() => {
      order.push("open");
      return null;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = { storage: { from: vi.fn(() => ({ createSignedUrl })) } } as any;

    await openAttachment(supabase, imageAttachment);

    expect(order).toEqual(["mint", "open"]);
  });

  it("throws and does not open a window when the signed URL request errors", async () => {
    const { supabase } = createStorageMock(null, { message: "not found" });

    await expect(openAttachment(supabase, imageAttachment)).rejects.toThrow("not found");
    expect(window.open).not.toHaveBeenCalled();
  });

  it("throws when no signed URL is returned and there is no explicit error", async () => {
    const { supabase } = createStorageMock(null);

    await expect(downloadAttachment(supabase, textAttachment)).rejects.toThrow();
    expect(window.open).not.toHaveBeenCalled();
  });
});
