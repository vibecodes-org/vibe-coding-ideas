import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const mockUsePathname = vi.fn<() => string>();
const mockGetUserRecentBoards = vi.fn();
const mockUseUser = vi.fn();
const mockPush = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname(),
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

vi.mock("@/actions/board", () => ({
  getUserRecentBoards: () => mockGetUserRecentBoards(),
}));

vi.mock("@/hooks/use-user", () => ({
  useUser: () => mockUseUser(),
}));

import { BoardSwitcher } from "./board-switcher";

const FAKE_USER = {
  id: "user-1",
  email: "nick@example.com",
  user_metadata: { full_name: "Nick Ball" },
};

const SAMPLE_BOARDS = [
  { ideaId: "balla-bot", title: "Balla Bot board", lastActivity: "2026-05-06T12:00:00Z" },
  { ideaId: "vibecodes", title: "VibeCodes", lastActivity: "2026-05-05T12:00:00Z" },
  { ideaId: "padel", title: "Padel Game Organiser", lastActivity: "2026-05-01T12:00:00Z" },
];

describe("BoardSwitcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseUser.mockReturnValue({ user: FAKE_USER, loading: false });
  });

  it("renders nothing when there is no logged-in user", () => {
    mockUseUser.mockReturnValue({ user: null, loading: false });
    mockUsePathname.mockReturnValue("/dashboard");
    mockGetUserRecentBoards.mockResolvedValue(SAMPLE_BOARDS);

    const { container } = render(<BoardSwitcher />);
    expect(container.firstChild).toBeNull();
  });

  it("off-board: renders user-segment link to /dashboard, no chevron", async () => {
    mockUsePathname.mockReturnValue("/dashboard");
    mockGetUserRecentBoards.mockResolvedValue(SAMPLE_BOARDS);

    render(<BoardSwitcher />);

    await waitFor(() => expect(mockGetUserRecentBoards).toHaveBeenCalled());

    const link = screen.getByRole("link", { name: /go to dashboard/i });
    expect(link).toHaveAttribute("href", "/dashboard");

    // No "Switch board" button should be present off-board
    expect(screen.queryByRole("button", { name: /switch board/i })).not.toBeInTheDocument();
  });

  it("on-board: renders user-segment + board-segment with current board name", async () => {
    mockUsePathname.mockReturnValue("/ideas/vibecodes/board");
    mockGetUserRecentBoards.mockResolvedValue(SAMPLE_BOARDS);

    render(<BoardSwitcher />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /switch board/i })).toBeInTheDocument();
    });

    const switchButton = screen.getByRole("button", { name: /switch board/i });
    expect(switchButton).toHaveTextContent("VibeCodes");
    expect(switchButton).toHaveAttribute("aria-haspopup", "menu");
    expect(switchButton).toHaveAttribute("aria-expanded", "false");

    const link = screen.getByRole("link", { name: /go to dashboard/i });
    expect(link).toHaveAttribute("href", "/dashboard");
  });

  it("unknown idea ID does NOT show a board segment (no impersonation)", async () => {
    mockUsePathname.mockReturnValue("/ideas/some-unknown-id/board");
    mockGetUserRecentBoards.mockResolvedValue(SAMPLE_BOARDS);

    render(<BoardSwitcher />);

    await waitFor(() => expect(mockGetUserRecentBoards).toHaveBeenCalled());

    expect(screen.queryByRole("button", { name: /switch board/i })).not.toBeInTheDocument();
    // The pill should still link to /dashboard
    const link = screen.getByRole("link", { name: /go to dashboard/i });
    expect(link).toHaveAttribute("href", "/dashboard");
  });

  it("empty boards: still renders user segment, no board segment", async () => {
    mockUsePathname.mockReturnValue("/dashboard");
    mockGetUserRecentBoards.mockResolvedValue([]);

    render(<BoardSwitcher />);

    await waitFor(() => expect(mockGetUserRecentBoards).toHaveBeenCalled());

    const link = screen.getByRole("link", { name: /go to dashboard/i });
    expect(link).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /switch board/i })).not.toBeInTheDocument();
  });

  it("displays first name from full_name", async () => {
    mockUsePathname.mockReturnValue("/dashboard");
    mockGetUserRecentBoards.mockResolvedValue(SAMPLE_BOARDS);

    render(<BoardSwitcher />);

    await waitFor(() => expect(mockGetUserRecentBoards).toHaveBeenCalled());

    expect(screen.getByText("Nick")).toBeInTheDocument();
  });

  it("falls back to email prefix if full_name is missing", async () => {
    mockUseUser.mockReturnValue({
      user: { id: "u", email: "alice@example.com", user_metadata: {} },
      loading: false,
    });
    mockUsePathname.mockReturnValue("/dashboard");
    mockGetUserRecentBoards.mockResolvedValue(SAMPLE_BOARDS);

    render(<BoardSwitcher />);

    await waitFor(() => expect(mockGetUserRecentBoards).toHaveBeenCalled());

    expect(screen.getByText("alice")).toBeInTheDocument();
  });

  it("clicking the board segment toggles the dropdown open", async () => {
    mockUsePathname.mockReturnValue("/ideas/vibecodes/board");
    mockGetUserRecentBoards.mockResolvedValue(SAMPLE_BOARDS);

    render(<BoardSwitcher />);

    const button = await screen.findByRole("button", { name: /switch board/i });
    expect(button).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(button);

    await waitFor(() => {
      expect(button).toHaveAttribute("aria-expanded", "true");
    });
  });

  it("Cmd+B opens the dropdown", async () => {
    mockUsePathname.mockReturnValue("/dashboard");
    mockGetUserRecentBoards.mockResolvedValue(SAMPLE_BOARDS);

    render(<BoardSwitcher />);
    await waitFor(() => expect(mockGetUserRecentBoards).toHaveBeenCalled());

    // Off-board there's no aria-expanded button to inspect, but the picker should mount.
    fireEvent.keyDown(window, { key: "b", metaKey: true });

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Find a board…")).toBeInTheDocument();
    });
  });

  it("hides the switcher below the md breakpoint via responsive classes", async () => {
    mockUsePathname.mockReturnValue("/dashboard");
    mockGetUserRecentBoards.mockResolvedValue(SAMPLE_BOARDS);

    const { container } = render(<BoardSwitcher />);
    await waitFor(() => expect(mockGetUserRecentBoards).toHaveBeenCalled());

    const wrapper = container.querySelector("div");
    expect(wrapper?.className).toContain("hidden");
    expect(wrapper?.className).toContain("md:flex");
  });
});
