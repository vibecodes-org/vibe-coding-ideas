import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import type { User } from "@/types";

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({}),
}));

vi.mock("@/lib/attachment-open", () => ({
  openAttachment: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

// Must import after mocks are set up
import { Markdown, matchAttachmentSegments, type MarkdownAttachment } from "./markdown";

const shortlist: MarkdownAttachment = {
  id: "a1",
  file_name: "shortlist.html",
  content_type: "text/html",
  storage_path: "idea/task/shortlist.html",
};

const myReport: MarkdownAttachment = {
  id: "a2",
  file_name: "my-report.html",
  content_type: "text/html",
  storage_path: "idea/task/my-report.html",
};

const report: MarkdownAttachment = {
  id: "a3",
  file_name: "report.html",
  content_type: "text/html",
  storage_path: "idea/task/report.html",
};

describe("matchAttachmentSegments (pure matcher)", () => {
  it("returns the whole text as a single text segment when attachments is undefined", () => {
    expect(matchAttachmentSegments("no attachments here", undefined)).toEqual([
      { type: "text", value: "no attachments here" },
    ]);
  });

  it("returns the whole text as a single text segment when attachments is empty", () => {
    expect(matchAttachmentSegments("nothing to match", [])).toEqual([
      { type: "text", value: "nothing to match" },
    ]);
  });

  it("leaves text with no matching filename unchanged", () => {
    const segments = matchAttachmentSegments("Earlier draft in old-draft.txt was superseded.", [shortlist]);
    expect(segments).toEqual([{ type: "text", value: "Earlier draft in old-draft.txt was superseded." }]);
  });

  it("matches case-insensitively but preserves the author's original casing", () => {
    const segments = matchAttachmentSegments("See SHORTLIST.HTML for details", [shortlist]);
    expect(segments).toEqual([
      { type: "text", value: "See " },
      { type: "attachment", value: "SHORTLIST.HTML", attachment: shortlist },
      { type: "text", value: " for details" },
    ]);
  });

  it("respects word boundaries: does not match inside a longer filename", () => {
    // "report.html" must not match inside "my-report.html" — the "-" before
    // it is a word-boundary char per the [\w-] rule.
    const segments = matchAttachmentSegments("Open my-report.html now", [report]);
    expect(segments).toEqual([{ type: "text", value: "Open my-report.html now" }]);
  });

  it("prefers the longest filename match when multiple candidates overlap", () => {
    const segments = matchAttachmentSegments("Open my-report.html now", [report, myReport]);
    expect(segments).toEqual([
      { type: "text", value: "Open " },
      { type: "attachment", value: "my-report.html", attachment: myReport },
      { type: "text", value: " now" },
    ]);
  });

  it("keeps adjacent punctuation outside the match — trailing period", () => {
    const segments = matchAttachmentSegments("Superseded by shortlist.html.", [shortlist]);
    expect(segments).toEqual([
      { type: "text", value: "Superseded by " },
      { type: "attachment", value: "shortlist.html", attachment: shortlist },
      { type: "text", value: "." },
    ]);
  });

  it("keeps adjacent punctuation outside the match — parentheses", () => {
    const segments = matchAttachmentSegments("Full pack (shortlist.html) attached", [shortlist]);
    expect(segments).toEqual([
      { type: "text", value: "Full pack (" },
      { type: "attachment", value: "shortlist.html", attachment: shortlist },
      { type: "text", value: ") attached" },
    ]);
  });

  it("matches multiple distinct references in one string", () => {
    const segments = matchAttachmentSegments("Compared shortlist.html against my-report.html here", [
      shortlist,
      myReport,
    ]);
    expect(segments).toEqual([
      { type: "text", value: "Compared " },
      { type: "attachment", value: "shortlist.html", attachment: shortlist },
      { type: "text", value: " against " },
      { type: "attachment", value: "my-report.html", attachment: myReport },
      { type: "text", value: " here" },
    ]);
  });
});

describe("Markdown attachment linkification (rendered)", () => {
  afterEach(() => cleanup());

  it("renders a clickable link for a matched attachment filename", () => {
    render(<Markdown attachments={[shortlist]}>{"See shortlist.html for the pack."}</Markdown>);
    const link = screen.getByRole("button", { name: "shortlist.html" });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("title", "Open attachment shortlist.html");
  });

  it("renders no link and is unchanged when the attachments prop is absent", () => {
    const { container } = render(<Markdown>{"See shortlist.html for the pack."}</Markdown>);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(container.textContent).toContain("shortlist.html");
  });

  it("does not linkify a filename inside a code span", () => {
    render(<Markdown attachments={[shortlist]}>{"Run `cp shortlist.html ./dist/`"}</Markdown>);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    const code = screen.getByText((content) => content.includes("shortlist.html"), { selector: "code" });
    expect(code).toBeInTheDocument();
  });

  it("linkifies a filename nested inside bold text", () => {
    render(<Markdown attachments={[shortlist]}>{"**Key deliverable: shortlist.html**"}</Markdown>);
    const link = screen.getByRole("button", { name: "shortlist.html" });
    expect(link).toBeInTheDocument();
    const strong = document.querySelector("strong");
    expect(strong).not.toBeNull();
    expect(strong).toContainElement(link);
  });

  it("linkifies a filename nested inside emphasis (em override, mention parity)", () => {
    render(<Markdown attachments={[shortlist]}>{"_See shortlist.html_"}</Markdown>);
    const link = screen.getByRole("button", { name: "shortlist.html" });
    expect(link).toBeInTheDocument();
    const em = document.querySelector("em");
    expect(em).not.toBeNull();
    expect(em).toContainElement(link);
  });

  it("renders both a mention and an adjacent attachment link (coexistence)", () => {
    const teamMembers: User[] = [
      { id: "u1", full_name: "Jane Doe", is_bot: false } as User,
    ];
    render(
      <Markdown teamMembers={teamMembers} attachments={[shortlist]}>
        {"Reviewed by @Jane Doe against shortlist.html"}
      </Markdown>
    );
    expect(screen.getByRole("link", { name: "@Jane Doe" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "shortlist.html" })).toBeInTheDocument();
  });
});
