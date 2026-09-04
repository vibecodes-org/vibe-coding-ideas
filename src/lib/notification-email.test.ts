import { describe, it, expect } from "vitest";
import {
  buildNotificationEmail,
  buildSnippet,
  selectSnippetSource,
  stripMarkdown,
  truncateSnippet,
  escapeHtml,
  SNIPPET_MAX_LENGTH,
  type SnippetSourceInputs,
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

  it("returns text unchanged (no ellipsis) one under the limit", () => {
    const text = "a".repeat(199);
    const result = truncateSnippet(text, 200);
    expect(result).toBe(text);
    expect(result.endsWith("…")).toBe(false);
  });

  it("returns text unchanged when exactly at the limit", () => {
    const text = "a".repeat(200);
    expect(truncateSnippet(text, 200)).toBe(text);
    expect(truncateSnippet(text, 200).length).toBe(200);
    expect(truncateSnippet(text, 200).endsWith("…")).toBe(false);
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

describe("stripMarkdown + escapeHtml interaction (end-to-end snippet safety)", () => {
  // Regression coverage for the highest-risk part of this fix: a comment is
  // markdown (stripped) AND untrusted HTML (must be escaped) at the same
  // time. buildSnippet only strips; callers must escape afterwards (via
  // quoteBlock inside buildNotificationEmail) — never before, or stripping
  // could re-expose markup that escaping already neutralized.

  it("markdown formatting can unwrap to raw HTML, which must still be escaped afterwards", () => {
    // Bold-wrapped script tag: stripMarkdown removes the ** markers and
    // leaves the raw tag intact — it does not know about HTML.
    const raw = "**<script>alert(1)</script>**";
    const snippet = buildSnippet(raw);
    expect(snippet).toBe("<script>alert(1)</script>");

    // The email builder must escape what buildSnippet handed back.
    const email = buildNotificationEmail({
      type: "comment",
      actorName: "Chris",
      ideaTitle: null,
      taskTitle: null,
      snippet,
      ctaUrl: CTA_URL,
    });
    expect(email!.html).not.toContain("<script>");
    expect(email!.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("a markdown link whose text is a raw tag collapses to the tag, then gets escaped", () => {
    // [text](url) collapses to just the text — if that text is itself a
    // tag, stripMarkdown has effectively "unwrapped" markup that a naive
    // strip-after-escape order would have left inert.
    const raw = "[<img src=x onerror=alert(1)>](https://evil.example)";
    const snippet = buildSnippet(raw);
    expect(snippet).toBe("<img src=x onerror=alert(1)>");

    const email = buildNotificationEmail({
      type: "task_mention",
      actorName: "Chris",
      ideaTitle: "Idea",
      taskTitle: "Task",
      snippet,
      ctaUrl: CTA_URL,
    });
    expect(email!.html).not.toContain("<img src=x");
    expect(email!.html).not.toMatch(/onerror=alert\(1\)>(?!;)/); // no live attribute in markup form
    expect(email!.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("markdown fence content that is a script tag is escaped, not rendered", () => {
    const raw = "```html\n<script>alert(document.cookie)</script>\n```";
    const snippet = buildSnippet(raw);
    const email = buildNotificationEmail({
      type: "comment_mention",
      actorName: "Chris",
      ideaTitle: "Idea",
      taskTitle: null,
      snippet,
      ctaUrl: CTA_URL,
    });
    expect(email!.html).not.toContain("<script>");
    expect(email!.html).toContain("&lt;script&gt;alert(document.cookie)&lt;/script&gt;");
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
    expect(email!.subject).toBe('Chris mentioned you in "Fix the header" (Board Redesign)');
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

describe("selectSnippetSource", () => {
  // Baseline with everything fetched/present, so each case below only needs
  // to override what's relevant to it — this is what lets the table stay
  // readable as the thing under test (which source wins), not buried in
  // boilerplate.
  const base: SnippetSourceInputs = {
    type: "comment",
    hasCommentId: false,
    hasReplyId: false,
    commentBody: "the comment text",
    replyBody: "the reply text",
    taskDescription: "the task description",
    ideaDescription: "the idea description",
    discussionBody: "the discussion post body",
  };

  it("comment: always quotes the comment body", () => {
    expect(selectSnippetSource({ ...base, type: "comment" })).toEqual({
      source: "comment",
      raw: "the comment text",
    });
  });

  it("comment: a comment row that fails to resolve renders nothing, never the idea description", () => {
    expect(
      selectSnippetSource({ ...base, type: "comment", commentBody: null })
    ).toEqual({ source: "comment", raw: null });
  });

  it("comment_mention: always quotes the comment body, never the idea description on miss", () => {
    expect(selectSnippetSource({ ...base, type: "comment_mention" })).toEqual({
      source: "comment",
      raw: "the comment text",
    });
    expect(
      selectSnippetSource({ ...base, type: "comment_mention", commentBody: null })
    ).toEqual({ source: "comment", raw: null });
  });

  it("task_mention: with a comment_id, quotes the task comment", () => {
    expect(
      selectSnippetSource({ ...base, type: "task_mention", hasCommentId: true })
    ).toEqual({ source: "comment", raw: "the comment text" });
  });

  it("task_mention: without a comment_id (description-edit mention), quotes the task description", () => {
    expect(
      selectSnippetSource({ ...base, type: "task_mention", hasCommentId: false })
    ).toEqual({ source: "task_description", raw: "the task description" });
  });

  it("discussion_reply: never quotes anything — the trigger records no reply_id to look up", () => {
    expect(
      selectSnippetSource({ ...base, type: "discussion_reply", hasReplyId: false })
    ).toEqual({ source: null, raw: null });
    // Even if a reply_id were somehow present, discussion_reply ignores it —
    // this type structurally never carries one (see the migration comment
    // in the route), so there's nothing to gain from checking hasReplyId here.
    expect(
      selectSnippetSource({ ...base, type: "discussion_reply", hasReplyId: true })
    ).toEqual({ source: null, raw: null });
  });

  it("discussion_mention: with a reply_id, quotes the reply body — this is the one case that already worked", () => {
    expect(
      selectSnippetSource({ ...base, type: "discussion_mention", hasReplyId: true })
    ).toEqual({ source: "reply", raw: "the reply text" });
  });

  it("discussion_mention: without a reply_id (mentioned in the post itself), quotes the discussion body — never the idea description", () => {
    expect(
      selectSnippetSource({ ...base, type: "discussion_mention", hasReplyId: false })
    ).toEqual({ source: "discussion_body", raw: "the discussion post body" });
  });

  it("status_change: quotes the idea description — this is the one type it's genuinely correct for", () => {
    expect(selectSnippetSource({ ...base, type: "status_change" })).toEqual({
      source: "idea_description",
      raw: "the idea description",
    });
  });

  it("collaborator, collaboration_request, collaboration_response, discussion: no comment concept, nothing to quote", () => {
    for (const type of [
      "collaborator",
      "collaboration_request",
      "collaboration_response",
      "discussion",
    ] as const) {
      expect(selectSnippetSource({ ...base, type })).toEqual({ source: null, raw: null });
    }
  });
});

describe("buildNotificationEmail: subject lines", () => {
  it("comment: includes the idea title, truncated for the subject", () => {
    const email = buildNotificationEmail({
      type: "comment",
      actorName: "Chris",
      ideaTitle: "Board Redesign",
      taskTitle: null,
      snippet: null,
      ctaUrl: CTA_URL,
    });
    expect(email!.subject).toBe('Chris commented on "Board Redesign"');
  });

  it("comment: falls back to the content-free subject when there's no idea title", () => {
    const email = buildNotificationEmail({
      type: "comment",
      actorName: "Chris",
      ideaTitle: null,
      taskTitle: null,
      snippet: null,
      ctaUrl: CTA_URL,
    });
    expect(email!.subject).toBe("Chris commented on your idea");
  });

  it("task_mention: includes both the task and idea title", () => {
    const email = buildNotificationEmail({
      type: "task_mention",
      actorName: "Chris",
      ideaTitle: "Board Redesign",
      taskTitle: "Fix the header",
      snippet: null,
      ctaUrl: CTA_URL,
    });
    expect(email!.subject).toBe('Chris mentioned you in "Fix the header" (Board Redesign)');
  });

  it("task_mention: description-edit mentions get accurate body wording, not 'a comment on'", () => {
    const email = buildNotificationEmail({
      type: "task_mention",
      actorName: "Chris",
      ideaTitle: "Board Redesign",
      taskTitle: "Fix the header",
      snippet: "updated scope to include mobile",
      snippetSource: "task_description",
      ctaUrl: CTA_URL,
    });
    expect(email!.html).toContain("mentioned you in the description of");
    expect(email!.html).not.toContain("mentioned you in a comment on");
  });

  it("comment_mention: includes the idea title", () => {
    const email = buildNotificationEmail({
      type: "comment_mention",
      actorName: "Chris",
      ideaTitle: "Board Redesign",
      taskTitle: null,
      snippet: null,
      ctaUrl: CTA_URL,
    });
    expect(email!.subject).toBe('Chris mentioned you in a comment on "Board Redesign"');
  });

  it("discussion_reply and discussion_mention: include the idea title", () => {
    const reply = buildNotificationEmail({
      type: "discussion_reply",
      actorName: "Chris",
      ideaTitle: "Board Redesign",
      taskTitle: null,
      snippet: null,
      ctaUrl: CTA_URL,
    });
    expect(reply!.subject).toBe('Chris replied to a discussion on "Board Redesign"');

    const mention = buildNotificationEmail({
      type: "discussion_mention",
      actorName: "Chris",
      ideaTitle: "Board Redesign",
      taskTitle: null,
      snippet: null,
      ctaUrl: CTA_URL,
    });
    expect(mention!.subject).toBe('Chris mentioned you in a discussion on "Board Redesign"');
  });

  it("truncates a very long idea title deliberately rather than letting the subject run on", () => {
    const longTitle = "A".repeat(120);
    const email = buildNotificationEmail({
      type: "comment",
      actorName: "Chris",
      ideaTitle: longTitle,
      taskTitle: null,
      snippet: null,
      ctaUrl: CTA_URL,
    });
    // Truncated to the subject title cap (60) plus the ellipsis character.
    expect(email!.subject).toBe(`Chris commented on "${"A".repeat(60)}…"`);
    expect(email!.subject.length).toBeLessThan(longTitle.length);
  });

  it("truncates a long idea title more aggressively when it's the parenthetical part of a task_mention subject", () => {
    const longIdeaTitle = "B".repeat(120);
    const email = buildNotificationEmail({
      type: "task_mention",
      actorName: "Chris",
      ideaTitle: longIdeaTitle,
      taskTitle: "Fix the header",
      snippet: null,
      ctaUrl: CTA_URL,
    });
    expect(email!.subject).toBe(`Chris mentioned you in "Fix the header" (${"B".repeat(40)}…)`);
  });

  it("subject lines are plain text: special characters are not HTML-escaped", () => {
    const email = buildNotificationEmail({
      type: "comment",
      actorName: "Chris & Co",
      ideaTitle: `Tom & Jerry's "Big" Idea`,
      taskTitle: null,
      snippet: null,
      ctaUrl: CTA_URL,
    });
    expect(email!.subject).toBe(`Chris & Co commented on "Tom & Jerry's "Big" Idea"`);
    expect(email!.subject).not.toContain("&amp;");
    expect(email!.subject).not.toContain("&#039;");
  });
});

describe("buildNotificationEmail: preheader", () => {
  it("carries the quoted snippet as a hidden preheader, first in the body", () => {
    const email = buildNotificationEmail({
      type: "comment",
      actorName: "Chris",
      ideaTitle: "Board Redesign",
      taskTitle: null,
      snippet: "great idea, one suggestion",
      ctaUrl: CTA_URL,
    });
    // The preheader div must appear before the visible card content.
    const preheaderIndex = email!.html.indexOf("great idea, one suggestion");
    const headingIndex = email!.html.indexOf("New comment on your idea");
    expect(preheaderIndex).toBeGreaterThan(-1);
    expect(preheaderIndex).toBeLessThan(headingIndex);
    expect(email!.html).toContain("display:none");
  });

  it("omits the preheader entirely when there's no snippet to show", () => {
    const email = buildNotificationEmail({
      type: "comment",
      actorName: "Chris",
      ideaTitle: "Board Redesign",
      taskTitle: null,
      snippet: null,
      ctaUrl: CTA_URL,
    });
    expect(email!.html).not.toContain("mso-hide:all");
  });

  it("does not add a preheader for types with no quote block at all", () => {
    const email = buildNotificationEmail({
      type: "collaborator",
      actorName: "Chris",
      ideaTitle: "Board Redesign",
      taskTitle: null,
      snippet: "should never surface here",
      ctaUrl: CTA_URL,
    });
    expect(email!.html).not.toContain("mso-hide:all");
    expect(email!.html).not.toContain("should never surface here");
  });
});
