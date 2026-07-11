import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { openAttachment, downloadAttachment, type OpenableAttachment } from "./attachment-open";

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

describe("openAttachment / downloadAttachment", () => {
  let openSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
  });

  afterEach(() => {
    openSpy.mockRestore();
  });

  const imageAttachment: OpenableAttachment = {
    storage_path: "idea/task/photo.png",
    file_name: "photo.png",
    content_type: "image/png",
  };
  const pdfAttachment: OpenableAttachment = {
    storage_path: "idea/task/report.pdf",
    file_name: "report.pdf",
    content_type: "application/pdf",
  };
  const htmlAttachment: OpenableAttachment = {
    storage_path: "idea/task/page.html",
    file_name: "page.html",
    content_type: "text/html",
  };
  const textAttachment: OpenableAttachment = {
    storage_path: "idea/task/notes.txt",
    file_name: "notes.txt",
    content_type: "text/plain",
  };
  const zipAttachment: OpenableAttachment = {
    storage_path: "idea/task/bundle.zip",
    file_name: "bundle.zip",
    content_type: "application/zip",
  };

  it.each([
    ["image/*", imageAttachment],
    ["application/pdf", pdfAttachment],
    ["text/html", htmlAttachment],
    ["text/plain", textAttachment],
  ])("openAttachment mints a 5-minute inline signed URL for %s", async (_label, attachment) => {
    const { supabase, createSignedUrl } = createStorageMock("https://signed.example/inline");
    await openAttachment(supabase, attachment);

    expect(createSignedUrl).toHaveBeenCalledWith(attachment.storage_path, 300);
    expect(window.open).toHaveBeenCalledWith("https://signed.example/inline", "_blank", "noopener,noreferrer");
  });

  it("openAttachment forces a download for non-inline content types", async () => {
    const { supabase, createSignedUrl } = createStorageMock("https://signed.example/zip");
    await openAttachment(supabase, zipAttachment);

    expect(createSignedUrl).toHaveBeenCalledWith(zipAttachment.storage_path, 60, {
      download: zipAttachment.file_name,
    });
    expect(window.open).toHaveBeenCalledWith("https://signed.example/zip", "_blank", "noopener,noreferrer");
  });

  it("downloadAttachment always forces a download, even for inline-eligible types", async () => {
    const { supabase, createSignedUrl } = createStorageMock("https://signed.example/pdf-download");
    await downloadAttachment(supabase, pdfAttachment);

    expect(createSignedUrl).toHaveBeenCalledWith(pdfAttachment.storage_path, 60, {
      download: pdfAttachment.file_name,
    });
    expect(window.open).toHaveBeenCalledWith("https://signed.example/pdf-download", "_blank", "noopener,noreferrer");
  });

  it("calls window.open only after the signed URL resolves", async () => {
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
