/**
 * Branded HTML email template builder.
 * Matches the design system from supabase/templates/confirm-signup.html:
 * - Background: #09090b (Zinc-950)
 * - Card: #18181b (Zinc-900) with #27272a border
 * - Text: #fafafa (headings), #a1a1aa (body), #71717a (muted)
 * - CTA button: #e4e4e7 bg, #18181b text
 * - Logo: vibecodes.co.uk/apple-touch-icon.png
 */

interface EmailTemplateOptions {
  heading: string;
  bodyHtml: string;
  ctaText?: string;
  ctaUrl?: string;
  footerText?: string;
  /**
   * Hidden preview text shown by the inbox next to the subject line, before
   * the recipient opens the email. Without this, mail clients fall back to
   * the first visible text in the body — our logo alt text and wordmark —
   * so every notification email previews identically. Rendered as the
   * first element of the body and hidden via the standard
   * display:none + max-height:0 + overflow:hidden preheader technique, with
   * trailing whitespace entities so it doesn't run into visible body text.
   */
  preheaderText?: string;
}

export function buildEmailHtml({
  heading,
  bodyHtml,
  ctaText,
  ctaUrl,
  footerText,
  preheaderText,
}: EmailTemplateOptions): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://vibecodes.co.uk";

  const preheaderBlock = preheaderText
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#09090b;opacity:0;">${escapeHtml(preheaderText)}${"&nbsp;&zwnj;".repeat(20)}</div>`
    : "";

  const ctaBlock =
    ctaText && ctaUrl
      ? `
              <!-- Button -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
                <tr>
                  <td style="background-color:#e4e4e7;border-radius:8px;">
                    <a href="${escapeHtml(ctaUrl)}" target="_blank" style="display:inline-block;padding:12px 32px;font-size:14px;font-weight:600;color:#18181b;text-decoration:none;">
                      ${escapeHtml(ctaText)}
                    </a>
                  </td>
                </tr>
              </table>`
      : "";

  const footerBlock = footerText
    ? `<p style="margin:0;font-size:12px;color:#71717a;">${escapeHtml(footerText)}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="dark">
</head>
<body style="margin:0;padding:0;background-color:#09090b;font-family:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  ${preheaderBlock}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#09090b;padding:40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;">
          <!-- Logo -->
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <a href="${escapeHtml(appUrl)}" style="text-decoration:none;">
                <img src="${escapeHtml(appUrl)}/apple-touch-icon.png" width="48" height="48" alt="VibeCodes" style="border-radius:12px;">
                <span style="display:inline-block;vertical-align:middle;margin-left:12px;font-size:22px;font-weight:700;color:#fafafa;">VibeCodes</span>
              </a>
            </td>
          </tr>
          <!-- Card -->
          <tr>
            <td style="background-color:#18181b;border:1px solid #27272a;border-radius:12px;padding:40px 32px;">
              <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#fafafa;">${escapeHtml(heading)}</h1>
              <div style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#a1a1aa;">
                ${bodyHtml}
              </div>
              ${ctaBlock}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:32px;">
              ${footerBlock}
              <p style="margin:8px 0 0;font-size:12px;color:#71717a;">
                <a href="${escapeHtml(appUrl)}/profile" style="color:#71717a;text-decoration:underline;">Manage email preferences</a>
              </p>
              <p style="margin:8px 0 0;font-size:12px;color:#71717a;">
                &copy; 2026 VibeCodes. The AI-powered idea board.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
