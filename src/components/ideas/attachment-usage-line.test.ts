import { describe, it, expect } from "vitest";
import { ENHANCE_ATTACHMENT_MAX_MB } from "@/lib/validation";
import {
  parseAttachmentUsageHeader,
  omissionReasonText,
} from "./attachment-usage-line";

const encode = (obj: unknown) => encodeURIComponent(JSON.stringify(obj));

describe("parseAttachmentUsageHeader", () => {
  it("returns null for missing/empty header", () => {
    expect(parseAttachmentUsageHeader(null)).toBeNull();
    expect(parseAttachmentUsageHeader(undefined)).toBeNull();
    expect(parseAttachmentUsageHeader("")).toBeNull();
  });

  it("returns null for malformed (non-JSON / non-object) values", () => {
    expect(parseAttachmentUsageHeader("%%%not-uri%%%")).toBeNull();
    expect(parseAttachmentUsageHeader(encodeURIComponent("not json"))).toBeNull();
    expect(parseAttachmentUsageHeader(encode(42))).toBeNull();
    expect(parseAttachmentUsageHeader(encode(null))).toBeNull();
  });

  it("parses a valid full usage payload", () => {
    const result = parseAttachmentUsageHeader(
      encode({
        used: [{ id: "1", name: "spec.md", truncated: false }],
        omitted: [{ id: "2", name: "big.pdf", reason: "too_large" }],
      })
    );
    expect(result).toEqual({
      kind: "full",
      usage: {
        used: [{ id: "1", name: "spec.md", truncated: false }],
        omitted: [{ id: "2", name: "big.pdf", reason: "too_large" }],
      },
    });
  });

  it("preserves the truncated flag and unicode filenames round-tripped through the header", () => {
    const name = "研究ノート・最終版.md";
    const result = parseAttachmentUsageHeader(
      encode({ used: [{ id: "1", name, truncated: true }], omitted: [] })
    );
    expect(result).toEqual({
      kind: "full",
      usage: { used: [{ id: "1", name, truncated: true }], omitted: [] },
    });
  });

  it("coerces unknown omission reasons to read_error", () => {
    const result = parseAttachmentUsageHeader(
      encode({ used: [], omitted: [{ id: "9", name: "x.pdf", reason: "banana" }] })
    );
    expect(result).toEqual({
      kind: "full",
      usage: { used: [], omitted: [{ id: "9", name: "x.pdf", reason: "read_error" }] },
    });
  });

  it("drops entries with no name and returns null when nothing is left", () => {
    expect(
      parseAttachmentUsageHeader(encode({ used: [{ id: "1" }], omitted: [{ id: "2" }] }))
    ).toBeNull();
  });

  it("returns null when arrays are missing (not the counts shape)", () => {
    expect(parseAttachmentUsageHeader(encode({ foo: "bar" }))).toBeNull();
  });

  it("parses the counts-only fallback shape", () => {
    expect(parseAttachmentUsageHeader(encode({ usedCount: 2, omittedCount: 1 }))).toEqual({
      kind: "counts",
      usedCount: 2,
      omittedCount: 1,
    });
  });

  it("returns null for a counts payload of all zeros", () => {
    expect(parseAttachmentUsageHeader(encode({ usedCount: 0, omittedCount: 0 }))).toBeNull();
  });
});

describe("omissionReasonText", () => {
  it("maps too_large / over_budget / read_error", () => {
    expect(omissionReasonText("a.md", "too_large")).toBe(
      `over the ${ENHANCE_ATTACHMENT_MAX_MB} MB size limit`
    );
    expect(omissionReasonText("a.md", "over_budget")).toBe(
      "skipped to stay within the combined reading limit"
    );
    expect(omissionReasonText("a.pdf", "read_error")).toBe("couldn't be read");
  });

  it("distinguishes SVG from other images for unsupported_type", () => {
    expect(omissionReasonText("logo.svg", "unsupported_type")).toBe("SVG files can't be read");
    expect(omissionReasonText("photo.png", "unsupported_type")).toBe("images can't be read");
    expect(omissionReasonText("photo.JPG", "unsupported_type")).toBe("images can't be read");
  });
});
