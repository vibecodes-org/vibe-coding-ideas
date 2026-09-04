import { describe, it, expect } from "vitest";
import {
  buildNotificationEmail,
  buildSnippet,
  stripMarkdown,
  truncateSnippet,
  escapeHtml,
  SNIPPET_MAX_LENGTH,
} from "./notification-email";

const CTA_URL = "https://vibecodes.co.uk/ideas/idea-1#comment-1";

describe("stripMarkdown", () => {
  it("removes bold and italic markers", () => {
    expect(stripMarkdown("**bold** and *italic* and __also bold__")).toBe(
      "bold and italic and also bold"
    );
  });

  it("removes inline code and fenced code blocks", () => {
    expect(stripMarkdown("run `npm test` please")).toBe("run npm test please");
    expect(stripMarkdown("```js\nconsole.log(1)\n```")).toBe("console.log(1)");
  });

  it("collapses links to their text", () => {
    expect(stripMarkdown("see [the docs](https://example.com) for more")).toBe(
      "see the docs for more"
    );
  });

  it("collapses images to their alt text", () => {
    expect(stripMarkdown("![a screenshot](https://example.com/x.png)")).toBe(
      "a screenshot"
    );
  });

  it("strips headings and blockquote markers", () => {
    expect(stripMarkdown("## Heading\n> quoted line")).toBe("Heading quoted line");
  });

  it("removes strikethrough markers but keeps the text", () => {
    expect(stripMarkdown("~~wrong~~ right")).toBe("wrong right");
  });

  it("collapses newlines and repeated whitespace", () => {
    expect(stripMarkdown("line one\n\nline   two")).toBe("line one line two");
  });
});

describe("truncateSnippet", () => {
  it("returns text unchanged when under the limit", () => {
    expect(truncateSnippet("short text", 200)).toBe("short text");
  });

  it("returns text unchanged when exactly at the limit", () => {
    const text = "a".repeat(200);
    expect(truncateSnippet(text, 200)).toBe(text);
    expect(truncateSnippet(text, 200).length).toBe(200);
  });

  it("truncates and appends an ellipsis when over the limit", () => {
    const text = "a".repeat(201);
    const result = truncateSnippet(text, 200);
    expect(result).toBe(`${"a".repeat(200)}…`);
    expect(result.startsWith("a".repeat(200))).toBe(true);
  });

  it("uses SNIPPET_MAX_LENGTH as the default", () => {
    const text = "a".repeat(SNIPPET_MAX_LENGTH + 5);
    expect(truncateSnippet(text)).toBe(`${"a".repeat(SNIPPET_MAX_LENGTH)}…`);
  });
});

describe("buildSnippet", () => {
  it("returns null for null/undefined/empty input", () => {
    expect(buildSnippet(null)).toBeNull();
    expect(buildSnippet(undefined)).toBeNull();
    expect(buildSnippet("")).toBeNull();
  });

  it("returns null when the input is markdown that strips to nothing", () => {
    expect(buildSnippet("   \n\n  ")).toBeNull();
  });

  it("strips markdown and truncates in one pass", () => {
    const raw = `**${"a".repeat(210)}**`;
    const snippet = buildSnippet(raw);
    expect(snippet).toBe(`${"a".repeat(200)}…`);
  });
});

describe("escapeHtml", () => {
  it("escapes all five special characters", () => {
    expect(escapeHtml(`< > & " '`)).toBe("&lt; &gt; &amp; &quot; &#039;");
  });
});

describe("buildNotificationEmail", () => {
  it("includes the snippet in a quote block for a task mention", () => {
    const email = buildNotificationEmail({
      type: "task_mention",
      actorName: "Chris",
      ideaTitle: "Board Redesign",
      taskTitle: "Fix the header",
      snippet: "please take a look at this before Friday",
      ctaUrl: CTA_URL,
    });

    expect(email).not.toBeNull();
    expect(email!.subject).toBe("Chris mentioned you in a task");
    expect(email!.html).toContain("please take a look at this before Friday");
    expect(email!.html).toContain("<blockquote");
    expect(email!.html).toContain("Fix the header");
  });

  it("includes the snippet for a comment_mention", () => {
    const email = buildNotificationEmail({
      type: "comment_mention",
      actorName: "Chris",
      ideaTitle: "Board Redesign",
      taskTitle: null,
      snippet: "hey can you review this",
      ctaUrl: CTA_URL,
    });
    expect(email!.html).toContain("hey can you review this");
  });

  it("includes the snippet for a plain comment", () => {
    const email = buildNotificationEmail({
      type: "comment",
      actorName: "Chris",
      ideaTitle: "Board Redesign",
      taskTitle: null,
      snippet: "great idea, one suggestion",
      ctaUrl: CTA_URL,
    });
    expect(email!.html).toContain("great idea, one suggestion");
  });

  it("includes the snippet for a discussion reply and discussion mention", () => {
    const reply = buildNotificationEmail({
      type: "discussion_reply",
      actorName: "Chris",
      ideaTitle: "Board Redesign",
      taskTitle: null,
      snippet: "I agree with this approach",
      ctaUrl: CTA_URL,
    });
    expect(reply!.html).toContain("I agree with this approach");

    const mention = buildNotificationEmail({
      type: "discussion_mention",
      actorName: "Chris",
      ideaTitle: "Board Redesign",
      taskTitle: null,
      snippet: "worth looping you in here",
      ctaUrl: CTA_URL,
    });
    expect(mention!.html).toContain("worth looping you in here");
  });

  it("includes the snippet for a status change (description fallback)", () => {
    const email = buildNotificationEmail({
      type: "status_change",
      actorName: "Chris",
      ideaTitle: "Board Redesign",
      taskTitle: null,
      snippet: "a real-time collaborative board for teams",
      ctaUrl: CTA_URL,
    });
    expect(email!.html).toContain("a real-time collaborative board for teams");
  });

  it("degrades to the plain sentence when there is no snippet", () => {
    const email = buildNotificationEmail({
      type: "task_mention",
      actorName: "Chris",
      ideaTitle: "Board Redesign",
      taskTitle: "Fix the header",
      snippet: null,
      ctaUrl: CTA_URL,
    });
    expect(email!.html).not.toContain("<blockquote");
    expect(email!.html).toContain("Chris mentioned you in a comment on");
  });

  it("does not render a quote block for types with no comment concept", () => {
    const email = buildNotificationEmail({
      type: "collaborator",
      actorName: "Chris",
      ideaTitle: "Board Redesign",
      taskTitle: null,
      snippet: "this should never be shown",
      ctaUrl: CTA_URL,
    });
    expect(email!.html).not.toContain("this should never be shown");
    expect(email!.html).not.toContain("<blockquote");
  });

  it("HTML-escapes special characters in the snippet", () => {
    const email = buildNotificationEmail({
      type: "comment",
      actorName: "Chris",
      ideaTitle: "Board Redesign",
      taskTitle: null,
      snippet: `<script>alert('x')</script> & "quoted"`,
      ctaUrl: CTA_URL,
    });
    expect(email!.html).toContain(
      "&lt;script&gt;alert(&#039;x&#039;)&lt;/script&gt; &amp; &quot;quoted&quot;"
    );
    expect(email!.html).not.toContain("<script>");
  });

  it("returns null for an unknown notification type", () => {
    const email = buildNotificationEmail({
      // @ts-expect-error - deliberately testing the unmatched-switch fallback
      type: "not_a_real_type",
      actorName: "Chris",
      ideaTitle: null,
      taskTitle: null,
      snippet: null,
      ctaUrl: CTA_URL,
    });
    expect(email).toBeNull();
  });
});
