import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { UnmeasuredCostBanner } from "./unmeasured-cost-banner";
import type { UnmeasuredAlert } from "@/lib/step-cost/unmeasured-alert";

const card = (over: Partial<UnmeasuredAlert["cards"][number]> = {}) => ({
  taskId: "t1",
  title: "Rewrite the welcome emails",
  count: 47,
  lastAt: "2026-11-10T10:00:00Z",
  reasonText: "The session couldn't run the measuring command:",
  reasonQuote: "Sandbox refuses the script" as string | null,
  ...over,
});

const alert3: UnmeasuredAlert = {
  cards: [card(), card({ taskId: "t2", title: "Add a price filter", count: 12 }), card({ taskId: null, title: null, count: 1 })],
  topReasonText: "The session couldn't run the measuring command:",
  topReasonQuote: "Sandbox refuses the script",
};
const alert1: UnmeasuredAlert = { ...alert3, cards: [card({ count: 1 })] };

beforeEach(() => sessionStorage.clear());

describe("UnmeasuredCostBanner", () => {
  it("shows the wording for one card with no list toggle", () => {
    render(<UnmeasuredCostBanner alert={alert1} ideaId="i1" />);
    expect(screen.getByText(/1 card had steps finish with no cost recorded in the last 14 days/)).toBeInTheDocument();
    expect(screen.getByText("Sandbox refuses the script")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /1 cards/ })).not.toBeInTheDocument();
  });

  it("lists cards when opened; archived card has no Open link", () => {
    render(<UnmeasuredCostBanner alert={alert3} ideaId="i1" />);
    expect(screen.getByText(/3 cards had steps finish/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open latest card/ })).toHaveAttribute("href", "?taskId=t1");
    const toggle = screen.getByRole("button", { name: /3 cards/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(screen.getByText("Rewrite the welcome emails")).toBeInTheDocument();
    expect(screen.getByText("Archived or deleted card")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /^Open →$/ })).toHaveLength(2);
  });

  it("renders titles and reasons as plain text", () => {
    const evil = { ...alert1, cards: [card({ title: "<b>x</b>", reasonQuote: "<i>y</i>" })] };
    render(<UnmeasuredCostBanner alert={evil} ideaId="i1" />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss missing cost warning" }));
    expect(document.querySelector("b")).toBeNull();
  });

  it("stays hidden after dismiss until more cards are flagged", () => {
    const { unmount } = render(<UnmeasuredCostBanner alert={alert3} ideaId="i1" />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss missing cost warning" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    unmount();
    render(<UnmeasuredCostBanner alert={alert3} ideaId="i1" />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    const more: UnmeasuredAlert = { ...alert3, cards: [...alert3.cards, card({ taskId: "t9" })] };
    render(<UnmeasuredCostBanner alert={more} ideaId="i1" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("renders nothing for read-only viewers", () => {
    render(<UnmeasuredCostBanner alert={alert3} ideaId="i1" isReadOnly />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
