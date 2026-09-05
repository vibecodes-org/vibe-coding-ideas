import { describe, it, expect, beforeEach, vi } from "vitest";
import { buildEmailHtml } from "./email-template";

describe("buildEmailHtml", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://vibecodes.co.uk");
  });

  it("renders a complete branded email with heading and body", () => {
    const html = buildEmailHtml({
      heading: "Test Heading",
      bodyHtml: "<p>Test body content</p>",
    });

    // Background color
    expect(html).toContain("background-color:#09090b");
    // Card color
    expect(html).toContain("background-color:#18181b");
    // Logo
    expect(html).toContain("apple-touch-icon.png");
    expect(html).toContain("VibeCodes");
    // Heading
    expect(html).toContain("Test Heading");
    // Body
    expect(html).toContain("Test body content");
    // Footer
    expect(html).toContain("&copy; 2026 VibeCodes");
    // Manage preferences link
    expect(html).toContain("Manage email preferences");
    expect(html).toContain("/profile");
  });

  it("renders CTA button when ctaText and ctaUrl provided", () => {
    const html = buildEmailHtml({
      heading: "Action Required",
      bodyHtml: "<p>Click below</p>",
      ctaText: "View Comment",
      ctaUrl: "https://vibecodes.co.uk/ideas/123",
    });

    expect(html).toContain("View Comment");
    expect(html).toContain("https://vibecodes.co.uk/ideas/123");
    // Button styling
    expect(html).toContain("background-color:#e4e4e7");
  });

  it("does not render CTA button when ctaText is missing", () => {
    const html = buildEmailHtml({
      heading: "No Action",
      bodyHtml: "<p>Just info</p>",
    });

    expect(html).not.toContain("background-color:#e4e4e7;border-radius:8px");
  });

  it("renders footer text when provided", () => {
    const html = buildEmailHtml({
      heading: "Test",
      bodyHtml: "<p>Body</p>",
      footerText: "You received this because of a comment.",
    });

    expect(html).toContain("You received this because of a comment.");
  });

  it("escapes HTML in heading", () => {
    const html = buildEmailHtml({
      heading: '<script>alert("xss")</script>',
      bodyHtml: "<p>Safe body</p>",
    });

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes HTML in CTA URL", () => {
    const html = buildEmailHtml({
      heading: "Test",
      bodyHtml: "<p>Body</p>",
      ctaText: "Click",
      ctaUrl: 'https://example.com/"><script>alert(1)</script>',
    });

    expect(html).not.toContain('"><script>');
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
  });

  it("escapes HTML in footer text", () => {
    const html = buildEmailHtml({
      heading: "Test",
      bodyHtml: "<p>Body</p>",
      footerText: "Test <b>bold</b>",
    });

    expect(html).toContain("Test &lt;b&gt;bold&lt;/b&gt;");
  });

  it("uses NEXT_PUBLIC_APP_URL for logo link", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://custom.example.com");

    const html = buildEmailHtml({
      heading: "Test",
      bodyHtml: "<p>Body</p>",
    });

    expect(html).toContain("https://custom.example.com/apple-touch-icon.png");
    expect(html).toContain("https://custom.example.com/profile");
  });

  it("falls back to vibecodes.co.uk when no env var set", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");

    const html = buildEmailHtml({
      heading: "Test",
      bodyHtml: "<p>Body</p>",
    });

    expect(html).toContain("https://vibecodes.co.uk/apple-touch-icon.png");
  });

  it("renders a hidden preheader before the visible body when provided", () => {
    const html = buildEmailHtml({
      heading: "Test Heading",
      bodyHtml: "<p>Visible body content</p>",
      preheaderText: "hidden preview text",
    });

    expect(html).toContain("hidden preview text");
    expect(html).toContain("display:none");
    const preheaderIndex = html.indexOf("hidden preview text");
    const bodyIndex = html.indexOf("Visible body content");
    expect(preheaderIndex).toBeGreaterThan(-1);
    expect(preheaderIndex).toBeLessThan(bodyIndex);
  });

  it("omits the preheader block entirely when not provided", () => {
    const html = buildEmailHtml({
      heading: "Test Heading",
      bodyHtml: "<p>Visible body content</p>",
    });

    expect(html).not.toContain("mso-hide:all");
  });

  it("escapes HTML in the preheader text", () => {
    const html = buildEmailHtml({
      heading: "Test",
      bodyHtml: "<p>Body</p>",
      preheaderText: '<script>alert("x")</script>',
    });

    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });

  it("produces valid HTML structure", () => {
    const html = buildEmailHtml({
      heading: "Structure Test",
      bodyHtml: "<p>Body</p>",
      ctaText: "Click",
      ctaUrl: "https://example.com",
      footerText: "Footer here",
    });

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html lang=\"en\">");
    expect(html).toContain("</html>");
    expect(html).toContain('<meta name="color-scheme" content="dark">');
  });
});
