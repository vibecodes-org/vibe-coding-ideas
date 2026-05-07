import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, onClick, ...rest }: { children: React.ReactNode; href: string; onClick?: () => void }) => (
    <a href={href} onClick={onClick} {...rest}>{children}</a>
  ),
}));

import { BoardPicker } from "./board-picker";

const SAMPLE_BOARDS = [
  { ideaId: "balla-bot", title: "Balla Bot board", lastActivity: "2026-05-06T12:00:00Z" },
  { ideaId: "vibecodes", title: "VibeCodes", lastActivity: "2026-05-05T12:00:00Z" },
  { ideaId: "padel", title: "Padel Game Organiser", lastActivity: "2026-05-01T12:00:00Z" },
];

describe("BoardPicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the search input with autofocus and 'Recent' header", () => {
    render(<BoardPicker boards={SAMPLE_BOARDS} currentIdeaId={null} onSelect={() => {}} />);

    const input = screen.getByPlaceholderText("Find a board…");
    expect(input).toBeInTheDocument();
    expect(document.activeElement).toBe(input);
    expect(screen.getByText("Recent")).toBeInTheDocument();
  });

  it("renders all boards in default state", () => {
    render(<BoardPicker boards={SAMPLE_BOARDS} currentIdeaId={null} onSelect={() => {}} />);

    expect(screen.getByText("Balla Bot board")).toBeInTheDocument();
    expect(screen.getByText("VibeCodes")).toBeInTheDocument();
    expect(screen.getByText("Padel Game Organiser")).toBeInTheDocument();
  });

  it("highlights the current board with 'Current' label", () => {
    render(<BoardPicker boards={SAMPLE_BOARDS} currentIdeaId="vibecodes" onSelect={() => {}} />);

    expect(screen.getByText("Current")).toBeInTheDocument();
  });

  it("filters boards by case-insensitive substring", () => {
    render(<BoardPicker boards={SAMPLE_BOARDS} currentIdeaId={null} onSelect={() => {}} />);

    const input = screen.getByPlaceholderText("Find a board…");
    fireEvent.change(input, { target: { value: "ba" } });

    // "Balla Bot board" matches; "VibeCodes" doesn't contain "ba"; "Padel" doesn't either.
    expect(screen.getByText("Bot board", { exact: false })).toBeInTheDocument();
    expect(screen.queryByText("VibeCodes")).not.toBeInTheDocument();
    expect(screen.queryByText("Padel Game Organiser")).not.toBeInTheDocument();

    // Header switches to match count
    expect(screen.getByText("1 match")).toBeInTheDocument();
  });

  it("highlights matched substrings with <mark>", () => {
    const { container } = render(
      <BoardPicker boards={SAMPLE_BOARDS} currentIdeaId={null} onSelect={() => {}} />
    );

    fireEvent.change(screen.getByPlaceholderText("Find a board…"), { target: { value: "vibe" } });

    const mark = container.querySelector("mark");
    expect(mark?.textContent).toBe("Vibe");
  });

  it("shows 'No boards match' when search has zero results", () => {
    render(<BoardPicker boards={SAMPLE_BOARDS} currentIdeaId={null} onSelect={() => {}} />);

    fireEvent.change(screen.getByPlaceholderText("Find a board…"), { target: { value: "zzz" } });

    expect(screen.getByText(/No boards match/i)).toBeInTheDocument();
  });

  it("renders zero-state with CTA when boards is empty", () => {
    render(<BoardPicker boards={[]} currentIdeaId={null} onSelect={() => {}} />);

    expect(screen.getByText("No boards yet")).toBeInTheDocument();
    expect(screen.getByText("Go to dashboard")).toBeInTheDocument();
    // No search input rendered in zero state
    expect(screen.queryByPlaceholderText("Find a board…")).not.toBeInTheDocument();
  });

  it("clicking a board calls router.push and onSelect", () => {
    const onSelect = vi.fn();
    render(<BoardPicker boards={SAMPLE_BOARDS} currentIdeaId={null} onSelect={onSelect} />);

    fireEvent.click(screen.getByText("VibeCodes"));

    expect(mockPush).toHaveBeenCalledWith("/ideas/vibecodes/board");
    expect(onSelect).toHaveBeenCalled();
  });

  it("ArrowDown then Enter navigates to the second board", () => {
    const onSelect = vi.fn();
    render(<BoardPicker boards={SAMPLE_BOARDS} currentIdeaId={null} onSelect={onSelect} />);

    const input = screen.getByPlaceholderText("Find a board…");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(mockPush).toHaveBeenCalledWith("/ideas/vibecodes/board");
    expect(onSelect).toHaveBeenCalled();
  });

  it("Enter on the default state navigates to the first board", () => {
    render(<BoardPicker boards={SAMPLE_BOARDS} currentIdeaId={null} onSelect={() => {}} />);

    fireEvent.keyDown(screen.getByPlaceholderText("Find a board…"), { key: "Enter" });

    expect(mockPush).toHaveBeenCalledWith("/ideas/balla-bot/board");
  });

  it("'All boards…' footer link points to /dashboard", () => {
    render(<BoardPicker boards={SAMPLE_BOARDS} currentIdeaId={null} onSelect={() => {}} />);

    const link = screen.getByText("All boards…").closest("a");
    expect(link).toHaveAttribute("href", "/dashboard");
  });
});
